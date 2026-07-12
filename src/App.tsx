import { AlertTriangle } from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
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
import { OPENAI_PROXY_URL } from './lib/openAiRuntimeConfig'
import { APP_COPY, resolveLocale } from './lib/appCopy'
import { loadSettings, normalizeMaxSteps, parseSettingsImport, type AppSettings } from './lib/settings'
import { createDefaultActionToolRegistry, type ActionToolName } from './lib/toolRegistry'
import { loadMemoryItems, rememberMemoryItem, saveMemoryItems } from './lib/memory'
import { downloadJsonFile, pickAndReadJsonFile } from './lib/fileExport'
import { parseChatHistoryImport } from './lib/agentThread'
import {
  requestTaskNotificationPermission,
  showTaskNotification,
} from './lib/taskNotifications'
import { useAgentRunController } from './hooks/useAgentRunController'
import { useConfigTargetScroll } from './hooks/useConfigTargetScroll'
import { useDeviceController } from './hooks/useDeviceController'
import { useAgentSessionHistory } from './hooks/useAgentSessionHistory'
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
import { ConfigSidebar } from './components/ConfigSidebar'
import { DeviceQuickControls } from './components/DeviceQuickControls'
import { PhoneStage } from './components/PhoneStage'
import { RunLog } from './components/RunLog'
import { ConversationPanel } from './components/ConversationPanel'
import { SetupHome } from './components/SetupHome'
import {
  SensitiveActionDialog,
  type SensitiveActionDialogRequest,
} from './components/SensitiveActionDialog'
import { UnrestrictedModeConfirmDialog } from './components/UnrestrictedModeConfirmDialog'
import { appendAuditEntry } from './lib/auditLog'
import { buildActionPreview } from './lib/actionPreview'

function createModelClient(modelConfig: ModelConfig) {
  if (isGeminiProvider(modelConfig.provider)) {
    return createGeminiClient(globalThis.fetch)
  }
  if (isOpenAiProvider(modelConfig.provider)) {
    return createOpenAiResponsesClient(globalThis.fetch, { proxyUrl: OPENAI_PROXY_URL })
  }
  return createOpenAiClient(globalThis.fetch, { proxyUrl: OPENAI_PROXY_URL })
}

