import { AlertTriangle, X } from 'lucide-react'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { LazyWebAdbDeviceBackend } from './adapters/lazyWebAdbBackend'
import type { AgentStep } from './lib/agent'
import type { AgentAction } from './lib/actionTypes'
import type { ActionProtocol } from './lib/actionProtocol'
import { createOpenAiClient } from './lib/openAiClient'
import { createOpenAiResponsesClient } from './lib/openAiResponsesClient'
import { createGeminiClient } from './lib/geminiClient'
import { isGeminiProvider } from './lib/geminiTypes'
import { isOpenAiProvider } from './lib/modelProviders'
import type { ModelConfig } from './lib/openAiTypes'
import { OPENAI_PROXY_TOKEN_URL, OPENAI_PROXY_URL } from './lib/openAiRuntimeConfig'
import { fetchProxyToken } from './lib/proxyToken'
import { APP_COPY, resolveLocale } from './lib/appCopy'
import {
  createSettingsExportData,
  loadSettings,
  mergeImportedSettings,
  normalizeMaxSteps,
  parseSettingsImport,
  type AppSettings,
} from './lib/settings'
import { createDefaultActionToolRegistry, type ActionToolName } from './lib/toolRegistry'
import { loadMemoryItems, rememberMemoryItem, saveMemoryItems } from './lib/memory'
import { downloadJsonFile, pickAndReadJsonFile } from './lib/fileExport'
import { buildTrajectoryArtifact } from './lib/trajectory'
import { parseChatHistoryImport } from './lib/agentThread'
import {
  requestTaskNotificationPermission,
  showTaskNotification,
} from './lib/taskNotifications'
import { useAgentRunController } from './hooks/useAgentRunController'
import { useConfigTargetScroll } from './hooks/useConfigTargetScroll'
import { useDeviceController } from './hooks/useDeviceController'
import { useAgentSessionHistory } from './hooks/useAgentSessionHistory'
import { useBodyOverflow } from './hooks/useBodyOverflow'
import { useHotkeys } from './hooks/useHotkeys'
import { useDialogFocusTrap } from './hooks/useDialogFocusTrap'
import { useOverlayLayer } from './hooks/useOverlayLayer'
import { useSplitPane, WORKSPACE_SPLIT_STORAGE_KEY } from './hooks/useSplitPane'
import { useBusyTask } from './hooks/useBusyTask'
import { useBusyTaskDocumentTitle } from './hooks/useBusyTaskDocumentTitle'
import { useDocumentPreferences } from './hooks/useDocumentPreferences'
import { useLocalResourcesState } from './hooks/useLocalResourcesState'
import { usePersistedSettings } from './hooks/usePersistedSettings'
import { useRepositoryStats } from './hooks/useRepositoryStats'
import { useRunLog } from './hooks/useRunLog'
import { useStorageEstimate } from './hooks/useStorageEstimate'
import { AppProvider } from './components/AppContext'
import { AppTopbar } from './components/AppTopbar'
import { focusChatComposer } from './lib/chatComposer'
import { ConfigSidebar } from './components/ConfigSidebar'
import { DeviceQuickControls } from './components/DeviceQuickControls'
import { PhoneStage } from './components/PhoneStage'
import { ConversationPanel } from './components/ConversationPanel'
import { SetupHome } from './components/SetupHome'
import type { SensitiveActionDialogRequest } from './components/SensitiveActionDialog'
import { useToasts } from './hooks/useToasts'
import { appendAuditEntry } from './lib/auditLog'
import { buildActionPreview } from './lib/actionPreview'
import { testModelConnection } from './lib/modelConnectionTest'
import { formatCurrentAppLabel } from './components/deviceDisplay'
import { UNKNOWN_APP_NAME } from './lib/deviceState'
import { lazyWithRetry } from './lib/lazyWithRetry'

function createModelClient(modelConfig: ModelConfig) {
  const proxyTokenUrl = OPENAI_PROXY_URL ? OPENAI_PROXY_TOKEN_URL : undefined
  const proxyTokenProvider = proxyTokenUrl
    ? () => fetchProxyToken(proxyTokenUrl)
    : undefined

  if (isGeminiProvider(modelConfig.provider)) {
    return createGeminiClient(globalThis.fetch)
  }
  if (isOpenAiProvider(modelConfig.provider)) {
    return createOpenAiResponsesClient(globalThis.fetch, {
      proxyUrl: OPENAI_PROXY_URL,
      proxyTokenProvider,
    })
  }
  return createOpenAiClient(globalThis.fetch, {
    proxyUrl: OPENAI_PROXY_URL,
    proxyTokenProvider,
  })
}

const SettingsDialog = lazyWithRetry(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)
const TutorialPanel = lazyWithRetry(() =>
  import('./components/TutorialPanel').then((module) => ({ default: module.TutorialPanel })),
)
const RunLog = lazyWithRetry(() =>
  import('./components/RunLog').then((module) => ({ default: module.RunLog })),
)
const SensitiveActionDialog = lazyWithRetry(() =>
  import('./components/SensitiveActionDialog').then((module) => ({
    default: module.SensitiveActionDialog,
  })),
)
const UnrestrictedModeConfirmDialog = lazyWithRetry(() =>
  import('./components/UnrestrictedModeConfirmDialog').then((module) => ({
    default: module.UnrestrictedModeConfirmDialog,
  })),
)
const ConfirmDialog = lazyWithRetry(() =>
  import('./components/ConfirmDialog').then((module) => ({ default: module.ConfirmDialog })),
)
const ToastViewport = lazyWithRetry(() =>
  import('./components/ToastViewport').then((module) => ({ default: module.ToastViewport })),
)

