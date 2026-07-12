import { buildChatCompletionPayload, buildFinalResponsePayload } from './openAiPayload'
import { OpenAiClientError } from './openAiErrors'
import {
  formatApiError,
  readJsonOrUndefined,
} from './openAiResponse'
import { buildRepairTask, fetchWithRetry } from './httpRetry'
import { normalizeBaseUrl } from './openAiClient'
import type {
  ChatCompletionPayload,
  ChatMessage,
  CompletionRequest,
  FinalResponseRequest,
  OpenAiClient,
  RepairActionRequest,
  UserContent,
} from './openAiTypes'
import {
  isOpenAiOfficialReasoningEffort,
  type OpenAiOfficialReasoningEffort,
  type OpenAiReasoningMode,
  type OpenAiReasoningSummary,
} from './openAiTypes'
import {
  OPENAI_RESPONSES_PATH,
  type ResponsesCreateRequest,
  type ResponsesCreateResponse,
  type ResponsesInputContentPart,
  type ResponsesInputMessage,
  type ResponsesReasoningConfig,
} from './openAiResponsesTypes'

export const DEFAULT_OPENAI_RESPONSES_RETRY_DELAYS_MS = [500, 1000] as const

export type OpenAiResponsesClientOptions = {
  proxyUrl?: string
  retryDelaysMs?: readonly number[]
}

