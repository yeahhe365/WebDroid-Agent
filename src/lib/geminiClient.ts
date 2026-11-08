import { buildChatCompletionPayload, buildFinalResponsePayload } from './openAiPayload'
import { OpenAiClientError } from './openAiErrors'
import {
  extractAssistantText,
  formatApiError,
  normalizeTokenUsage,
  readJsonOrUndefined,
} from './openAiResponse'
import {
  buildRepairTask,
  fetchWithRetry,
} from './httpRetry'
import { withModelRequestTimeout } from './modelRequestTimeout'
import type {
  ChatCompletionPayload,
  ChatMessage,
  CompletionRequest,
  FinalResponseRequest,
  ModelTokenUsage,
  OpenAiClient,
  RepairActionRequest,
  UserContent,
} from './openAiTypes'
import {
  GEMINI_BASE_URL,
  toGeminiThinkingLevel,
  type GeminiContent,
  type GeminiGenerateContentRequest,
  type GeminiGenerateContentResponse,
  type GeminiPart,
} from './geminiTypes'

export const DEFAULT_GEMINI_RETRY_DELAYS_MS = [500, 1000] as const

export type GeminiClientOptions = {
  retryDelaysMs?: readonly number[]
  /** Overall request timeout; 0 disables it. Defaults to 180s. */
  timeoutMs?: number
}

export function createGeminiClient(
  fetcher: typeof fetch = fetch,
  options: GeminiClientOptions = {},
): OpenAiClient {
  async function postGemini(
    request: Pick<
      CompletionRequest,
      'baseUrl' | 'apiKey' | 'model' | 'stream' | 'signal' | 'onUsage'
    >,
    payload: ChatCompletionPayload,
  ) {
    const baseUrl = (request.baseUrl || GEMINI_BASE_URL).trim().replace(/\/+$/, '')
    const model = request.model.replace(/^models\//, '')
    const useStream = Boolean(request.stream)
    const action = useStream ? 'streamGenerateContent' : 'generateContent'
    const query = useStream ? '?alt=sse&' : '?'
    const url = `${baseUrl}/models/${model}:${action}${query}key=${encodeURIComponent(request.apiKey)}`
    const geminiPayload = convertChatPayloadToGemini(payload)

    return withModelRequestTimeout(
      async (signal) => {
        const response = await fetchWithRetry(
          fetcher,
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(geminiPayload),
          },
          {
            retryDelaysMs: options.retryDelaysMs ?? DEFAULT_GEMINI_RETRY_DELAYS_MS,
            signal,
            label: 'Gemini request',
          },
        )

        if (useStream) {
          if (!response.ok) {
            const body = await readJsonOrUndefined(response)
            throw new OpenAiClientError(formatApiError(response.status, body))
          }
          return readStreamingGeminiText(response, request.onUsage)
        }

        const body = (await readJsonOrUndefined(response)) as
          | GeminiGenerateContentResponse
          | undefined

        if (!response.ok) {
          throw new OpenAiClientError(formatApiError(response.status, body))
        }

        const text = extractGeminiText(body)
        const usage = normalizeTokenUsage(body?.usageMetadata)
        if (usage) {
          request.onUsage?.(usage)
        }
        return text
      },
      { signal: request.signal, timeoutMs: options.timeoutMs, label: 'Gemini request' },
    )
  }

  return {
    completeAction(request: CompletionRequest) {
      return postGemini(request, buildChatCompletionPayload(request))
    },
    completeFinalResponse(request: FinalResponseRequest) {
      return postGemini(request, buildFinalResponsePayload(request))
    },
    repairAction(request: RepairActionRequest) {
      return postGemini(
        { ...request, stream: false },
        buildChatCompletionPayload({
          ...request,
          stream: false,
          task: buildRepairTask(request),
        }),
      )
    },
  }
}

export function convertChatPayloadToGemini(
  payload: ChatCompletionPayload,
): GeminiGenerateContentRequest {
  const systemParts: Array<{ text: string }> = []
  const contents: GeminiContent[] = []

  for (const message of payload.messages) {
    if (message.role === 'system') {
      systemParts.push({ text: message.content })
      continue
    }
    contents.push(toGeminiContent(message))
  }

  const thinkingLevel = toGeminiThinkingLevel(payload.reasoning_effort)
  const generationConfig: GeminiGenerateContentRequest['generationConfig'] = {
    temperature: payload.temperature,
    maxOutputTokens: payload.max_tokens,
    ...(payload.response_format ? { responseMimeType: 'application/json' as const } : {}),
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  }

  return {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  }
}

function toGeminiContent(message: ChatMessage): GeminiContent {
  const role: GeminiContent['role'] = message.role === 'assistant' ? 'model' : 'user'
  return { role, parts: toGeminiParts(message.content) }
}

function toGeminiParts(content: UserContent): GeminiPart[] {
  if (typeof content === 'string') {
    return [{ text: content }]
  }
  const parts: GeminiPart[] = []
  for (const item of content) {
    if (item.type === 'text') {
      parts.push({ text: item.text })
      continue
    }
    const parsed = parseDataUrl(item.image_url.url)
    if (parsed) {
      parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } })
    }
  }
  return parts
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(url)
  if (!match) {
    return null
  }
  return { mimeType: match[1], data: match[2] }
}

function extractGeminiText(response: GeminiGenerateContentResponse | undefined): string {
  if (!response || response.error) {
    const message = response?.error?.message ?? 'No assistant content returned by model.'
    throw new OpenAiClientError(message)
  }
  const parts = response.candidates?.[0]?.content?.parts
  const text = parts?.map((part) => part.text ?? '').join('').trim()
  if (!text) {
    // Fall back to OpenAI shape in case a proxy/Gemini-OpenAI endpoint answered.
    return extractAssistantText(response)
  }
  return text
}

async function readStreamingGeminiText(
  response: Response,
  onUsage?: (usage: ModelTokenUsage) => void,
): Promise<string> {
  const body = response.body
  if (!body) {
    throw new OpenAiClientError('Model API returned an empty stream.')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      text += parseSsePart(part, onUsage)
    }
  }
  if (buffer.trim()) {
    text += parseSsePart(buffer, onUsage)
  }

  const trimmed = text.trim()
  if (!trimmed) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }
  return trimmed
}

function parseSsePart(
  part: string,
  onUsage?: (usage: ModelTokenUsage) => void,
): string {
  let text = ''
  const lines = part.split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('data:')) {
      continue
    }
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') {
      continue
    }
    try {
      const payload = JSON.parse(data) as GeminiGenerateContentResponse
      const usage = normalizeTokenUsage(payload.usageMetadata)
      if (usage) {
        onUsage?.(usage)
      }
      const parts = payload.candidates?.[0]?.content?.parts
      const chunk = parts?.map((part) => part.text ?? '').join('') ?? ''
      if (chunk) {
        text += chunk
      }
    } catch {
      // Ignore malformed keepalive events.
    }
  }
  return text
}
