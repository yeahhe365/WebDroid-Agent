import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  parseSettingsImport,
  saveSettings,
  type AppSettings,
  type SettingsStorage,
  createSettingsExportData,
  mergeImportedSettings,
} from './settings'

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const values = { ...initial }
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value
    }),
  }
}

describe('settings persistence', () => {
  it('uses gpt-5.5 as the default model', () => {
    expect(DEFAULT_SETTINGS.modelConfig.model).toBe('gpt-5.5')
  })

  it('loads defaults when no persisted settings exist', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('loads all persisted setting fields', () => {
    const persisted: AppSettings = {
      actionProtocol: 'webdroid_json',
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'custom-model',
        provider: 'qwen',
        reasoningEffort: 'high',
        qwenThinkingEnabled: true,
        qwenThinkingBudget: 8192,
      },
      maxSteps: 12,
      memoryEnabled: true,
      taskNotificationsEnabled: true,
      preferAdbKeyboard: true,
      confirmSensitiveActions: false,
      unrestrictedMode: true,
      screenBlackoutDuringAutoControl: true,
      streamResponses: true,
      disabledActionTools: ['tap', 'open_url'],
      actionSettleMs: 350,
      doubleTapIntervalMs: 75,
      keyboardStepMs: 450,
      themeMode: 'dark',
      languageMode: 'zh-CN',
    }

    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify(persisted),
        }),
      ),
    ).toEqual(persisted)
  })

  it('loads the normalized JSON action protocol from persisted settings', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            actionProtocol: 'webdroid_normalized_json',
          }),
        }),
      ).actionProtocol,
    ).toBe('webdroid_normalized_json')
  })

  it('keeps old individual keys as migration fallback', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webadb-demo-base-url': 'https://old.example.com/v1',
          'webadb-demo-model': 'old-model',
        }),
      ).modelConfig,
    ).toEqual({
      baseUrl: 'https://old.example.com/v1',
      apiKey: '',
      model: 'old-model',
    })
  })

  it('saves all settings under one key', () => {
    const storage = memoryStorage()
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      modelConfig: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
      },
    }

    saveSettings(settings, storage)

    expect(storage.setItem).toHaveBeenCalledWith('webdroid-agent-settings', JSON.stringify(settings))
  })

  it('normalizes Qwen thinking settings with explicit defaults', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            modelConfig: {
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              apiKey: 'sk-test',
              model: 'qwen3.7-plus',
              provider: 'qwen',
              qwenThinkingEnabled: true,
              qwenThinkingBudget: 8192,
            },
          }),
        }),
      ).modelConfig,
    ).toEqual({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test',
      model: 'qwen3.7-plus',
      provider: 'qwen',
      qwenThinkingEnabled: true,
      qwenThinkingBudget: 8192,
    })

    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            modelConfig: {
              ...DEFAULT_SETTINGS.modelConfig,
              provider: 'qwen',
              qwenThinkingEnabled: 'yes',
              qwenThinkingBudget: -1,
            },
          }),
        }),
      ).modelConfig,
    ).toEqual({
      ...DEFAULT_SETTINGS.modelConfig,
      provider: 'qwen',
      qwenThinkingEnabled: true,
      qwenThinkingBudget: 300,
    })
  })

  it('migrates the legacy qwen3_7_plus provider identifier to qwen', () => {
    const result = loadSettings(
      memoryStorage({
        'webdroid-agent-settings': JSON.stringify({
          ...DEFAULT_SETTINGS,
          modelConfig: {
            ...DEFAULT_SETTINGS.modelConfig,
            provider: 'qwen3_7_plus',
            qwenThinkingEnabled: true,
            qwenThinkingBudget: 8192,
          },
        }),
      }),
    )

    expect(result.modelConfig.provider).toBe('qwen')
    expect(result.modelConfig.qwenThinkingEnabled).toBe(true)
    expect(result.modelConfig.qwenThinkingBudget).toBe(8192)
  })

  it('persists official OpenAI reasoning mode and summary settings', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            modelConfig: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test',
              model: 'gpt-5.6',
              provider: 'openai',
              reasoningEffort: 'max',
              openaiReasoningMode: 'pro',
              openaiReasoningSummary: 'detailed',
            },
          }),
        }),
      ).modelConfig,
    ).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5.6',
      provider: 'openai',
      reasoningEffort: 'max',
      openaiReasoningMode: 'pro',
      openaiReasoningSummary: 'detailed',
    })
  })

  it('drops official OpenAI reasoning extras when provider is not openai', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            modelConfig: {
              ...DEFAULT_SETTINGS.modelConfig,
              provider: 'custom',
              openaiReasoningMode: 'pro',
              openaiReasoningSummary: 'auto',
            },
          }),
        }),
      ).modelConfig,
    ).toEqual({
      ...DEFAULT_SETTINGS.modelConfig,
      provider: 'custom',
    })
  })

  it('normalizes new optimization settings when they are missing or invalid', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            modelConfig: {
              ...DEFAULT_SETTINGS.modelConfig,
              reasoningEffort: 'deep',
            },
            actionProtocol: 'invalid-protocol',
            promptMode: 'invalid-mode',
            memoryEnabled: 'yes',
            taskNotificationsEnabled: 'yes',
            screenBlackoutDuringAutoControl: 'yes',
            streamResponses: 'yes',
            disabledActionTools: ['tap', 'not-a-real-tool', 'tap'],
            actionSettleMs: -1,
            doubleTapIntervalMs: 10000,
            keyboardStepMs: Number.NaN,
            themeMode: 'blue',
            languageMode: 'klingon',
          }),
        }),
      ),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      disabledActionTools: ['tap'],
    })
  })

  it('drops the removed AutoGLM native prompt mode from persisted settings', () => {
    const loaded = loadSettings(
      memoryStorage({
        'webdroid-agent-settings': JSON.stringify({
          ...DEFAULT_SETTINGS,
          promptMode: 'autoglm-native',
        }),
      }),
    )

    expect(loaded).not.toHaveProperty('promptMode')
  })

  it('keeps large max step values but still enforces the minimum', () => {
    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            maxSteps: 500,
          }),
        }),
      ).maxSteps,
    ).toBe(500)

    expect(
      loadSettings(
        memoryStorage({
          'webdroid-agent-settings': JSON.stringify({
            ...DEFAULT_SETTINGS,
            maxSteps: 0,
          }),
        }),
      ).maxSteps,
    ).toBe(1)
  })

  it('keeps the previous WebADB AutoGLM settings key as a migration fallback', () => {
    const persisted: AppSettings = {
      ...DEFAULT_SETTINGS,
      maxSteps: 12,
    }

    expect(
      loadSettings(
        memoryStorage({
          'webadb-autoglm-settings': JSON.stringify(persisted),
        }),
      ),
    ).toEqual(persisted)
  })

  it('keeps old combined settings key as a migration fallback', () => {
    const persisted: AppSettings = {
      ...DEFAULT_SETTINGS,
      maxSteps: 24,
    }

    expect(
      loadSettings(
        memoryStorage({
          'webadb-demo-settings': JSON.stringify(persisted),
        }),
      ),
    ).toEqual(persisted)
  })
})