export function createOpenAiResponsesClient(
  fetcher: typeof fetch = fetch,
  options: OpenAiResponsesClientOptions = {},
): OpenAiClient {
  async function postResponses(
    request: Pick<
      CompletionRequest,
      | 'baseUrl'
      | 'apiKey'
      | 'stream'
      | 'signal'
      | 'reasoningEffort'
      | 'openaiReasoningMode'
      | 'openaiReasoningSummary'
    >,
    chatPayload: ChatCompletionPayload,
  ) {
    const proxyUrl = options.proxyUrl?.trim()
    const url = proxyUrl || `${normalizeBaseUrl(request.baseUrl)}${OPENAI_RESPONSES_PATH}`
    const payload = convertChatPayloadToResponses(chatPayload, {
      reasoningMode: request.openaiReasoningMode,
      reasoningSummary: request.openaiReasoningSummary,
    })

    const response = await fetchWithRetry(
      fetcher,
      url,
      {
        method: 'POST',
        headers: proxyUrl
          ? {
              'Content-Type': 'application/json',
            }
          : {
              Authorization: `Bearer ${request.apiKey}`,
              'Content-Type': 'application/json',
            },
        signal: request.signal,
        body: JSON.stringify(
          proxyUrl
            ? {
                baseUrl: request.baseUrl,
                apiKey: request.apiKey,
                path: OPENAI_RESPONSES_PATH,
                payload,
              }
            : payload,
        ),
      },
      {
        retryDelaysMs: options.retryDelaysMs ?? DEFAULT_OPENAI_RESPONSES_RETRY_DELAYS_MS,
        signal: request.signal,
        label: 'OpenAI Responses request',
      },
    )

    if (request.stream) {
      if (!response.ok) {
        const body = await readJsonOrUndefined(response)
        throw new OpenAiClientError(formatApiError(response.status, body))
      }
      return readStreamingResponsesText(response)
    }

    const body = (await readJsonOrUndefined(response)) as ResponsesCreateResponse | undefined

    if (!response.ok) {
      throw new OpenAiClientError(formatApiError(response.status, body))
    }

    return extractResponsesText(body)
  }

  return {
    completeAction(request: CompletionRequest) {
      return postResponses(request, buildChatCompletionPayload(request))
    },
    completeFinalResponse(request: FinalResponseRequest) {
      return postResponses(request, buildFinalResponsePayload(request))
    },
    repairAction(request: RepairActionRequest) {
      return postResponses(
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

export function convertChatPayloadToResponses(
  payload: ChatCompletionPayload,
  options: {
    reasoningMode?: OpenAiReasoningMode
    reasoningSummary?: OpenAiReasoningSummary
  } = {},
): ResponsesCreateRequest {
  const instructionParts: string[] = []
  const input: ResponsesInputMessage[] = []

  for (const message of payload.messages) {
    if (message.role === 'system') {
      if (message.content.trim()) {
        instructionParts.push(message.content)
      }
      continue
    }
    input.push(toResponsesInputMessage(message))
  }

  const reasoning = buildResponsesReasoning({
    effort: payload.reasoning_effort,
    mode: options.reasoningMode,
    summary: options.reasoningSummary,
  })

  return {
    model: payload.model,
    input,
    ...(instructionParts.length > 0
      ? { instructions: instructionParts.join('\n\n') }
      : {}),
    temperature: payload.temperature,
    max_output_tokens: payload.max_tokens,
    ...(reasoning ? { reasoning } : {}),
    ...(payload.response_format?.type === 'json_object'
      ? { text: { format: { type: 'json_object' as const } } }
      : {}),
    ...(payload.stream ? { stream: true } : {}),
  }
}

function buildResponsesReasoning({
  effort,
  mode,
  summary,
}: {
  effort?: ChatCompletionPayload['reasoning_effort']
  mode?: OpenAiReasoningMode
  summary?: OpenAiReasoningSummary
}): ResponsesReasoningConfig | undefined {
  const reasoning: ResponsesReasoningConfig = {}

  const mappedEffort = mapToOpenAiOfficialEffort(effort)
  if (mappedEffort) {
    reasoning.effort = mappedEffort
  }
  if (mode === 'pro') {
    reasoning.mode = 'pro'
  }
  if (summary) {
    reasoning.summary = summary
  }

  return Object.keys(reasoning).length > 0 ? reasoning : undefined
}

/** Map generic reasoning efforts onto GPT-5.6 Responses API values. */
export function mapToOpenAiOfficialEffort(
  effort: ChatCompletionPayload['reasoning_effort'] | undefined,
): OpenAiOfficialReasoningEffort | undefined {
  if (!effort) {
    return undefined
  }
  if (effort === 'minimal') {
    return 'low'
  }
  if (isOpenAiOfficialReasoningEffort(effort)) {
    return effort
  }
  return undefined
}

function toResponsesInputMessage(message: ChatMessage): ResponsesInputMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : userContentToText(message.content),
    }
  }

  return {
    role: 'user',
    content: toResponsesUserContent(message.content),
  }
}

function toResponsesUserContent(
  content: UserContent,
): string | ResponsesInputContentPart[] {
  if (typeof content === 'string') {
    return content
  }

  const parts: ResponsesInputContentPart[] = []
  for (const item of content) {
    if (item.type === 'text') {
      parts.push({ type: 'input_text', text: item.text })
      continue
    }
    parts.push({
      type: 'input_image',
      image_url: item.image_url.url,
      detail: 'auto',
    })
  }
  return parts
}

function userContentToText(content: UserContent) {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

export function extractResponsesText(response: ResponsesCreateResponse | undefined): string {
  if (!response) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }
  if (response.error?.message) {
    throw new OpenAiClientError(response.error.message)
  }
  if (
    response.status === 'incomplete' &&
    response.incomplete_details?.reason === 'max_output_tokens'
  ) {
    const partial = collectOutputText(response)
    if (partial) {
      return partial
    }
    throw new OpenAiClientError(
      'Model ran out of tokens during reasoning before producing a visible response.',
    )
  }

  const text = collectOutputText(response)
  if (!text) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }
  return text
}

function collectOutputText(response: ResponsesCreateResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim()
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  const chunks: string[] = []
  for (const item of response.output) {
    if (!item || typeof item !== 'object') {
      continue
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) {
      continue
    }
    for (const part of item.content) {
      if (
        part &&
        typeof part === 'object' &&
        (part.type === 'output_text' || part.type === 'text') &&
        typeof part.text === 'string'
      ) {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('').trim()
}

export async function readStreamingResponsesText(response: Response): Promise<string> {
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
      text += parseResponsesSsePart(part)
    }
  }
  if (buffer.trim()) {
    text += parseResponsesSsePart(buffer)
  }

  const trimmed = text.trim()
  if (!trimmed) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }
  return trimmed
}

function parseResponsesSsePart(part: string): string {
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
      const event = JSON.parse(data) as {
        type?: string
        delta?: string
        text?: string
      }
      if (
        event.type === 'response.output_text.delta' &&
        typeof event.delta === 'string'
      ) {
        text += event.delta
        continue
      }
      // Some gateways may still emit chat-completions style chunks.
      if (typeof event.delta === 'string' && event.type?.includes('delta')) {
        text += event.delta
      }
    } catch {
      // Ignore malformed keepalive events.
    }
  }
  return text
}
