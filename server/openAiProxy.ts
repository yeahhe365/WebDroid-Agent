import type { IncomingMessage, ServerResponse } from 'node:http'

export const OPENAI_PROXY_PATH = '/api/openai/chat/completions'
export const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024 // 10 MiB — room for multi-message conversations with image data URLs

/**
 * Hardening knobs (all optional; unset = permissive local development):
 * - PROXY_TOKEN:        when set, proxy requests must present this shared secret
 * - PROXY_ALLOW_HOSTS:  when set, upstream baseUrl hosts must match this allowlist
 */
const DEFAULT_PROXY_TOKEN = process.env.PROXY_TOKEN ?? ''
const DEFAULT_ALLOWED_HOSTS = parseAllowedHosts(process.env.PROXY_ALLOW_HOSTS)

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenAiProxyHandlerOptions {
  maxBodyBytes?: number
  /** Shared secret required from proxy clients when set. Defaults to the PROXY_TOKEN env var. */
  proxyToken?: string
  /** Allowed upstream hosts; empty means no restriction. Defaults to PROXY_ALLOW_HOSTS env var. */
  allowedHosts?: string[]
}

export type OpenAiProxyHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>

export function createOpenAiProxyHandler(
  fetcher: Fetcher = fetch,
  {
    maxBodyBytes,
    proxyToken = DEFAULT_PROXY_TOKEN,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
  }: OpenAiProxyHandlerOptions = {},
): OpenAiProxyHandler {
  const resolvedMaxBodyBytes = maxBodyBytes ?? MAX_PROXY_BODY_BYTES
  const normalizedAllowedHosts = normalizeAllowedHosts(allowedHosts)

  return async function openAiProxyHandler(request, response) {
    const url = parseRequestUrl(request.url)
    if (!url) {
      sendJson(response, 400, { error: { message: 'Request URL is invalid.' } })
      return
    }

    if (url.pathname !== OPENAI_PROXY_PATH) {
      sendJson(response, 404, { error: { message: 'Not found.' } })
      return
    }

    if (request.method !== 'POST') {
      response.writeHead(405, {
        Allow: 'POST',
        'Content-Type': 'application/json',
      })
      response.end(JSON.stringify({ error: { message: 'Method not allowed.' } }))
      return
    }

    if (!isAuthorizedProxyRequest(request, proxyToken)) {
      sendJson(response, 401, { error: { message: 'Proxy token is required or invalid.' } })
      return
    }

    let body: unknown
    try {
      body = JSON.parse(await readRequestBody(request, resolvedMaxBodyBytes))
    } catch (caught) {
      if (isRequestBodyTooLargeError(caught)) {
        sendJson(response, 413, { error: { message: 'Request body is too large.' } })
        return
      }
      sendJson(response, 400, { error: { message: 'Request body must be valid JSON.' } })
      return
    }

    const validationError = validateProxyRequest(body)
    if (validationError) {
      sendJson(response, 400, { error: { message: validationError } })
      return
    }

    const validatedBody = body as ProxyRequestBody
    const upstreamPath = resolveUpstreamPath(validatedBody.path)
    if (!upstreamPath) {
      sendJson(response, 400, {
        error: { message: 'Upstream path must be /chat/completions or /responses.' },
      })
      return
    }
    const upstreamUrl = `${normalizeBaseUrl(validatedBody.baseUrl)}${upstreamPath}`
    const allowedHostError = resolveAllowedHostError(upstreamUrl, normalizedAllowedHosts)
    if (allowedHostError) {
      sendJson(response, 403, { error: { message: allowedHostError } })
      return
    }
    const abortController = new AbortController()
    const abortUpstream = () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
    }
    request.once('aborted', abortUpstream)
    response.once('close', abortUpstream)

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetcher(upstreamUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedBody.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify(validatedBody.payload),
      })
    } catch (caught) {
      request.off('aborted', abortUpstream)
      response.off('close', abortUpstream)
      if (abortController.signal.aborted) {
        return
      }
      const message = caught instanceof Error ? caught.message : String(caught)
      sendJson(response, 502, { error: { message: `Model API request failed: ${message}` } })
      return
    }

    await forwardUpstreamResponse(response, upstreamResponse, {
      onFinished: () => {
        request.off('aborted', abortUpstream)
        response.off('close', abortUpstream)
      },
    })
  }
}

