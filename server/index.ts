import type { IncomingMessage, ServerResponse, Server, OutgoingHttpHeaders } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createOpenAiProxyHandler, isOpenAiProxyRequest } from './openAiProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultDistDir = path.resolve(__dirname, '../dist')
const port = Number(process.env.PORT || 8080)
// Default to loopback so the proxy is not exposed to the LAN by accident;
// set HOST=0.0.0.0 explicitly (e.g. Docker) to listen on all interfaces.
const host = process.env.HOST || '127.0.0.1'

export interface WebDroidServerOptions {
  distDir?: string
  openAiProxyHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>
  /**
   * Extra origins appended to the CSP `connect-src` directive, e.g. custom
   * OpenAI-compatible provider endpoints. Space-separated origins from the
   * CSP_CONNECT_SRC environment variable are used by default.
   */
  extraConnectOrigins?: string[]
}

const DEFAULT_EXTRA_CONNECT_ORIGINS = parseConnectOrigins(process.env.CSP_CONNECT_SRC)

export function createWebDroidServer({
  distDir = defaultDistDir,
  openAiProxyHandler = createOpenAiProxyHandler(),
  extraConnectOrigins = DEFAULT_EXTRA_CONNECT_ORIGINS,
}: WebDroidServerOptions = {}): Server {
  return createServer((request, response) => {
    const handler = async () => {
      if (isOpenAiProxyRequest(request.url)) {
        await openAiProxyHandler(request, response)
        return
      }

      if (requestPathname(request.url) === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
        return
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' })
        response.end()
        return
      }

      await serveStatic(request, response, distDir, extraConnectOrigins)
    }

    handler().catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500)
      }
      response.end()
      console.error('Unhandled server error:', error)
    })
  })
}

if (isMainModule()) {
  const server = createWebDroidServer()
  server.listen(port, host, () => {
    console.log(`WebDroid Agent listening on http://${host}:${port}`)
  })
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  distDir: string,
  extraConnectOrigins: readonly string[],
): Promise<void> {
  const requestPath = safeRequestPath(request.url)
  if (!requestPath) {
    response.writeHead(400)
    response.end()
    return
  }

  const filePath = path.join(distDir, requestPath)
  const resolvedPath = path.resolve(filePath)
  const indexPath = path.join(distDir, 'index.html')

  if (!isPathInside(resolvedPath, distDir)) {
    response.writeHead(403)
    response.end()
    return
  }

  const pathToServe = await readableFilePath(resolvedPath, indexPath)
  if (!pathToServe) {
    response.writeHead(404)
    response.end()
    return
  }

  response.writeHead(200, responseHeaders(pathToServe, distDir, extraConnectOrigins))
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(pathToServe).pipe(response)
}

function safeRequestPath(requestUrl: string | undefined): string | null {
  try {
    const url = new URL(requestUrl ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') {
      return 'index.html'
    }
    return pathname.replace(/^\/+/, '')
  } catch {
    return null
  }
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

async function readableFilePath(
  candidatePath: string,
  indexPath: string,
): Promise<string | null> {
  const directFilePath = await filePathIfReadable(candidatePath)
  if (directFilePath) {
    return directFilePath
  }

  if (!path.extname(candidatePath)) {
    return filePathIfReadable(indexPath)
  }

  return null
}

async function filePathIfReadable(candidatePath: string): Promise<string | null> {
  try {
    const info = await stat(candidatePath)
    if (info.isFile()) {
      return candidatePath
    }
  } catch {
    return null
  }

  return null
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath)
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

interface StaticResponseHeaders extends OutgoingHttpHeaders {
  'Content-Type': string
  'Cache-Control': string
  'X-Content-Type-Options': 'nosniff'
  'X-Frame-Options': 'DENY'
  'Referrer-Policy': 'strict-origin-when-cross-origin'
  'Permissions-Policy': string
  'Content-Security-Policy': string
}

function responseHeaders(
  filePath: string,
  distDir: string,
  extraConnectOrigins: readonly string[] = [],
): StaticResponseHeaders {
  return {
    'Content-Type': contentType(filePath),
    'Cache-Control': cacheControl(filePath, distDir),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'usb=(self), camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': contentSecurityPolicy(extraConnectOrigins),
  }
}

/**
 * Space-separated extra origins (CSP_CONNECT_SRC). Entries are sanitized:
 * only http(s) origins and 'self' survive; duplicates are removed.
 */
function parseConnectOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  const seen = new Set<string>()
  const origins: string[] = []
  for (const entry of raw.split(/\s+/)) {
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    if (trimmed === "'self'") {
      seen.add(trimmed)
      origins.push(trimmed)
      continue
    }
    try {
      const url = new URL(trimmed)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        seen.add(trimmed)
        origins.push(trimmed)
      }
    } catch {
      // ignore malformed entries
    }
  }
  return origins
}

function contentSecurityPolicy(extraConnectOrigins: readonly string[]): string {
  const connectSrc = [
    "'self'",
    'https://generativelanguage.googleapis.com',
    'https://api.openai.com',
    'https://dashscope.aliyuncs.com',
    ...extraConnectOrigins,
  ].join(' ')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

function cacheControl(filePath: string, distDir: string): string {
  const relativePath = path.relative(distDir, filePath).replaceAll(path.sep, '/')
  if (relativePath === 'index.html' || path.extname(filePath) === '.html') {
    return 'no-cache'
  }
  if (relativePath.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=3600'
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1]
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(entrypoint).href
}

function requestPathname(requestUrl: string | undefined): string | null {
  try {
    return new URL(requestUrl ?? '/', 'http://localhost').pathname
  } catch {
    return null
  }
}