describe('settings import', () => {
  it('normalizes unknown values back to defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ maxSteps: 'bad' })).toEqual(DEFAULT_SETTINGS)
  })

  it('parses a wrapped settings envelope', () => {
    const persisted: AppSettings = { ...DEFAULT_SETTINGS, maxSteps: 80 }
    const parsed = parseSettingsImport({
      type: 'webdroid-agent-settings',
      version: 1,
      exportedAt: 1000,
      data: persisted,
    })
    expect(parsed).toEqual(persisted)
  })

  it('tolerates a bare settings object without an envelope', () => {
    const persisted: AppSettings = { ...DEFAULT_SETTINGS, maxSteps: 33 }
    expect(parseSettingsImport(persisted)).toEqual(persisted)
  })

  it('returns defaults for garbage input', () => {
    expect(parseSettingsImport('not-an-object')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettingsImport({ type: 'unknown' })).toEqual(DEFAULT_SETTINGS)
  })
})


describe('settings export and import safety', () => {
  const withApiKey = (apiKey: string) => ({
    ...DEFAULT_SETTINGS,
    modelConfig: { ...DEFAULT_SETTINGS.modelConfig, apiKey },
  })

  it('drops the API key from exported settings', () => {
    const exported = createSettingsExportData(withApiKey('sk-secret-value'))
    expect(exported.modelConfig.apiKey).toBe('')
    expect(JSON.stringify(exported)).not.toContain('sk-secret-value')
  })

  it('keeps the local API key when the imported file carries none', () => {
    const merged = mergeImportedSettings(withApiKey('sk-local'), withApiKey(''))
    expect(merged.modelConfig.apiKey).toBe('sk-local')
  })

  it('accepts an API key supplied by the imported file', () => {
    const merged = mergeImportedSettings(withApiKey('sk-local'), withApiKey('sk-imported'))
    expect(merged.modelConfig.apiKey).toBe('sk-imported')
  })

  it('can never enable unrestricted mode through an import', () => {
    const current = { ...DEFAULT_SETTINGS, unrestrictedMode: false }
    const imported = { ...DEFAULT_SETTINGS, unrestrictedMode: true }
    expect(mergeImportedSettings(current, imported).unrestrictedMode).toBe(false)
  })

  it('can never disable sensitive-action confirmation through an import', () => {
    const current = { ...DEFAULT_SETTINGS, confirmSensitiveActions: true }
    const imported = { ...DEFAULT_SETTINGS, confirmSensitiveActions: false }
    expect(mergeImportedSettings(current, imported).confirmSensitiveActions).toBe(true)
  })

  it('still applies ordinary fields from the imported file', () => {
    const current = { ...DEFAULT_SETTINGS, maxSteps: 150, themeMode: 'light' as const }
    const imported = { ...DEFAULT_SETTINGS, maxSteps: 42, themeMode: 'dark' as const }
    const merged = mergeImportedSettings(current, imported)
    expect(merged.maxSteps).toBe(42)
    expect(merged.themeMode).toBe('dark')
  })
})


describe('settings storage failures', () => {
  const throwingStorage = (): SettingsStorage => ({
    getItem: vi.fn(() => {
      throw new Error('SecurityError: storage is disabled')
    }),
    setItem: vi.fn(() => {
      throw new Error('QuotaExceededError')
    }),
  })

  it('boots with defaults when reading storage throws', () => {
    expect(loadSettings(throwingStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('reports a refused write instead of throwing', () => {
    expect(saveSettings(DEFAULT_SETTINGS, throwingStorage())).toBe(false)
  })

  it('returns true when the write succeeds', () => {
    expect(saveSettings(DEFAULT_SETTINGS, memoryStorage())).toBe(true)
  })
})
