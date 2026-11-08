// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { testModelConnection } from './modelConnectionTest'
import type { ModelConfig } from './openAiTypes'

const baseConfig: ModelConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  model: 'vision-model',
  provider: 'custom',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('testModelConnection', () => {
  it('posts a tiny chat completion directly when no proxy is configured', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => {
      void _input
      void _init
      return jsonResponse({ choices: [] })
    })

    const result = await testModelConnection({ fetcher, modelConfig: baseConfig })

    expect(result).toEqual({ ok: true, message: 'vision-model' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      model: 'vision-model',
      max_tokens: 1,
      stream: false,
    })
  })

  it('uses the proxy path and token for OpenAI Responses models', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => {
      void _input
      void _init
      return jsonResponse({ output: [] })
    })

    const result = await testModelConnection({
      fetcher,
      modelConfig: { ...baseConfig, provider: 'openai' },
      proxyToken: 'secret',
      proxyUrl: 'http://localhost:8787/api/openai/chat/completions',
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://localhost:8787/api/openai/chat/completions')
    expect((init as RequestInit).headers).toMatchObject({ 'x-proxy-token': 'secret' })
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      baseUrl: baseConfig.baseUrl,
      apiKey: 'sk-test',
      path: '/responses',
    })
  })

  it('returns the provider error without throwing', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => {
      void _input
      void _init
      return jsonResponse({ error: { message: 'Invalid API key' } }, 401)
    })

    const result = await testModelConnection({ fetcher, modelConfig: baseConfig })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Invalid API key')
  })

  it('uses the Gemini generateContent endpoint', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => {
      void _input
      void _init
      return jsonResponse({ candidates: [] })
    })

    const result = await testModelConnection({
      fetcher,
      modelConfig: {
        ...baseConfig,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      },
    })

    expect(result.ok).toBe(true)
    const [url] = fetcher.mock.calls[0]
    expect(url).toContain('/models/gemini-3.5-flash:generateContent?key=sk-test')
  })
})
