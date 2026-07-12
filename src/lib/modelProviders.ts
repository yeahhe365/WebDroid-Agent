export const DEFAULT_QWEN_THINKING_BUDGET = 300
export const MIN_QWEN_THINKING_BUDGET = 1
export const MAX_QWEN_THINKING_BUDGET = 38912

export const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_OFFICIAL_DEFAULT_MODEL = 'gpt-5.6'

export const MODEL_PROVIDER_PRESETS = {
  custom: null,
  openai: {
    baseUrl: OPENAI_OFFICIAL_BASE_URL,
    model: OPENAI_OFFICIAL_DEFAULT_MODEL,
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.5-flash',
  },
} as const

export type ModelProviderPreset = keyof typeof MODEL_PROVIDER_PRESETS

export function isModelProviderPreset(value: unknown): value is ModelProviderPreset {
  return typeof value === 'string' && value in MODEL_PROVIDER_PRESETS
}

/** Map legacy provider identifiers to their current names. */
const PROVIDER_MIGRATIONS: Record<string, ModelProviderPreset> = {
  qwen3_7_plus: 'qwen',
}

export function migrateProvider(value: unknown): unknown {
  return typeof value === 'string' && value in PROVIDER_MIGRATIONS
    ? PROVIDER_MIGRATIONS[value]
    : value
}

export function isOpenAiProvider(provider: unknown) {
  return provider === 'openai'
}

export function isQwenProvider(provider: unknown) {
  return provider === 'qwen'
}

export function isQwenModel(model: string) {
  return model.trim().toLowerCase() === MODEL_PROVIDER_PRESETS.qwen.model
}

/**
 * Resolve a provider preset from a model config, falling back to 'custom'.
 * Used to keep the provider dropdown in sync when baseUrl/model are edited.
 */
export function inferProviderPreset(baseUrl: string, model: string): ModelProviderPreset {
  const normalizedUrl = baseUrl.trim()
  const normalizedModel = model.trim()
  for (const key of Object.keys(MODEL_PROVIDER_PRESETS) as ModelProviderPreset[]) {
    if (key === 'custom') {
      continue
    }
    const preset = MODEL_PROVIDER_PRESETS[key]
    if (preset && preset.baseUrl === normalizedUrl && preset.model === normalizedModel) {
      return key
    }
  }
  return 'custom'
}
