import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWebDroidServer } from './index.js'

let distDir: string | undefined
const tempDirs: string[] = []
const servers: Server[] = []

beforeEach(async () => {
  distDir = await mkdtemp(path.join(tmpdir(), 'webdroid-dist-'))
  tempDirs.push(distDir)
  await writeFile(path.join(distDir, 'index.html'), '<main>WebDroid</main>')
  await writeFile(path.join(distDir, 'app.js'), 'console.log("ok")')
  await mkdir(path.join(distDir, 'assets'))
  await writeFile(path.join(distDir, 'assets/index-abc123.js'), 'console.log("asset")')
})

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  distDir = undefined
})

describe('createWebDroidServer', () => {
  it('serves static assets from the configured dist directory', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const response = await fetch(`${serverUrl}/app.js`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await response.text()).toBe('console.log("ok")')
  })

  it('falls back to index.html for client-side routes', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const response = await fetch(`${serverUrl}/thread/abc123`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toBe('<main>WebDroid</main>')
  })

  it('omits the response body for HEAD requests', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const response = await fetch(`${serverUrl}/`, { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('serves immutable cache headers for built assets and no-cache for HTML', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const assetResponse = await fetch(`${serverUrl}/assets/index-abc123.js`, { method: 'HEAD' })
    const htmlResponse = await fetch(`${serverUrl}/`, { method: 'HEAD' })

    expect(assetResponse.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(htmlResponse.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves the health check even when a query string is present', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const response = await fetch(`${serverUrl}/healthz?source=compose`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('rejects malformed encoded paths before serving files', async () => {
    const serverUrl = await listen(createWebDroidServer({ distDir: distDir! }))

    const response = await fetch(`${serverUrl}/%E0%A4%A`)

    expect(response.status).toBe(400)
  })

  it('returns 404 for client-side routes when the SPA entry is missing', async () => {
    const emptyDistDir = await mkdtemp(path.join(tmpdir(), 'webdroid-empty-dist-'))
    tempDirs.push(emptyDistDir)
    const serverUrl = await listen(createWebDroidServer({ distDir: emptyDistDir }))

    const response = await fetch(`${serverUrl}/thread/abc123`)

    expect(response.status).toBe(404)
  })
})

function listen(server: Server): Promise<string> {
  servers.push(server)

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not bind test server.'))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}
