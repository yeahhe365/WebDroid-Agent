import type {
  OpenAiOfficialReasoningEffort,
  OpenAiReasoningMode,
  OpenAiReasoningSummary,
} from './openAiTypes'

export const OPENAI_RESPONSES_PATH = '/responses'

export type ResponsesInputTextPart = {
  type: 'input_text'
  text: string
}

export type ResponsesInputImagePart = {
  type: 'input_image'
  image_url: string
  detail?: 'auto' | 'low' | 'high' | 'original'
}

export type ResponsesInputContentPart = ResponsesInputTextPart | ResponsesInputImagePart

export type ResponsesInputMessage = {
  role: 'user' | 'assistant'
  content: string | ResponsesInputContentPart[]
}

export type ResponsesReasoningConfig = {
  effort?: OpenAiOfficialReasoningEffort
  mode?: OpenAiReasoningMode
  summary?: OpenAiReasoningSummary
  context?: 'auto' | 'current_turn' | 'all_turns'
}

export type ResponsesCreateRequest = {
  model: string
  input: string | ResponsesInputMessage[]
  instructions?: string
  temperature?: number
  max_output_tokens?: number
  stream?: boolean
  reasoning?: ResponsesReasoningConfig
  text?: {
    format?: {
      type: 'json_object' | 'text'
    }
  }
}

export type ResponsesOutputTextPart = {
  type: 'output_text'
  text?: string
}

export type ResponsesOutputMessage = {
  type: 'message'
  role?: string
  content?: Array<ResponsesOutputTextPart | { type: string; text?: string }>
}

export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | {
      type: 'reasoning'
      summary?: Array<{ type?: string; text?: string }>
    }
  | {
      type: string
      [key: string]: unknown
    }

export type ResponsesCreateResponse = {
  id?: string
  status?: string
  output_text?: string
  output?: ResponsesOutputItem[]
  incomplete_details?: {
    reason?: string
  }
  error?: {
    message?: string
    code?: string
  }
}
