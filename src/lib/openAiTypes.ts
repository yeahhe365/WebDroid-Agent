import type { DeviceScreenTree, DeviceState, InstalledApp } from '../adapters/deviceTypes'
import type { ActionProtocol } from './actionProtocol'
import type { CustomToolDescriptor, SecretDescriptor } from './agentResources'
import type { ModelProviderPreset } from './modelProviders'
import type { ScreenSize } from './actionTypes'
import type { ActionToolSignature } from './toolRegistry'

export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

/** GPT-5.6 series efforts for the official OpenAI Responses API. */
export const OPENAI_OFFICIAL_REASONING_EFFORT_VALUES = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]
export type OpenAiOfficialReasoningEffort =
  (typeof OPENAI_OFFICIAL_REASONING_EFFORT_VALUES)[number]

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === 'string' &&
    REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)
  )
}

export function isOpenAiOfficialReasoningEffort(
  value: unknown,
): value is OpenAiOfficialReasoningEffort {
  return (
    typeof value === 'string' &&
    OPENAI_OFFICIAL_REASONING_EFFORT_VALUES.includes(
      value as OpenAiOfficialReasoningEffort,
    )
  )
}

export const OPENAI_REASONING_MODE_VALUES = ['standard', 'pro'] as const
export type OpenAiReasoningMode = (typeof OPENAI_REASONING_MODE_VALUES)[number]

export function isOpenAiReasoningMode(value: unknown): value is OpenAiReasoningMode {
  return (
    typeof value === 'string' &&
    OPENAI_REASONING_MODE_VALUES.includes(value as OpenAiReasoningMode)
  )
}

export const OPENAI_REASONING_SUMMARY_VALUES = ['auto', 'concise', 'detailed'] as const
export type OpenAiReasoningSummary = (typeof OPENAI_REASONING_SUMMARY_VALUES)[number]

export function isOpenAiReasoningSummary(
  value: unknown,
): value is OpenAiReasoningSummary {
  return (
    typeof value === 'string' &&
    OPENAI_REASONING_SUMMARY_VALUES.includes(value as OpenAiReasoningSummary)
  )
}

export type ModelConfig = {
  baseUrl: string
  apiKey: string
  model: string
  provider?: ModelProviderPreset
  reasoningEffort?: ReasoningEffort
  /** Official OpenAI Responses API reasoning.mode (standard | pro). */
  openaiReasoningMode?: OpenAiReasoningMode
  /** Official OpenAI Responses API reasoning.summary. */
  openaiReasoningSummary?: OpenAiReasoningSummary
  qwenThinkingEnabled?: boolean
  qwenThinkingBudget?: number
  stream?: boolean
}

export type CompletionRequest = ModelConfig & {
  actionProtocol?: ActionProtocol
  task: string
  conversation?: readonly AgentConversationMessage[]
  screenshotDataUrl: string
  recalledScreenshots?: readonly PromptScreenshotAttachment[]
  screen: ScreenSize
  deviceScreen?: ScreenSize
  currentApp?: string
  deviceState?: DeviceState
  screenTree?: DeviceScreenTree
  history?: readonly AgentHistoryItem[]
  appCard?: string
  installedApps?: readonly InstalledApp[]
  memoryEnabled?: boolean
  memoryItems?: readonly string[]
  actionTools?: Record<string, ActionToolSignature>
  promptContext?: string
  customTools?: readonly CustomToolDescriptor[]
  secrets?: readonly SecretDescriptor[]
  unrestrictedMode?: boolean
  signal?: AbortSignal
}

export type PromptScreenshotAttachment = {
  label: string
  dataUrl: string
  screen: ScreenSize
  step?: number
  currentApp?: string
}

export type FinalResponseRequest = ModelConfig & {
  task: string
  conversation?: readonly AgentConversationMessage[]
  history?: readonly AgentHistoryItem[]
  currentApp?: string
  deviceState?: DeviceState
  progressSummary?: string
  signal?: AbortSignal
}

export type RepairActionRequest = CompletionRequest & {
  invalidOutput: string
  validationError: string
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

export type UserContent =
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

export type ChatMessage =
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
  reasoning_effort?: ReasoningEffort
  enable_thinking?: boolean
  thinking_budget?: number
  stream?: boolean
  response_format?: {
    type: 'json_object'
  }
  messages: ChatMessage[]
}

export type OpenAiClient = {
  completeAction(request: CompletionRequest): Promise<string>
  completeFinalResponse?(request: FinalResponseRequest): Promise<string>
  repairAction?(request: RepairActionRequest): Promise<string>
}
