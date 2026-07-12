import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpenAiProxyHandler } from './openAiProxy.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

interface UpstreamRequestRecord {
  url: string | undefined
  authorization?: string | undefined
  contentType?: string | undefined
  body: unknown
}

describe('createOpenAiProxyHandler', () => {
  it('forwards a local proxy request to the configured OpenAI-compatible base URL', async () => {
    const upstreamRequests: UpstreamRequestRecord[] = []
    const upstreamUrl = await listen((_request, response) => {
      let body = ''
      const request = _request as IncomingMessage
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        upstreamRequests.push({
          url: request.url,
          authorization: request.headers.authorization,
          contentType: request.headers['content-type'],
          body: JSON.parse(body),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done"}' } }] }))
      })
    })
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: `${upstreamUrl}/v1`,
        apiKey: 'secret',
        payload: {
          model: 'agent-model',
          messages: [{ role: 'user', content: 'hello' }],
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      choices: [{ message: { content: '{"action":"done"}' } }],
    })
    expect(upstreamRequests).toEqual([
      {
        url: '/v1/chat/completions',
        authorization: 'Bearer secret',
        contentType: 'application/json',
        body: {
          model: 'agent-model',
          messages: [{ role: 'user', content: 'hello' }],
        },
      },
    ])
  })

  it('forwards official OpenAI Responses requests when path is /responses', async () => {
    const upstreamRequests: UpstreamRequestRecord[] = []
    const upstreamUrl = await listen((_request, response) => {
      let body = ''
      const request = _request as IncomingMessage
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        upstreamRequests.push({
          url: request.url,
          authorization: request.headers.authorization,
          contentType: request.headers['content-type'],
          body: JSON.parse(body),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ output_text: '{"action":"done"}' }))
      })
    })
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: `${upstreamUrl}/v1`,
        apiKey: 'secret',
        path: '/responses',
        payload: {
          model: 'gpt-5.6',
          reasoning: { effort: 'high', mode: 'pro' },
          input: [{ role: 'user', content: 'hello' }],
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ output_text: '{"action":"done"}' })
    expect(upstreamRequests).toEqual([
      {
        url: '/v1/responses',
        authorization: 'Bearer secret',
        contentType: 'application/json',
        body: {
          model: 'gpt-5.6',
          reasoning: { effort: 'high', mode: 'pro' },
          input: [{ role: 'user', content: 'hello' }],
        },
      },
    ])
  })

  it('rejects unsupported upstream paths', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        path: '/models',
        payload: { model: 'gpt-5.6' },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { message: 'Upstream path must be /chat/completions or /responses.' },
    })
  })

  it('rejects proxy requests without a valid payload', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { message: 'Request payload must be an object.' },
    })
  })

  it('rejects proxy requests with an unsupported base URL protocol', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'file:///tmp/model-api',
        apiKey: 'secret',
        payload: { model: 'agent-model' },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { message: 'Base URL must use http or https.' },
    })
  })

  it('rejects proxy requests that exceed the configured body limit', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler(fetch, { maxBodyBytes: 24 }))

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        payload: { model: 'agent-model' },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { message: 'Request body is too large.' },
    })
  })

  it('aborts the upstream model request when the client disconnects', async () => {
    let upstreamSignal: AbortSignal | null | undefined
    const upstreamStarted = deferred<void>()
    const upstreamAborted = deferred<void>()
    const fetcher = async (_url: string, init?: RequestInit) => {
      upstreamSignal = init?.signal
      upstreamStarted.resolve()
      return new Promise<Response>((_resolve, reject) => {
        upstreamSignal?.addEventListener(
          'abort',
          () => {
            upstreamAborted.resolve()
            const error = new Error('upstream aborted')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true },
        )
      })
    }
    const proxyUrl = await listen(createOpenAiProxyHandler(fetcher))
    const controller = new AbortController()

    const request = fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        payload: { model: 'agent-model', messages: [{ role: 'user', content: 'hello' }] },
      }),
    }).catch((error) => error)

    await upstreamStarted.promise
    expect(upstreamSignal?.aborted).toBe(false)

    controller.abort()

    await upstreamAborted.promise
    await expect(request).resolves.toEqual(expect.objectContaining({ name: 'AbortError' }))
  })
})

function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null
      if (!address || typeof address === 'string') {
        reject(new Error('Could not bind test server.'))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
