import { OpenAiClientError } from './openAiErrors'
import type { ModelTokenUsage } from './openAiTypes'

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

export function normalizeTokenUsage(raw: unknown): ModelTokenUsage | undefined {
  if (!isRecord(raw)) {
    return undefined
  }

  const input = readTokenCount(raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount)
  const output = readTokenCount(
    raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount,
  )
  const total = readTokenCount(raw.total_tokens ?? raw.totalTokenCount) ?? (
    input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined
  )
  if (total === undefined || total <= 0) {
    return undefined
  }

  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    totalTokens: total,
  }
}

function readTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

export async function readJsonOrUndefined(response: Response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export async function readStreamingAssistantText(
  response: Response,
  onUsage?: (usage: ModelTokenUsage) => void,
) {
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

export function formatApiError(status: number, body: unknown) {
  if (isRecord(body)) {
    const error = body.error
    if (isRecord(error) && typeof error.message === 'string') {
      return `Model API failed with ${status}: ${error.message}`
    }
  }
  return `Model API failed with ${status}.`
}

function parseSsePart(
  part: string,
  onUsage?: (usage: ModelTokenUsage) => void,
) {
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
      const usage = normalizeTokenUsage(payload?.usage)
      if (usage) {
        onUsage?.(usage)
      }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
