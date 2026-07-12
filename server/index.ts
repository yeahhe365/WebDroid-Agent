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
const host = process.env.HOST || '0.0.0.0'

export interface WebDroidServerOptions {
  distDir?: string
  openAiProxyHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>
}

export function createWebDroidServer({
  distDir = defaultDistDir,
  openAiProxyHandler = createOpenAiProxyHandler(),
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

      await serveStatic(request, response, distDir)
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

  response.writeHead(200, responseHeaders(pathToServe, distDir))
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

function responseHeaders(filePath: string, distDir: string): StaticResponseHeaders {
  return {
    'Content-Type': contentType(filePath),
    'Cache-Control': cacheControl(filePath, distDir),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'usb=(self), camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://dashscope.aliyuncs.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  }
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
