import { buildChatCompletionPayload, buildFinalResponsePayload } from './openAiPayload'
import {
  extractAssistantText,
  formatApiError,
  normalizeTokenUsage,
  readJsonOrUndefined,
  readStreamingAssistantText,
} from './openAiResponse'
import { OpenAiClientError } from './openAiErrors'
import { buildRepairTask, fetchWithRetry } from './httpRetry'
import { withModelRequestTimeout } from './modelRequestTimeout'
import type {
  ChatCompletionPayload,
  FinalResponseRequest,
  CompletionRequest,
  OpenAiClient,
} from './openAiTypes'

export { buildChatCompletionPayload } from './openAiPayload'
export { OpenAiClientError } from './openAiErrors'
export { extractAssistantText } from './openAiResponse'
export {
  type AgentConversationMessage,
  type AgentHistoryItem,
  type ChatCompletionPayload,
  type ChatMessage,
  type CompletionRequest,
  type FinalResponseRequest,
  type ModelConfig,
  type OpenAiClient,
  type RepairActionRequest,
  type UserContent,
} from './openAiTypes'

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

export const DEFAULT_OPENAI_RETRY_DELAYS_MS = [500, 1000] as const

export type OpenAiClientOptions = {
  proxyUrl?: string
  /** Resolves the shared proxy token for the local Node proxy, when enabled. */
  proxyTokenProvider?: () => Promise<string | undefined>
  retryDelaysMs?: readonly number[]
  /** Overall request timeout; 0 disables it. Defaults to 180s. */
  timeoutMs?: number
}

export function createOpenAiClient(
  fetcher: typeof fetch = fetch,
  options: OpenAiClientOptions = {},
): OpenAiClient {
  async function completePayload(
    request: Pick<
      CompletionRequest,
      'baseUrl' | 'apiKey' | 'stream' | 'signal' | 'onUsage'
    >,
    payload: ChatCompletionPayload,
  ) {
    const proxyUrl = options.proxyUrl?.trim()
    const url = proxyUrl || `${normalizeBaseUrl(request.baseUrl)}/chat/completions`

    return withModelRequestTimeout(
      async (signal) => {
        const proxyToken = proxyUrl ? await options.proxyTokenProvider?.() : undefined
        const response = await fetchWithRetry(
          fetcher,
          url,
          {
            method: 'POST',
            headers: proxyUrl
              ? {
                  'Content-Type': 'application/json',
                  ...(proxyToken ? { 'x-proxy-token': proxyToken } : {}),
                }
              : {
                  Authorization: `Bearer ${request.apiKey}`,
                  'Content-Type': 'application/json',
                },
            signal,
            body: JSON.stringify(
              proxyUrl
                ? {
                    baseUrl: request.baseUrl,
                    apiKey: request.apiKey,
                    payload,
                  }
                : payload,
            ),
          },
          {
            retryDelaysMs: options.retryDelaysMs ?? DEFAULT_OPENAI_RETRY_DELAYS_MS,
            signal,
            label: 'OpenAI request',
          },
        )

        if (request.stream) {
          if (!response.ok) {
            const body = await readJsonOrUndefined(response)
            throw new OpenAiClientError(formatApiError(response.status, body))
          }
          return readStreamingAssistantText(response, request.onUsage)
        }

        const body = await readJsonOrUndefined(response)

        if (!response.ok) {
          throw new OpenAiClientError(formatApiError(response.status, body))
        }

        const text = extractAssistantText(body)
        const usage = normalizeTokenUsage(
          typeof body === 'object' && body !== null ? (body as { usage?: unknown }).usage : undefined,
        )
        if (usage) {
          request.onUsage?.(usage)
        }
        return text
      },
      { signal: request.signal, timeoutMs: options.timeoutMs, label: 'OpenAI request' },
    )
  }

  async function completeAction(request: CompletionRequest) {
    return completePayload(request, buildChatCompletionPayload(request))
  }

  async function completeFinalResponse(request: FinalResponseRequest) {
    return completePayload(request, buildFinalResponsePayload(request))
  }

  return {
    completeAction,
    completeFinalResponse,
    repairAction(request) {
      return completeAction({
        ...request,
        task: buildRepairTask(request),
        stream: false,
      })
    },
  }
}