const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)
const TutorialPanel = lazy(() =>
  import('./components/TutorialPanel').then((module) => ({ default: module.TutorialPanel })),
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
  const [configSidebarOpen, setConfigSidebarOpen] = useState(false)
  const openConfigTarget = useConfigTargetScroll(configSidebarOpen, setConfigSidebarOpen)
  type WorkspaceTab = 'phone' | 'chat' | 'config'
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('phone')
  const [setupDismissed, setSetupDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem('webdroid-setup-dismissed') === '1'
    } catch {
      return false
    }
  })
  const dismissSetup = useCallback(() => {
    setSetupDismissed(true)
    try {
      globalThis.localStorage?.setItem('webdroid-setup-dismissed', '1')
    } catch {
      // Ignore quota / private-mode failures; in-memory flag still applies.
    }
  }, [])
  const [pendingStep, setPendingStep] = useState<AgentStep | null>(null)
  const { logs, addLog, clearLogs } = useRunLog()
  const { busyTask, error, runTask, setError } = useBusyTask(({ label, message }) => {
    addLog({ tone: 'error', title: label, detail: message })
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [runLogOpen, setRunLogOpen] = useState(false)
  const runLogDrawerRef = useRef<HTMLDetailsElement | null>(null)
  const { repositoryStats, repositoryStatsStatus } = useRepositoryStats(settingsOpen)
  const { storageEstimate, storageEstimateStatus } = useStorageEstimate(settingsOpen)

  const activeLocale = useMemo(() => resolveLocale(languageMode), [languageMode])
  const copy = APP_COPY[activeLocale]
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
  const {
    actionSettleMs,
    confirmSensitiveActions,
    doubleTapIntervalMs,
    keyboardStepMs,
    preferAdbKeyboard,
    unrestrictedMode,
  } = device.options

  // Unrestricted-mode enable confirmation: gate the toggle behind a dialog so a
  // single checkbox click (or a malicious settings import) cannot silently arm
  // autonomous execution of sensitive operations.
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
    setWorkspaceTab('config')
    openConfigTarget('model')
  }, [dismissSetup, openConfigTarget])
  const handleConfigureDeviceFromSetup = useCallback(() => {
    dismissSetup()
    setWorkspaceTab('config')
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
  const modalOverlayOpen = settingsOpen || sensitiveActionRequest !== null
  useEffect(() => {
    if (!modalOverlayOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const previousOverscrollBehavior = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'contain'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscrollBehavior
    }
  }, [modalOverlayOpen])
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
      setTaskNotificationsEnabled(permission === 'granted')
    },
    [],
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
    queuedChatMessageCount,
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
      executionResult: copy.stepExecutionResult,
      expandedScreenshotFor: (title: string) => `${copy.expandedAndroidScreenshot}: ${title}`,
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
  const handleOpenConfigTarget = useCallback(
    (target: Parameters<typeof openConfigTarget>[0]) => {
      setWorkspaceTab('config')
      openConfigTarget(target)
    },
    [openConfigTarget],
  )
  const handleToggleConfigSidebar = useCallback(() => {
    setConfigSidebarOpen((current) => {
      const next = !current
      if (next) {
        setWorkspaceTab('config')
      }
      return next
    })
  }, [])
  const handleSelectWorkspaceTab = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab)
    if (tab === 'config') {
      setConfigSidebarOpen(true)
    }
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
  }

  async function handleImportChatHistory() {
    let parsed: unknown
    try {
      parsed = await pickAndReadJsonFile()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copy.importInvalidFile, detail })
      return
    }
    if (parsed === null) {
      return
    }
    const threads = parseChatHistoryImport(parsed)
    if (threads.length === 0) {
      addLog({ tone: 'warn', title: copy.importInvalidFile })
      return
    }
    await importChatHistory(threads)
  }

  function handleExportSettings() {
    downloadJsonFile('webdroid-agent-settings.json', {
      type: 'webdroid-agent-settings',
      version: 1,
      exportedAt: Date.now(),
      data: currentSettings,
    })
    addLog({ tone: 'info', title: copy.settingsExported })
  }

  async function handleImportSettings() {
    let parsed: unknown
    try {
      parsed = await pickAndReadJsonFile()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught)
      addLog({ tone: 'warn', title: copy.importInvalidFile, detail })
      return
    }
    if (parsed === null) {
      return
    }
    applySettings(parseSettingsImport(parsed))
    addLog({ tone: 'info', title: copy.settingsImported })
  }

  function startNewChat() {
    setPendingStep(null)
    setHistorySidebarOpen(false)
    setWorkspaceTab('chat')
    startNewSession()
    addLog({ tone: 'info', title: copy.newChatStarted })
  }

  async function clearChatHistoryFromSettings() {
    const cleared = await clearHistoryThreads()
    if (cleared) {
      setPendingStep(null)
      setHistorySidebarOpen(false)
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
    setSettingsOpen(true)
  }

  function toggleTutorial() {
    setSettingsOpen(false)
    setTutorialOpen((current) => !current)
  }

  function toggleRunLog(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setRunLogOpen((current) => !current)
  }

  useEffect(() => {
    if (!runLogOpen) {
      return
    }

    runLogDrawerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [runLogOpen])

  function handleStopRun() {
    stopCurrentRun()
    settleSensitiveActionRequest(false)
  }

  return (
    <AppProvider value={{ copy, locale: activeLocale }}>
      <main className="app-shell">
        <AppTopbar
          deviceConnected={device.connected}
          hasModelConfig={hasModelConfig}
          isAgentRunning={isAgentRunning}
          isTutorialOpen={tutorialOpen}
          runningStep={sessionSummary?.stepNumber ?? null}
          onOpenSettings={openSettings}
          onReadinessClick={handleReadinessClick}
          onToggleTutorial={toggleTutorial}
        />

        <Suspense fallback={null}>
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
              onClearChatHistory={() => {
                void clearChatHistoryFromSettings()
              }}
              onClearRunLog={clearLogs}
              onClose={() => setSettingsOpen(false)}
              onExportChatHistory={() => {
                void handleExportChatHistory()
              }}
              onExportSettings={handleExportSettings}
              onImportChatHistory={() => {
                void handleImportChatHistory()
              }}
              onImportSettings={() => {
                void handleImportSettings()
              }}
              onLanguageModeChange={setLanguageMode}
              onMaxStepsChange={updateMaxSteps}
              onResetAppCards={resetAppCards}
              onSecretRecordsJsonChange={updateSecretRecordsJson}
              onTaskNotificationsEnabledChange={(value) => {
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

        <SensitiveActionDialog
          copy={copy}
          request={sensitiveActionRequest}
          onCancel={() => settleSensitiveActionRequest(false)}
          onConfirm={() => settleSensitiveActionRequest(true)}
        />

        {unrestrictedConfirmOpen ? (
          <UnrestrictedModeConfirmDialog
            copy={copy}
            onCancel={() => settleUnrestrictedModeConfirmation(false)}
            onConfirm={() => settleUnrestrictedModeConfirmation(true)}
          />
        ) : null}

        {error ? (
          <div className="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
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
                className={workspaceTab === 'phone' ? 'workspace-mobile-tab active' : 'workspace-mobile-tab'}
                aria-current={workspaceTab === 'phone' ? 'page' : undefined}
                onClick={() => handleSelectWorkspaceTab('phone')}
              >
                {copy.workspaceTabPhone}
              </button>
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
                className={workspaceTab === 'config' ? 'workspace-mobile-tab active' : 'workspace-mobile-tab'}
                aria-current={workspaceTab === 'config' ? 'page' : undefined}
                onClick={() => handleSelectWorkspaceTab('config')}
              >
                {copy.workspaceTabConfig}
              </button>
            </nav>

            <section
              className={[
                'workspace',
                configSidebarOpen ? '' : 'workspace-config-collapsed',
                `workspace-tab-${workspaceTab}`,
              ]
                .filter(Boolean)
                .join(' ')}
            >
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
                onToggleOpen={handleToggleConfigSidebar}
                screenBlackoutDuringAutoControl={screenBlackoutDuringAutoControl}
                streamResponses={streamResponses}
              />

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
                onSelectThread={(threadId) => {
                  void selectHistoryThread(threadId)
                }}
                onStartNewChat={startNewChat}
                onStopRun={handleStopRun}
                onSubmitChatMessage={(message) => {
                  void submitChatMessage(message)
                }}
                onToggleHistorySidebar={() => setHistorySidebarOpen((current) => !current)}
                pendingStep={pendingStep}
                queuedChatMessageCount={queuedChatMessageCount}
                threadSummaries={threadSummaries}
              />

              <div className="phone-column">
                {device.connected ||
                (device.currentApp && device.currentApp !== copy.unknownApp) ? (
                  <div
                    className="status current-app-status phone-current-app"
                    title={`${copy.currentApp}: ${device.currentApp || copy.unknownApp}`}
                  >
                    <span className="status-label">
                      <span className="status-prefix">{copy.currentApp}: </span>
                      {device.currentApp || copy.unknownApp}
                    </span>
                  </div>
                ) : null}
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
          </>
        )}

        <details className="log-drawer compact-section" open={runLogOpen} ref={runLogDrawerRef}>
          <summary onClick={toggleRunLog}>
            <span>{copy.runLog}</span>
            <small>{logs[0]?.title ?? copy.noEvents}</small>
          </summary>
          {runLogOpen ? (
            <RunLog
              logs={logs}
              onClear={clearLogs}
              labels={runLogLabels}
            />
          ) : null}
        </details>
      </main>
    </AppProvider>
  )
}

export default App
