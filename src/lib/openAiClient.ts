import type { DeviceState } from '../adapters/deviceBackend'
import type { ScreenSize } from './actions'
import { buildSystemPrompt, type PromptMode } from './prompts'
import { buildScreenshotContext } from './screenshotCoordinates'

export type ModelConfig = {
  baseUrl: string
  apiKey: string
  model: string
  stream?: boolean
}

export type CompletionRequest = ModelConfig & {
  task: string
  conversation?: readonly AgentConversationMessage[]
  screenshotDataUrl: string
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  history?: readonly AgentHistoryItem[]
  promptMode: PromptMode
}

export type AgentHistoryItem = {
  step: number
  currentApp?: string
  actionPreview: string
  executionResult?: string
}

export type AgentConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'observation'
  content: string
}

type UserContent =
  | string
  | Array<
      | {
          type: 'text'
          text: string
        }
      | {
          type: 'image_url'
          image_url: {
            url: string
          }
        }
    >

type ChatMessage =
  | {
      role: 'system'
      content: string
    }
  | {
      role: 'assistant'
      content: string
    }
  | {
      role: 'user'
      content: UserContent
    }

export type ChatCompletionPayload = {
  model: string
  temperature: number
  max_tokens: number
  stream?: boolean
  response_format?: {
    type: 'json_object'
  }
  messages: ChatMessage[]
}

export type OpenAiClient = {
  completeAction(request: CompletionRequest): Promise<string>
}

export class OpenAiClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAiClientError'
  }
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function buildChatCompletionPayload({
  model,
  task,
  conversation,
  screenshotDataUrl,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  history = [],
  promptMode,
  stream,
}: Pick<
  CompletionRequest,
  | 'model'
  | 'task'
  | 'conversation'
  | 'screenshotDataUrl'
  | 'screen'
  | 'deviceScreen'
  | 'currentApp'
  | 'deviceState'
  | 'history'
  | 'promptMode'
  | 'stream'
>): ChatCompletionPayload {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(promptMode),
    },
  ]

  const context = buildUserContext({
    task,
    screen,
    deviceScreen,
    currentApp,
    deviceState,
    history,
    promptMode,
    latestUserMessage: latestUserMessage(conversation),
  })
  const conversationMessages = conversation?.filter((message) => message.content.trim()) ?? []

  if (conversationMessages.length > 0) {
    for (const message of conversationMessages) {
      messages.push(toChatMessage(message))
    }
    const lastUserIndex = findLastUserMessageIndex(messages)
    if (lastUserIndex >= 0) {
      const lastUser = messages[lastUserIndex]
      if (lastUser.role === 'user') {
        const text = userContentText(lastUser.content)
        lastUser.content = [
          {
            type: 'text',
            text: [text, context].filter(Boolean).join('\n\n'),
          },
          {
            type: 'image_url',
            image_url: { url: screenshotDataUrl },
          },
        ]
      }
    } else {
      messages.push(multimodalUserMessage(context, screenshotDataUrl))
    }
  } else {
    messages.push(multimodalUserMessage(context, screenshotDataUrl))
  }

  const payload: ChatCompletionPayload = {
    model,
    temperature: promptMode === 'autoglm-native' ? 0 : 0.1,
    max_tokens: promptMode === 'autoglm-native' ? 3000 : 800,
    ...(stream ? { stream: true } : {}),
    messages,
  }

  if (promptMode === 'canonical-json') {
    payload.response_format = { type: 'json_object' }
  }

  return payload
}

