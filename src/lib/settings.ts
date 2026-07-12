import {
  isOpenAiReasoningMode,
  isOpenAiReasoningSummary,
  isReasoningEffort,
  type ModelConfig,
} from './openAiTypes'
import {
  DEFAULT_ACTION_PROTOCOL,
  isActionProtocol,
  type ActionProtocol,
} from './actionProtocol'
import { isActionToolName, type ActionToolName } from './toolRegistry'
import {
  DEFAULT_QWEN_THINKING_BUDGET,
  MAX_QWEN_THINKING_BUDGET,
  MIN_QWEN_THINKING_BUDGET,
  isModelProviderPreset,
  migrateProvider,
} from './modelProviders'
import type { ExportEnvelope } from './fileExport'

export type ThemeMode = 'system' | 'light' | 'dark'
export type LanguageMode = 'system' | 'zh-CN' | 'en-US'

export type AppSettings = {
  actionProtocol: ActionProtocol
  modelConfig: ModelConfig
  maxSteps: number
  memoryEnabled: boolean
  taskNotificationsEnabled: boolean
  preferAdbKeyboard: boolean
  confirmSensitiveActions: boolean
  unrestrictedMode: boolean
  screenBlackoutDuringAutoControl: boolean
  streamResponses: boolean
  disabledActionTools: ActionToolName[]
  actionSettleMs: number
  doubleTapIntervalMs: number
  keyboardStepMs: number
  themeMode: ThemeMode
  languageMode: LanguageMode
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

export const MIN_AGENT_STEPS = 1
export const MAX_AGENT_STEPS = 500

const SETTINGS_KEY = 'webdroid-agent-settings'
// Keep the previous project keys so existing browser settings survive the rename to WebDroid Agent.
const LEGACY_PROJECT_SETTINGS_KEY = 'webadb-autoglm-settings'
const LEGACY_SETTINGS_KEY = 'webadb-demo-settings'
const LEGACY_BASE_URL_KEY = 'webadb-demo-base-url'
const LEGACY_MODEL_KEY = 'webadb-demo-model'

export const DEFAULT_SETTINGS: AppSettings = {
  actionProtocol: DEFAULT_ACTION_PROTOCOL,
  modelConfig: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5.5',
  },
  maxSteps: 150,
  memoryEnabled: false,
  taskNotificationsEnabled: false,
  preferAdbKeyboard: false,
  confirmSensitiveActions: true,
  unrestrictedMode: false,
  screenBlackoutDuringAutoControl: false,
  streamResponses: false,
  disabledActionTools: [],
  actionSettleMs: 1000,
  doubleTapIntervalMs: 100,
  keyboardStepMs: 1000,
  themeMode: 'system',
  languageMode: 'system',
}

export function loadSettings(storage: SettingsStorage = localStorage): AppSettings {
  const raw =
    storage.getItem(SETTINGS_KEY) ??
    storage.getItem(LEGACY_PROJECT_SETTINGS_KEY) ??
    storage.getItem(LEGACY_SETTINGS_KEY)
  if (raw) {
    try {
      return normalizeSettings(JSON.parse(raw))
    } catch {
      return loadLegacySettings(storage)
    }
  }

  return loadLegacySettings(storage)
}

export function saveSettings(settings: AppSettings, storage: SettingsStorage = localStorage) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)))
}

function loadLegacySettings(storage: SettingsStorage): AppSettings {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    modelConfig: {
      ...DEFAULT_SETTINGS.modelConfig,
      baseUrl: storage.getItem(LEGACY_BASE_URL_KEY) || DEFAULT_SETTINGS.modelConfig.baseUrl,
      model: storage.getItem(LEGACY_MODEL_KEY) || DEFAULT_SETTINGS.modelConfig.model,
    },
  })
}

export type SettingsExportEnvelope = ExportEnvelope<AppSettings>

export function parseSettingsImport(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS
  }

  if (value.type === 'webdroid-agent-settings' && isRecord(value.data)) {
    return normalizeSettings(value.data)
  }

  return normalizeSettings(value)
}

