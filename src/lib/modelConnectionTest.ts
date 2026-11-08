import { withModelRequestTimeout } from './modelRequestTimeout'
import { formatApiError, readJsonOrUndefined } from './openAiResponse'
import { normalizeBaseUrl } from './openAiClient'
import { isOpenAiProvider } from './modelProviders'
import { isGeminiProvider } from './geminiTypes'
import type { ModelConfig } from './openAiTypes'

export type ModelConnectionTestResult = {
  message: string
  ok: boolean
}

export type ModelConnectionTestOptions = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>
  modelConfig: ModelConfig
  proxyToken?: string
  proxyUrl?: string
  timeoutMs?: number
}

const DEFAULT_TEST_TIMEOUT_MS = 30_000

/**
 * Sends the smallest useful request to verify Base URL + API key + model.
 *
 * OpenAI-compatible endpoints use a 1-token chat/responses call, which works
 * for gateways that do not implement GET /models. When a local proxy is
 * configured the request goes through it, so the test exercises the same path
 * as a real run (CORS, token, host allowlist).
 */
export async function testModelConnection({
  fetcher = fetch,
  modelConfig,
  proxyToken,
  proxyUrl,
  timeoutMs = DEFAULT_TEST_TIMEOUT_MS,
}: ModelConnectionTestOptions): Promise<ModelConnectionTestResult> {
  const baseUrl = modelConfig.baseUrl.trim()
  const apiKey = modelConfig.apiKey.trim()
  const model = modelConfig.model.trim()

  if (!baseUrl || !apiKey || !model) {
    return { ok: false, message: 'Base URL, API key and model are required.' }
  }

  try {
    const response = await withModelRequestTimeout(
      async (signal) => {
        if (isGeminiProvider(modelConfig.provider)) {
          const normalizedBase = normalizeBaseUrl(baseUrl)
          const modelName = model.replace(/^models\//, '')
          return fetcher(
            `${normalizedBase}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                generationConfig: { maxOutputTokens: 1 },
              }),
              signal,
            },
          )
        }

        const useResponses = isOpenAiProvider(modelConfig.provider)
        const path = useResponses ? '/responses' : '/chat/completions'
        const payload = useResponses
          ? { model, input: 'ping', max_output_tokens: 1 }
          : {
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 1,
              stream: false,
            }

        const trimmedProxy = proxyUrl?.trim()
        const url = trimmedProxy || `${normalizeBaseUrl(baseUrl)}${path}`
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (trimmedProxy) {
          if (proxyToken) {
            headers['x-proxy-token'] = proxyToken
          }
        } else {
          headers.Authorization = `Bearer ${apiKey}`
        }

        return fetcher(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            trimmedProxy
              ? { baseUrl, apiKey, path, payload }
              : payload,
          ),
          signal,
        })
      },
      { label: 'Model connection test', timeoutMs },
    )

    if (!response.ok) {
      const body = await readJsonOrUndefined(response)
      return { ok: false, message: formatApiError(response.status, body) }
    }

    await readJsonOrUndefined(response)
    return { ok: true, message: model }
  } catch (caught) {
    return {
      ok: false,
      message: caught instanceof Error ? caught.message : String(caught),
    }
  }
}