function buildUserContext({
  task,
  screen,
  deviceScreen,
  currentApp,
  deviceState,
  history,
  promptMode,
  latestUserMessage,
}: Pick<
  CompletionRequest,
  | 'task'
  | 'screen'
  | 'deviceScreen'
  | 'currentApp'
  | 'deviceState'
  | 'history'
  | 'promptMode'
> & {
  latestUserMessage?: string
}) {
  const historyEntries = history ?? []
  const screenInfo = JSON.stringify({
    current_app: currentApp ?? deviceState?.app ?? 'Unknown',
    ...(deviceState?.packageName ? { package_name: deviceState.packageName } : {}),
    ...(deviceState?.activity ? { activity: deviceState.activity } : {}),
    ...(deviceState?.orientation ? { orientation: deviceState.orientation } : {}),
    ...(deviceState?.keyboard ? { keyboard: deviceState.keyboard } : {}),
    ...(promptMode === 'autoglm-native'
      ? {
          screen_size: `${screen.width}x${screen.height}`,
          coordinate_mode: 'relative_0_1000',
        }
      : buildScreenshotContext({ modelScreen: screen, deviceScreen })),
  })
  const lines = [
    `Task: ${task}`,
    latestUserMessage ? `Latest user message: ${latestUserMessage}` : null,
    `Screen Info: ${screenInfo}`,
    'Treat the latest user message as the current instruction. Use earlier messages and observations only as context.',
    promptMode === 'autoglm-native'
      ? 'Coordinates in actions should use Open-AutoGLM relative coordinates from 0 to 1000.'
      : 'Coordinates use pixels in the attached screenshot. Use numeric x/y labels on major grid lines as anchors; do not answer with grid-cell numbers. Your screenshot coordinates are mapped back to native device pixels before execution.',
  ].filter(Boolean) as string[]

  if (historyEntries.length > 0) {
    lines.push('Previous steps:')
    for (const item of historyEntries.slice(-12)) {
      lines.push(
        [
          `Step ${item.step}`,
          item.currentApp ? `app=${item.currentApp}` : null,
          `action=${item.actionPreview}`,
          item.executionResult ? `result=${item.executionResult}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
      )
    }
  }

  return lines.join('\n')
}

function multimodalUserMessage(text: string, screenshotDataUrl: string): ChatMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'image_url',
        image_url: { url: screenshotDataUrl },
      },
    ],
  }
}

function toChatMessage(message: AgentConversationMessage): ChatMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
    }
  }

  if (message.role === 'observation') {
    return {
      role: 'user',
      content: `<observation>\n${message.content}\n</observation>`,
    }
  }

  return {
    role: 'user',
    content: message.content,
  }
}

function findLastUserMessageIndex(messages: readonly ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index
    }
  }
  return -1
}

function latestUserMessage(conversation?: readonly AgentConversationMessage[]) {
  if (!conversation) {
    return undefined
  }
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    if (message.role === 'user' && message.content.trim()) {
      return message.content.trim()
    }
  }
  return undefined
}

function userContentText(content: UserContent) {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

export function extractAssistantText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }

  const content = response.choices[0]?.message?.content
  if (typeof content === 'string' && content.trim()) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    if (text) {
      return text
    }
  }

  throw new OpenAiClientError('No assistant content returned by model.')
}

export function createOpenAiClient(fetcher: typeof fetch = fetch): OpenAiClient {
  return {
    async completeAction(request) {
      const url = `${normalizeBaseUrl(request.baseUrl)}/chat/completions`
      const payload = buildChatCompletionPayload(request)
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (request.stream) {
        if (!response.ok) {
          const body = await readJsonOrUndefined(response)
          throw new OpenAiClientError(formatApiError(response.status, body))
        }
        return readStreamingAssistantText(response)
      }

      const body = await readJsonOrUndefined(response)

      if (!response.ok) {
        throw new OpenAiClientError(formatApiError(response.status, body))
      }

      return extractAssistantText(body)
    },
  }
}

async function readJsonOrUndefined(response: Response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function readStreamingAssistantText(response: Response) {
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
      text += parseSsePart(part)
    }
  }

  if (buffer.trim()) {
    text += parseSsePart(buffer)
  }

  const trimmed = text.trim()
  if (!trimmed) {
    throw new OpenAiClientError('No assistant content returned by model.')
  }
  return trimmed
}

function parseSsePart(part: string) {
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
      const payload = JSON.parse(data)
      const delta = payload?.choices?.[0]?.delta?.content
      const message = payload?.choices?.[0]?.message?.content
      if (typeof delta === 'string') {
        text += delta
      } else if (typeof message === 'string') {
        text += message
      }
    } catch {
      // Ignore malformed keepalive events.
    }
  }
  return text
}

function formatApiError(status: number, body: unknown) {
  if (isRecord(body)) {
    const error = body.error
    if (isRecord(error) && typeof error.message === 'string') {
      return `Model API failed with ${status}: ${error.message}`
    }
  }
  return `Model API failed with ${status}.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
