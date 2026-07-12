import type { ReasoningEffort } from './openAiTypes'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }

export type GeminiSystemInstruction = {
  parts: Array<{ text: string }>
}

export type GeminiThinkingConfig = {
  thinkingLevel?: GeminiThinkingLevel
  thinkingBudget?: number
}

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export type GeminiGenerationConfig = {
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: 'application/json' | 'text/plain'
  thinkingConfig?: GeminiThinkingConfig
}

export type GeminiGenerateContentRequest = {
  contents: GeminiContent[]
  systemInstruction?: GeminiSystemInstruction
  generationConfig?: GeminiGenerationConfig
}

export type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
    finishReason?: string
  }>
  error?: {
    message?: string
    code?: number
  }
}

export function isGeminiProvider(provider: unknown): boolean {
  return provider === 'gemini'
}

export function toGeminiThinkingLevel(effort: ReasoningEffort | undefined): GeminiThinkingLevel | undefined {
  if (!effort || effort === 'none') {
    return 'minimal'
  }
  const map: Record<Exclude<ReasoningEffort, 'none'>, GeminiThinkingLevel> = {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'high',
    max: 'high',
  }
  return map[effort as Exclude<ReasoningEffort, 'none'>]
}