export function normalizeSettings(candidate: unknown): AppSettings {
  if (!isRecord(candidate)) {
    return DEFAULT_SETTINGS
  }

  const modelConfig = isRecord(candidate.modelConfig) ? candidate.modelConfig : {}
  const rawProvider = migrateProvider(modelConfig.provider)

  return {
    actionProtocol: readActionProtocol(candidate.actionProtocol, DEFAULT_SETTINGS.actionProtocol),
    modelConfig: {
      baseUrl: readString(modelConfig.baseUrl, DEFAULT_SETTINGS.modelConfig.baseUrl),
      apiKey: readString(modelConfig.apiKey, DEFAULT_SETTINGS.modelConfig.apiKey),
      model: readString(modelConfig.model, DEFAULT_SETTINGS.modelConfig.model),
      ...(isModelProviderPreset(rawProvider) ? { provider: rawProvider } : {}),
      ...(isReasoningEffort(modelConfig.reasoningEffort)
        ? { reasoningEffort: modelConfig.reasoningEffort }
        : {}),
      ...(isModelProviderPreset(rawProvider) && rawProvider === 'openai'
        ? {
            ...(isOpenAiReasoningMode(modelConfig.openaiReasoningMode)
              ? { openaiReasoningMode: modelConfig.openaiReasoningMode }
              : {}),
            ...(isOpenAiReasoningSummary(modelConfig.openaiReasoningSummary)
              ? { openaiReasoningSummary: modelConfig.openaiReasoningSummary }
              : {}),
          }
        : {}),
      ...(isModelProviderPreset(rawProvider) && rawProvider === 'qwen'
        ? {
            qwenThinkingEnabled: readBoolean(modelConfig.qwenThinkingEnabled, true),
            qwenThinkingBudget: readRangeNumber(
              modelConfig.qwenThinkingBudget,
              DEFAULT_QWEN_THINKING_BUDGET,
              MIN_QWEN_THINKING_BUDGET,
              MAX_QWEN_THINKING_BUDGET,
            ),
          }
        : {}),
    },
    maxSteps: normalizeMaxSteps(candidate.maxSteps),
    memoryEnabled: readBoolean(candidate.memoryEnabled, DEFAULT_SETTINGS.memoryEnabled),
    taskNotificationsEnabled: readBoolean(
      candidate.taskNotificationsEnabled,
      DEFAULT_SETTINGS.taskNotificationsEnabled,
    ),
    preferAdbKeyboard: readBoolean(candidate.preferAdbKeyboard, DEFAULT_SETTINGS.preferAdbKeyboard),
    confirmSensitiveActions: readBoolean(
      candidate.confirmSensitiveActions,
      DEFAULT_SETTINGS.confirmSensitiveActions,
    ),
    unrestrictedMode: readBoolean(candidate.unrestrictedMode, DEFAULT_SETTINGS.unrestrictedMode),
    screenBlackoutDuringAutoControl: readBoolean(
      candidate.screenBlackoutDuringAutoControl,
      DEFAULT_SETTINGS.screenBlackoutDuringAutoControl,
    ),
    streamResponses: readBoolean(candidate.streamResponses, DEFAULT_SETTINGS.streamResponses),
    disabledActionTools: readActionToolNames(candidate.disabledActionTools),
    actionSettleMs: readRangeNumber(candidate.actionSettleMs, DEFAULT_SETTINGS.actionSettleMs, 100, 5000),
    doubleTapIntervalMs: readRangeNumber(
      candidate.doubleTapIntervalMs,
      DEFAULT_SETTINGS.doubleTapIntervalMs,
      20,
      1000,
    ),
    keyboardStepMs: readRangeNumber(candidate.keyboardStepMs, DEFAULT_SETTINGS.keyboardStepMs, 100, 5000),
    themeMode: readThemeMode(candidate.themeMode, DEFAULT_SETTINGS.themeMode),
    languageMode: readLanguageMode(candidate.languageMode, DEFAULT_SETTINGS.languageMode),
  }
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeMaxSteps(value: unknown, fallback = DEFAULT_SETTINGS.maxSteps) {
  return Math.min(Math.max(readNumber(value, fallback), MIN_AGENT_STEPS), MAX_AGENT_STEPS)
}

function readRangeNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = readNumber(value, fallback)
  return number >= min && number <= max ? number : fallback
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark' ? value : fallback
}

function readLanguageMode(value: unknown, fallback: LanguageMode): LanguageMode {
  return value === 'system' || value === 'zh-CN' || value === 'en-US' ? value : fallback
}

function readActionProtocol(value: unknown, fallback: ActionProtocol): ActionProtocol {
  return isActionProtocol(value) ? value : fallback
}

function readActionToolNames(value: unknown): ActionToolName[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SETTINGS.disabledActionTools
  }

  return [...new Set(value.filter(isActionToolName))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