function App() {
  const settings = useMemo(() => loadSettings(), [])
  const [backend] = useState(() => new LazyWebAdbDeviceBackend())
  const [modelConfig, setModelConfig] = useState<ModelConfig>(settings.modelConfig)
  const client = useMemo(
    () => createModelClient(modelConfig),
    // Client type only depends on the provider; baseUrl/apiKey/model are read per-request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelConfig.provider],
  )
  const [actionProtocol, setActionProtocol] = useState<ActionProtocol>(settings.actionProtocol)
  const [disabledActionTools, setDisabledActionTools] = useState<ActionToolName[]>(
    settings.disabledActionTools,
  )
  const actionToolRegistry = useMemo(
    () => createDefaultActionToolRegistry(disabledActionTools),
    [disabledActionTools],
  )
  const {
    appCards,
    appCardsJson,
    appCardsJsonError,
    customTools,
    customToolsJson,
    customToolsJsonError,
    resetAppCards,
    secretRecords,
    secretRecordsJson,
    secretRecordsJsonError,
    updateAppCardsJson,
    updateCustomToolsJson,
    updateSecretRecordsJson,
  } = useLocalResourcesState()
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false)
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps)
  const [memoryEnabled, setMemoryEnabled] = useState(settings.memoryEnabled)
  const [memoryItems, setMemoryItems] = useState(() => loadMemoryItems())
  const [screenBlackoutDuringAutoControl, setScreenBlackoutDuringAutoControl] = useState(
    settings.screenBlackoutDuringAutoControl,
  )
  const [streamResponses, setStreamResponses] = useState(settings.streamResponses)
  const [taskNotificationsEnabled, setTaskNotificationsEnabled] = useState(
    settings.taskNotificationsEnabled,
  )
  const [themeMode, setThemeMode] = useState(settings.themeMode)
  const [languageMode, setLanguageMode] = useState(settings.languageMode)
  const activeLocale = useMemo(() => resolveLocale(languageMode), [languageMode])
  const copy = APP_COPY[activeLocale]
  const appContextValue = useMemo(() => ({ copy, locale: activeLocale }), [activeLocale, copy])
  const [configSidebarOpen, setConfigSidebarOpen] = useState(false)
  const {
    containerRef: workspaceSplitRef,
    handleProps: workspaceSplitHandleProps,
    isCustom: workspaceSplitIsCustom,
    splitPercent: workspaceSplitPercent,
  } = useSplitPane({
    ariaLabel: copy.resizePanes,
    defaultSplit: 52,
    storageKey: WORKSPACE_SPLIT_STORAGE_KEY,
  })
  const openConfigTarget = useConfigTargetScroll(configSidebarOpen, setConfigSidebarOpen)
  type WorkspaceTab = 'phone' | 'chat'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('chat')
  const [setupDismissed, setSetupDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem('webdroid-setup-dismissed') === '1'
    } catch {
      return false
    }
  })
  const dismissSetup = useCallback(() => {
    setSetupDismissed(true)
    // Setup can be taller than a phone-sized viewport; entering the workspace
    // should not inherit the setup page's scroll offset.
    try {
      // Setting the scroll roots works in browsers and stays a no-op in jsdom.
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    } catch {
      // Ignore document access failures in non-browser runtimes.
    }
    try {
      globalThis.localStorage?.setItem('webdroid-setup-dismissed', '1')
    } catch {
      // Ignore quota / private-mode failures; in-memory flag still applies.
    }
  }, [])
  const [pendingStep, setPendingStep] = useState<AgentStep | null>(null)
  const { logs, addLog, clearLogs } = useRunLog()
  const { dismissToast, pushToast, toasts } = useToasts()
  const { busyTask, error, runTask, setError } = useBusyTask(({ label, message }) => {
    // Keep task failures in the persistent banner; toasts are for short-lived
    // confirmations from explicit user actions.
    addLog({ tone: 'error', title: label, detail: message })
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [runLogOpen, setRunLogOpen] = useState(false)
  const runLogDrawerRef = useRef<HTMLElement | null>(null)
  const runLogCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const { repositoryStats, repositoryStatsStatus } = useRepositoryStats(settingsOpen)
  const { storageEstimate, storageEstimateStatus } = useStorageEstimate(settingsOpen)

  const [sensitiveActionRequest, setSensitiveActionRequest] =
    useState<SensitiveActionDialogRequest | null>(null)
  const sensitiveActionResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const requestSensitiveActionConfirmation = useCallback(
    (message: string, action: AgentAction) => {
      sensitiveActionResolverRef.current?.(false)

      return new Promise<boolean>((resolve) => {
        sensitiveActionResolverRef.current = resolve
        setSensitiveActionRequest({ action, message })
      })
    },
    [],
  )
  const settleSensitiveActionRequest = useCallback((confirmed: boolean) => {
    sensitiveActionResolverRef.current?.(confirmed)
    sensitiveActionResolverRef.current = null
    setSensitiveActionRequest(null)
    if (confirmed) {
      appendAuditEntry({ type: 'sensitive_action_confirmed', timestamp: Date.now() })
    } else {
      appendAuditEntry({ type: 'sensitive_action_cancelled', timestamp: Date.now() })
    }
  }, [])
  const resetPendingStep = useCallback(() => setPendingStep(null), [])
  const device = useDeviceController({
    addLog,
    backend,
    busyTask,
    confirmSensitiveActionRequest: requestSensitiveActionConfirmation,
    copy,
    initialSettings: settings,
    modelConfig,
    onPendingStepReset: resetPendingStep,
    runTask,
  })
  const currentAppLabel = device.currentApp
    ? formatCurrentAppLabel(device.currentApp, copy)
    : copy.unknownApp
  const {
    actionSettleMs,
    confirmSensitiveActions,
    doubleTapIntervalMs,
    keyboardStepMs,
    preferAdbKeyboard,
    unrestrictedMode,
  } = device.options

  // Unrestricted-mode enable confirmation: gate the interactive toggle behind a
  // dialog so a single checkbox click cannot silently arm autonomous execution
  // of sensitive operations. Settings imports cannot arm it at all —
  // mergeImportedSettings never enables unrestricted mode.
  const [unrestrictedConfirmOpen, setUnrestrictedConfirmOpen] = useState(false)
  const unrestrictedResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const requestUnrestrictedModeConfirmation = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      unrestrictedResolverRef.current = resolve
      setUnrestrictedConfirmOpen(true)
    })
  }, [])
  const settleUnrestrictedModeConfirmation = useCallback((confirmed: boolean) => {
    unrestrictedResolverRef.current?.(confirmed)
    unrestrictedResolverRef.current = null
    setUnrestrictedConfirmOpen(false)
  }, [])
  const handleUnrestrictedModeChange = useCallback(
    (value: boolean) => {
      if (!value) {
        appendAuditEntry({
          type: 'unrestricted_mode_disabled',
          timestamp: Date.now(),
        })
        device.actions.onUnrestrictedModeChange(false)
        return
      }
      void requestUnrestrictedModeConfirmation().then((confirmed) => {
        if (!confirmed) {
          return
        }
        appendAuditEntry({
          type: 'unrestricted_mode_enabled',
          timestamp: Date.now(),
        })
        device.actions.onUnrestrictedModeChange(true)
      })
    },
    [device.actions, requestUnrestrictedModeConfirmation],
  )
  const hasModelConfig = Boolean(modelConfig.baseUrl && modelConfig.apiKey && modelConfig.model)
  const agentReady = device.connected && hasModelConfig
  const showSetupHome = !agentReady && !setupDismissed
  const isAgentRunning = busyTask?.id === 'run-agent'
  const handleEnterWorkspace = useCallback(() => {
    dismissSetup()
    setWorkspaceTab('chat')
  }, [dismissSetup])
  const handleConfigureModelFromSetup = useCallback(() => {
    dismissSetup()
    setWorkspaceTab('chat')
    setSettingsOpen(false)
    setTutorialOpen(false)
    setRunLogOpen(false)
    openConfigTarget('model')
  }, [dismissSetup, openConfigTarget])
  const handleConfigureDeviceFromSetup = useCallback(() => {
    dismissSetup()
    setWorkspaceTab('phone')
    setSettingsOpen(false)
    setTutorialOpen(false)
    setRunLogOpen(false)
    openConfigTarget('device')
  }, [dismissSetup, openConfigTarget])
  const handleReadinessClick = useCallback(() => {
    if (agentReady) {
      return
    }
    if (showSetupHome) {
      return
    }
    if (!device.connected) {
      handleConfigureDeviceFromSetup()
      return
    }
    if (!hasModelConfig) {
      handleConfigureModelFromSetup()
    }
  }, [
    agentReady,
    device.connected,
    handleConfigureDeviceFromSetup,
    handleConfigureModelFromSetup,
    hasModelConfig,
    showSetupHome,
  ])
  const handleIrreversibleBlocked = useCallback((action: AgentAction, message: string) => {
    const detail = `${buildActionPreview(action)} — ${message}`
    appendAuditEntry({
      type: 'irreversible_action_blocked',
      timestamp: Date.now(),
      detail,
    })
  }, [])
  const currentSettings = useMemo<AppSettings>(
    () => ({
      actionProtocol,
      modelConfig,
      maxSteps,
      memoryEnabled,
      taskNotificationsEnabled,
      preferAdbKeyboard,
      confirmSensitiveActions,
      unrestrictedMode,
      screenBlackoutDuringAutoControl,
      streamResponses,
      disabledActionTools,
      actionSettleMs,
      doubleTapIntervalMs,
      keyboardStepMs,
      themeMode,
      languageMode,
    }),
    [
      actionProtocol,
      actionSettleMs,
      confirmSensitiveActions,
      disabledActionTools,
      doubleTapIntervalMs,
      keyboardStepMs,
      languageMode,
      maxSteps,
      memoryEnabled,
      modelConfig,
      preferAdbKeyboard,
      screenBlackoutDuringAutoControl,
      streamResponses,
      taskNotificationsEnabled,
      themeMode,
      unrestrictedMode,
    ],
  )
  useDocumentPreferences(themeMode, activeLocale)
  useBusyTaskDocumentTitle(busyTask)
  usePersistedSettings(currentSettings)
  const modalOverlayOpen =
    settingsOpen ||
    configSidebarOpen ||
    runLogOpen ||
    clearHistoryConfirmOpen ||
    sensitiveActionRequest !== null
  useBodyOverflow(modalOverlayOpen)
  const rememberMemory = useCallback((information: string) => {
    setMemoryItems((current) => {
      const next = rememberMemoryItem(current, information)
      saveMemoryItems(next)
      return next
    })
  }, [])
  const handleTaskNotificationsEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        setTaskNotificationsEnabled(false)
        return
      }

      const permission = await requestTaskNotificationPermission()
      const granted = permission === 'granted'
      setTaskNotificationsEnabled(granted)
      if (!granted) {
        pushToast({ tone: 'warn', title: copy.notificationPermissionDenied })
      }
    },
    [copy.notificationPermissionDenied, pushToast],
  )
  const handleRunEndNotification = useCallback(
    (notification: { title: string; detail?: string }) => {
      if (!taskNotificationsEnabled) {
        return
      }

      showTaskNotification({
        title: notification.title,
        detail: notification.detail,
      })
    },
    [taskNotificationsEnabled],
  )
  useEffect(
    () => () => {
      sensitiveActionResolverRef.current?.(false)
    },
    [],
  )

  const {
    activeThreadId,
    clearHistoryThreads,
    conversation,
    deleteHistoryThread: deleteStoredHistoryThread,
    ensureSession,
    exportChatHistory,
    importChatHistory,
    interactionItems,
    selectHistoryThread: selectStoredHistoryThread,
    sessionSummary,
    startNewSession,
    syncConversation,
    threadSummaries,
  } = useAgentSessionHistory({
    addLog,
    copy,
    currentSettings,
    initialSettings: settings,
    onSessionStateChange: device.applySessionDeviceState,
  })
  const {
    executePendingStep,
    pauseCurrentRun,
    queuedChatMessageCount,
    resumeRun,
    stopCurrentRun,
    submitChatMessage,
  } = useAgentRunController({
    actionToolRegistry,
    actionProtocol,
    addLog,
    appCards,
    backend,
    busyTask,
    canRunAgent: device.connected && hasModelConfig,
    client,
    copy,
    customTools,
    device,
    ensureSession,
    maxSteps,
    memoryEnabled,
    memoryItems,
    modelConfig,
    onMemoryItem: rememberMemory,
    onRunEndNotification: handleRunEndNotification,
    pendingStep,
    runTask,
    setError,
    setPendingStep,
    secrets: secretRecords,
    screenBlackoutDuringAutoControl,
    streamResponses,
    syncConversation,
    unrestrictedMode,
    onIrreversibleBlocked: handleIrreversibleBlocked,
  })
  const runLogLabels = useMemo(
    () => ({
      clear: copy.clear,
      closeScreenshotPreview: copy.closeScreenshotPreview,
      empty: copy.noEvents,
      emptyHint: copy.runLogIdleHint,
      executionResult: copy.stepExecutionResult,
      expandedScreenshotFor: (title: string) => `${copy.expandedAndroidScreenshot}: ${title}`,
      failureClass: copy.failureClassLabel,
      modelOutput: copy.stepModelOutput,
      openScreenshotFor: copy.openScreenshotFor,
      parsedAction: copy.stepParsedAction,
      resetScreenshotZoom: copy.resetScreenshotZoom,
      screenshotDialogFor: copy.screenshotDialogFor,
      screenshotFor: (title: string) => `${copy.androidScreenshot}: ${title}`,
      screenshotZoomControls: copy.screenshotZoomControls,
      step: (step: number) => `${copy.step} ${step}`,
      title: copy.runLog,
      zoomInScreenshot: copy.zoomInScreenshot,
      zoomOutScreenshot: copy.zoomOutScreenshot,
    }),
    [copy],
  )
  const handleTestModelConnection = useCallback(async () => {
    const proxyToken =
      OPENAI_PROXY_URL && OPENAI_PROXY_TOKEN_URL
        ? await fetchProxyToken(OPENAI_PROXY_TOKEN_URL)
        : undefined
    return testModelConnection({
      modelConfig,
      proxyToken,
      proxyUrl: OPENAI_PROXY_URL,
    })
  }, [modelConfig])

  const handleOpenConfigTarget = useCallback(
    (target: Parameters<typeof openConfigTarget>[0]) => {
      setSettingsOpen(false)
      setTutorialOpen(false)
      setRunLogOpen(false)
      setHistorySidebarOpen(false)
      openConfigTarget(target)
    },
    [openConfigTarget],
  )
  const handleToggleConfigSidebar = useCallback(() => {
    setSettingsOpen(false)
    setTutorialOpen(false)
    setRunLogOpen(false)
    setHistorySidebarOpen(false)
    setConfigSidebarOpen((current) => !current)
  }, [])
  const handleOpenConfig = useCallback(() => {
    setSettingsOpen(false)
    setTutorialOpen(false)
    setRunLogOpen(false)
    setHistorySidebarOpen(false)
    setConfigSidebarOpen((current) => !current)
  }, [])
  const handleToggleInspect = useCallback(() => {
    setSettingsOpen(false)
    setTutorialOpen(false)
    setConfigSidebarOpen(false)
    setHistorySidebarOpen(false)
    setRunLogOpen((current) => !current)
  }, [])
  const handleSelectWorkspaceTab = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab)
  }, [])

  function updateConfig<Key extends keyof ModelConfig>(key: Key, value: ModelConfig[Key]) {
    setModelConfig((current) => {
      return { ...current, [key]: value }
    })
  }

  function updateMaxSteps(value: number) {
    setMaxSteps((current) => normalizeMaxSteps(value, current))
  }

  function applySettings(next: AppSettings) {
    setModelConfig(next.modelConfig)
    setActionProtocol(next.actionProtocol)
    setDisabledActionTools(next.disabledActionTools)
    setMaxSteps(next.maxSteps)
    setMemoryEnabled(next.memoryEnabled)
    setScreenBlackoutDuringAutoControl(next.screenBlackoutDuringAutoControl)
    setStreamResponses(next.streamResponses)
    setTaskNotificationsEnabled(next.taskNotificationsEnabled)
    setThemeMode(next.themeMode)
    setLanguageMode(next.languageMode)
    device.actions.onPreferAdbKeyboardChange(next.preferAdbKeyboard)
    device.actions.onConfirmSensitiveActionsChange(next.confirmSensitiveActions)
    device.actions.onUnrestrictedModeChange(next.unrestrictedMode)
    device.actions.onActionSettleMsChange(next.actionSettleMs)
    device.actions.onDoubleTapIntervalMsChange(next.doubleTapIntervalMs)
    device.actions.onKeyboardStepMsChange(next.keyboardStepMs)
  }

  async function handleExportChatHistory() {
    const result = await exportChatHistory()
    if (!result) {
      return
    }
    downloadJsonFile('webdroid-agent-chat-history.json', {
      type: 'webdroid-agent-chat-history',
      version: 1,
      exportedAt: Date.now(),
      data: { threads: result.threads },
    })
    addLog({ tone: 'info', title: copy.chatHistoryExported(result.count) })
    pushToast({ tone: 'ok', title: copy.chatHistoryExported(result.count) })
  }

  function handleExportTrajectory() {
    const session = ensureSession()
    const lastTurn = [...session.turns].reverse().find((turn) => turn.runId)
    if (!lastTurn?.runId) {
      addLog({ tone: 'warn', title: copy.exportTrajectoryUnavailable })
      pushToast({ tone: 'warn', title: copy.exportTrajectoryUnavailable })
      return
    }
    // Neither `includeContext` nor `includeDiagnostics` is set: the file is meant
    // to be committed and shared, so prompt context and unredacted provider error
    // text stay out of it.
    downloadJsonFile(
      'webdroid-agent-trajectory.json',
      buildTrajectoryArtifact({
        thread: session,
        runId: lastTurn.runId,
        model: {
          provider: modelConfig.provider,
          model: modelConfig.model,
          actionProtocol,
        },
      }),
    )
    addLog({ tone: 'info', title: copy.trajectoryExported })
    pushToast({ tone: 'ok', title: copy.trajectoryExported })
  }

  async function handleImportChatHistory() {
    let parsed: unknown
    try {
      parsed = await pickAndReadJsonFile()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copy.importInvalidFile, detail })
      pushToast({ tone: 'warn', title: copy.importInvalidFile, detail })
      return
    }
    if (parsed === null) {
      return
    }
    const threads = parseChatHistoryImport(parsed)
    if (threads.length === 0) {
      addLog({ tone: 'warn', title: copy.importInvalidFile })
      pushToast({ tone: 'warn', title: copy.importInvalidFile })
      return
    }
    const imported = await importChatHistory(threads)
    pushToast({
      tone: imported > 0 ? 'ok' : 'warn',
      title: imported > 0 ? copy.chatHistoryImported(imported) : copy.importInvalidFile,
    })
  }

  function handleExportSettings() {
    downloadJsonFile('webdroid-agent-settings.json', {
      type: 'webdroid-agent-settings',
      version: 1,
      exportedAt: Date.now(),
      data: createSettingsExportData(currentSettings),
    })
    addLog({ tone: 'info', title: copy.settingsExported })
    pushToast({ tone: 'ok', title: copy.settingsExported })
  }

  async function handleImportSettings() {
    let parsed: unknown
    try {
      parsed = await pickAndReadJsonFile()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copy.importInvalidFile, detail })
      pushToast({ tone: 'warn', title: copy.importInvalidFile, detail })
      return
    }
    if (parsed === null) {
      return
    }
    applySettings(mergeImportedSettings(currentSettings, parseSettingsImport(parsed)))
    addLog({ tone: 'info', title: copy.settingsImported })
    pushToast({ tone: 'ok', title: copy.settingsImported })
  }

  function startNewChat() {
    setPendingStep(null)
    setHistorySidebarOpen(false)
    setWorkspaceTab('chat')
    startNewSession()
    addLog({ tone: 'info', title: copy.newChatStarted })
  }

  function requestClearChatHistory() {
    setClearHistoryConfirmOpen(true)
  }

  function handleReopenSetup() {
    setSettingsOpen(false)
    setSetupDismissed(false)
    setWorkspaceTab('chat')
    try {
      globalThis.localStorage?.removeItem('webdroid-setup-dismissed')
    } catch {
      // Ignore storage failures; the in-memory flag still reopens the wizard.
    }
  }

  function handleClearRunLog() {
    clearLogs()
    pushToast({ tone: 'info', title: copy.runLogCleared })
  }

  async function confirmClearChatHistory() {
    setClearHistoryConfirmOpen(false)
    const cleared = await clearHistoryThreads()
    if (cleared) {
      setPendingStep(null)
      setHistorySidebarOpen(false)
      pushToast({ tone: 'ok', title: copy.chatHistoryCleared })
    }
  }

  async function selectHistoryThread(threadId: string) {
    if (busyTask) {
      return
    }

    const restored = await selectStoredHistoryThread(threadId)
    if (restored) {
      setPendingStep(null)
      setHistorySidebarOpen(false)
      setWorkspaceTab('chat')
    }
  }

  async function deleteHistoryThread(threadId: string) {
    if (busyTask) {
      return
    }

    const result = await deleteStoredHistoryThread(threadId)
    if (result.resetActiveThread) {
      setPendingStep(null)
    }
  }

  function openSettings() {
    setTutorialOpen(false)
    setConfigSidebarOpen(false)
    setRunLogOpen(false)
    setHistorySidebarOpen(false)
    setSettingsOpen(true)
  }

  function toggleTutorial() {
    setSettingsOpen(false)
    setConfigSidebarOpen(false)
    setRunLogOpen(false)
    setHistorySidebarOpen(false)
    setTutorialOpen((current) => !current)
  }

  function handleStopRun() {
    stopCurrentRun()
    settleSensitiveActionRequest(false)
  }

  function handlePauseRun() {
    pauseCurrentRun()
  }

  function handleResumeRun() {
    void resumeRun()
  }

  // Escape is owned by the top-most overlay (see overlayStack). Bare Escape no
  // longer stops an agent run; the explicit Stop controls remain available.
  const shortcutBlockedByModal =
    settingsOpen ||
    tutorialOpen ||
    historySidebarOpen ||
    clearHistoryConfirmOpen ||
    sensitiveActionRequest !== null

  useHotkeys([
    {
      handler: () => {
        if (!shortcutBlockedByModal && !configSidebarOpen && !runLogOpen) {
          focusChatComposer()
        }
      },
      key: 'k',
      metaOrCtrl: true,
    },
    {
      handler: () => {
        if (!shortcutBlockedByModal) {
          handleToggleConfigSidebar()
        }
      },
      key: 'b',
      metaOrCtrl: true,
    },
    {
      handler: () => {
        if (!shortcutBlockedByModal && !configSidebarOpen) {
          handleToggleInspect()
        }
      },
      key: 'j',
      metaOrCtrl: true,
    },
  ])

  useOverlayLayer(runLogOpen, () => setRunLogOpen(false))
  useDialogFocusTrap({
    active: runLogOpen,
    containerRef: runLogDrawerRef,
    initialFocusRef: runLogCloseButtonRef,
  })

  return (
    <AppProvider value={appContextValue}>
      <main
        className={[
          'app-shell',
          isAgentRunning ? 'app-shell-running' : '',
          showSetupHome ? 'app-shell-setup' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <AppTopbar
          deviceConnected={device.connected}
          hasModelConfig={hasModelConfig}
          isAgentRunning={isAgentRunning}
          isConfigOpen={configSidebarOpen}
          isInspectOpen={runLogOpen}
          isSettingsOpen={settingsOpen}
          isTutorialOpen={tutorialOpen}
          latestLogTitle={logs[0]?.title ?? null}
          modelLabel={modelConfig.model}
          runningStep={sessionSummary?.stepNumber ?? null}
          onOpenConfig={handleOpenConfig}
          onOpenInspect={handleToggleInspect}
          onOpenSettings={openSettings}
          onReadinessClick={showSetupHome ? undefined : handleReadinessClick}
          onPauseRun={handlePauseRun}
          onStopRun={handleStopRun}
          onToggleTutorial={toggleTutorial}
        />

        <Suspense
          fallback={
            <div className="panel-loading" role="status">
              {copy.loadingPanel}
            </div>
          }
        >
          {settingsOpen ? (
            <SettingsDialog
              copy={copy}
              appCardsJson={appCardsJson}
              appCardsJsonError={appCardsJsonError}
              customToolsJson={customToolsJson}
              customToolsJsonError={customToolsJsonError}
              languageMode={languageMode}
              maxSteps={maxSteps}
              taskNotificationsEnabled={taskNotificationsEnabled}
              disabledActionTools={disabledActionTools}
              onAppCardsJsonChange={updateAppCardsJson}
              onCustomToolsJsonChange={updateCustomToolsJson}
              onDisabledActionToolsChange={setDisabledActionTools}
              onClearChatHistory={requestClearChatHistory}
              onClearRunLog={handleClearRunLog}
              onClose={() => setSettingsOpen(false)}
              onExportChatHistory={() => {
                void handleExportChatHistory()
              }}
              onExportTrajectory={handleExportTrajectory}
              onExportSettings={handleExportSettings}
              onImportChatHistory={() => {
                void handleImportChatHistory()
              }}
              onImportSettings={() => {
                void handleImportSettings()
              }}
              onLanguageModeChange={setLanguageMode}
              onMaxStepsChange={updateMaxSteps}
              onReopenSetup={agentReady ? undefined : handleReopenSetup}
              onResetAppCards={resetAppCards}
              onSecretRecordsJsonChange={updateSecretRecordsJson}
              onTaskNotificationsEnabledChange={(value: boolean) => {
                void handleTaskNotificationsEnabledChange(value)
              }}
              onThemeModeChange={setThemeMode}
              repositoryStats={repositoryStats}
              repositoryStatsStatus={repositoryStatsStatus}
              storageEstimate={storageEstimate}
              storageEstimateStatus={storageEstimateStatus}
              secretRecordsJson={secretRecordsJson}
              secretRecordsJsonError={secretRecordsJsonError}
              themeMode={themeMode}
            />
          ) : null}

          {tutorialOpen ? (
            <TutorialPanel copy={copy} onClose={() => setTutorialOpen(false)} />
          ) : null}
        </Suspense>

        {sensitiveActionRequest ? (
          <Suspense fallback={null}>
            <SensitiveActionDialog
              copy={copy}
              request={sensitiveActionRequest}
              onCancel={() => settleSensitiveActionRequest(false)}
              onConfirm={() => settleSensitiveActionRequest(true)}
            />
          </Suspense>
        ) : null}

        <Suspense fallback={null}>
          <ConfirmDialog
            cancelLabel={copy.cancel}
            confirmLabel={copy.clearChatHistoryConfirmAction}
            danger
            message={copy.clearChatHistoryConfirmMessage}
            onCancel={() => setClearHistoryConfirmOpen(false)}
            onConfirm={() => {
              void confirmClearChatHistory()
            }}
            open={clearHistoryConfirmOpen}
            title={copy.clearChatHistoryConfirmTitle}
          />
        </Suspense>

        {unrestrictedConfirmOpen ? (
          <Suspense fallback={null}>
            <UnrestrictedModeConfirmDialog
              copy={copy}
              onCancel={() => settleUnrestrictedModeConfirmation(false)}
              onConfirm={() => settleUnrestrictedModeConfirmation(true)}
            />
          </Suspense>
        ) : null}

        {error ? (
          <div className="alert" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button
              type="button"
              className="alert-dismiss"
              aria-label={copy.dismissNotification}
              title={copy.dismissNotification}
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        {showSetupHome ? (
          <SetupHome
            busyTask={busyTask}
            deviceConnected={device.connected}
            hasModelConfig={hasModelConfig}
            onConnectDevice={device.actions.onConnectDevice}
            onConfigureModel={handleConfigureModelFromSetup}
            onEnterWorkspace={handleEnterWorkspace}
            onSkipToWorkspace={handleEnterWorkspace}
          />
        ) : (
          <>
            <nav className="workspace-mobile-tabs" aria-label={copy.workspaceTabs}>
              <button
                type="button"
                className={workspaceTab === 'chat' ? 'workspace-mobile-tab active' : 'workspace-mobile-tab'}
                aria-current={workspaceTab === 'chat' ? 'page' : undefined}
                onClick={() => handleSelectWorkspaceTab('chat')}
              >
                {copy.workspaceTabChat}
              </button>
              <button
                type="button"
                className={workspaceTab === 'phone' ? 'workspace-mobile-tab active' : 'workspace-mobile-tab'}
                aria-current={workspaceTab === 'phone' ? 'page' : undefined}
                onClick={() => handleSelectWorkspaceTab('phone')}
              >
                {copy.workspaceTabPhone}
              </button>
            </nav>

            <section
              className={[
                'workspace',
                isAgentRunning ? 'workspace-running' : '',
                `workspace-tab-${workspaceTab}`,
              ]
                .filter(Boolean)
                .join(' ')}
              ref={workspaceSplitRef}
              style={
                workspaceSplitIsCustom
                  ? ({ '--workspace-split': `${workspaceSplitPercent}%` } as CSSProperties)
                  : undefined
              }
            >
              <ConversationPanel
                activeThreadId={activeThreadId}
                busyTask={busyTask}
                conversation={conversation}
                deviceConnected={device.connected}
                hasModelConfig={hasModelConfig}
                interactionItems={interactionItems}
                historySidebarOpen={historySidebarOpen}
                sessionSummary={sessionSummary}
                onCloseHistorySidebar={() => setHistorySidebarOpen(false)}
                onConfigureModel={handleConfigureModelFromSetup}
                onConnectDevice={device.actions.onConnectDevice}
                onDeleteThread={(threadId) => {
                  void deleteHistoryThread(threadId)
                }}
                onExecutePendingStep={executePendingStep}
                onOpenRunLog={() => setRunLogOpen(true)}
                onPauseRun={handlePauseRun}
                onResumeRun={handleResumeRun}
                onSelectThread={(threadId) => {
                  void selectHistoryThread(threadId)
                }}
                onStartNewChat={startNewChat}
                onStopRun={handleStopRun}
                onSubmitChatMessage={(message) => {
                  if (!device.connected || !hasModelConfig) {
                    pushToast({
                      tone: 'warn',
                      title: device.connected
                        ? copy.chatPlaceholderNeedsModel
                        : copy.chatPlaceholderNeedsDevice,
                    })
                  }
                  void submitChatMessage(message)
                }}
                onToggleHistorySidebar={() => setHistorySidebarOpen((current) => !current)}
                pendingStep={pendingStep}
                queuedChatMessageCount={queuedChatMessageCount}
                threadSummaries={threadSummaries}
              />

              <div className="workspace-split-handle" {...workspaceSplitHandleProps}>
                <span aria-hidden="true" />
              </div>

              <div className="phone-column">
                <div className="phone-stage-chrome">
                  {device.connected ||
                  (device.currentApp && device.currentApp !== UNKNOWN_APP_NAME) ? (
                    <div
                      className="status current-app-status phone-current-app"
                      title={`${copy.currentApp}: ${currentAppLabel}`}
                    >
                      <span className="status-label">
                        <span className="status-prefix">{copy.currentApp}: </span>
                        {currentAppLabel}
                      </span>
                    </div>
                  ) : (
                    <div className="phone-stage-idle-label">{copy.workspaceTabPhone}</div>
                  )}
                  {sessionSummary?.stepNumber ? (
                    <span className="phone-step-chip">
                      {copy.step} {sessionSummary.stepNumber}
                      {maxSteps ? ` / ${maxSteps}` : ''}
                    </span>
                  ) : null}
                </div>
                <PhoneStage
                  busyTask={busyTask}
                  copy={copy}
                  deviceConnected={device.connected}
                  displayedScreenshot={device.displayedScreenshot}
                  onConnectDevice={device.actions.onConnectDevice}
                  onRunInteractiveAction={device.runScreenshotAction}
                  pendingStep={pendingStep}
                  runningAgent={Boolean(
                    busyTask?.id === 'run-agent' || (device.state?.currentApp != null && pendingStep != null),
                  )}
                />
                <DeviceQuickControls
                  busyTask={busyTask}
                  connected={device.connected}
                  copy={copy}
                  onRunDirectAction={device.actions.onRunDirectAction}
                />
              </div>
            </section>

            <ConfigSidebar
              deviceActions={{ ...device.actions, onUnrestrictedModeChange: handleUnrestrictedModeChange }}
              deviceOptions={device.options}
              deviceState={device.state}
              isOpen={configSidebarOpen}
              memoryEnabled={memoryEnabled}
              modelConfig={modelConfig}
              actionProtocol={actionProtocol}
              onModelConfigChange={updateConfig}
              onActionProtocolChange={setActionProtocol}
              onMemoryEnabledChange={setMemoryEnabled}
              onScreenBlackoutDuringAutoControlChange={setScreenBlackoutDuringAutoControl}
              onSelectTarget={handleOpenConfigTarget}
              onStreamResponsesChange={setStreamResponses}
              onTestConnection={handleTestModelConnection}
              onToggleOpen={handleToggleConfigSidebar}
              screenBlackoutDuringAutoControl={screenBlackoutDuringAutoControl}
              streamResponses={streamResponses}
            />

            {runLogOpen ? (
              <div className="inspect-drawer-root">
                <button
                  type="button"
                  className="inspect-drawer-backdrop"
                  aria-hidden="true"
                  onClick={() => setRunLogOpen(false)}
                  tabIndex={-1}
                />
                <section
                  className="inspect-drawer panel"
                  aria-label={copy.inspect}
                  role="dialog"
                  aria-modal="true"
                  ref={runLogDrawerRef}
                >
                  <div className="inspect-drawer-header">
                    <div>
                      <span className="inspect-drawer-title">{copy.inspect}</span>
                      {logs[0]?.title ? (
                        <small className="inspect-drawer-subtitle">{logs[0].title}</small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="button icon-button icon-button--md"
                      aria-label={copy.closeInspectPanel}
                      title={copy.closeInspectPanel}
                      onClick={() => setRunLogOpen(false)}
                      ref={runLogCloseButtonRef}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <Suspense
                    fallback={
                      <div className="log-loading" role="status">
                        {copy.loadingPanel}
                      </div>
                    }
                  >
                    <RunLog
                      logs={logs}
                      onClear={clearLogs}
                      labels={runLogLabels}
                    />
                  </Suspense>
                </section>
              </div>
            ) : null}
          </>
        )}
      </main>
      <Suspense fallback={null}>
        <ToastViewport
          dismissLabel={copy.dismissNotification}
          onDismiss={dismissToast}
          toasts={toasts}
        />
      </Suspense>
    </AppProvider>
  )
}

export default App