export function isOpenAiProxyRequest(requestUrl: string | undefined): boolean {
  return parseRequestUrl(requestUrl)?.pathname === OPENAI_PROXY_PATH
}

interface ProxyRequestBody {
  baseUrl: string
  apiKey: string
  payload: Record<string, unknown>
  path?: string | null
}

function validateProxyRequest(body: unknown): string | null {
  if (!isRecord(body)) {
    return 'Request body must be an object.'
  }
  if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) {
    return 'Base URL is required.'
  }
  if (!isHttpBaseUrl(body.baseUrl)) {
    return 'Base URL must use http or https.'
  }
  if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
    return 'API key is required.'
  }
  if (!isRecord(body.payload)) {
    return 'Request payload must be an object.'
  }
  return null
}

const ALLOWED_UPSTREAM_PATHS = new Set(['/chat/completions', '/responses'])

function resolveUpstreamPath(path: unknown): string | null {
  if (path === undefined || path === null || path === '') {
    return '/chat/completions'
  }
  if (typeof path !== 'string') {
    return null
  }
  const trimmed = path.trim()
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return ALLOWED_UPSTREAM_PATHS.has(normalized) ? normalized : null
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function isHttpBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeAllowedHosts(hosts: readonly string[]): string[] {
  return Array.from(new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean)))
}

function isAuthorizedProxyRequest(request: IncomingMessage, proxyToken: string): boolean {
  if (!proxyToken) {
    return true
  }
  const authorization = request.headers.authorization
  if (authorization === `Bearer ${proxyToken}`) {
    return true
  }
  const headerToken = request.headers['x-proxy-token']
  if (typeof headerToken === 'string') {
    return headerToken === proxyToken
  }
  if (Array.isArray(headerToken)) {
    return headerToken.includes(proxyToken)
  }
  return false
}

function hostMatchesAllowlistEntry(host: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1) // '.example.com'
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === entry
}

function resolveAllowedHostError(upstreamUrl: string, allowedHosts: string[]): string | null {
  if (allowedHosts.length === 0) {
    return null
  }
  let host: string | null = null
  try {
    host = new URL(upstreamUrl).host.toLowerCase()
  } catch {
    return 'Upstream URL is invalid.'
  }
  if (host && allowedHosts.some((entry) => hostMatchesAllowlistEntry(host, entry))) {
    return null
  }
  return `Upstream host "${host}" is not in the allowed hosts list.`
}

function readRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bodyBytes = 0
    let tooLarge = false

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      if (tooLarge) {
        return
      }
      bodyBytes += Buffer.byteLength(chunk, 'utf8')
      if (bodyBytes > maxBodyBytes) {
        tooLarge = true
        reject(new RequestBodyTooLargeError())
        return
      }
      body += chunk
    })
    request.on('end', () => {
      if (!tooLarge) {
        resolve(body)
      }
    })
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (!tooLarge) {
        reject(error)
      }
    })
  })
}

function parseRequestUrl(requestUrl: string | undefined): URL | null {
  try {
    return new URL(requestUrl ?? '/', 'http://localhost')
  } catch {
    return null
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'RequestBodyTooLargeError'
    Object.setPrototypeOf(this, RequestBodyTooLargeError.prototype)
  }
}

function isRequestBodyTooLargeError(error: unknown): boolean {
  return error instanceof RequestBodyTooLargeError
}

interface ForwardUpstreamOptions {
  onFinished?: () => void
}

async function forwardUpstreamResponse(
  response: ServerResponse,
  upstreamResponse: Response,
  { onFinished }: ForwardUpstreamOptions = {},
): Promise<void> {
  response.statusCode = upstreamResponse.status
  const contentType = upstreamResponse.headers.get('content-type')
  if (contentType) {
    response.setHeader('Content-Type', contentType)
  }

  if (!upstreamResponse.body) {
    response.end()
    onFinished?.()
    return
  }

  const reader = upstreamResponse.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        response.write(Buffer.from(value))
      }
    }
    response.end()
  } catch (caught) {
    if (!response.destroyed) {
      response.destroy(caught instanceof Error ? caught : new Error(String(caught)))
    }
  } finally {
    onFinished?.()
    reader.releaseLock()
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
