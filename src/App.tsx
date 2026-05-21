import {
  AlertTriangle,
  Check,
  CircleStop,
  Code2,
  Download,
  ExternalLink,
  GitFork,
  KeyRound,
  Languages,
  Link,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Play,
  RotateCcw,
  ScanEye,
  Send,
  Settings as SettingsIcon,
  Star,
  StepForward,
  Sun,
  Usb,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { DeviceInfo, DeviceScreenshot, DeviceState } from './adapters/deviceBackend'
import { WebAdbDeviceBackend, isWebUsbSupported } from './adapters/webAdbBackend'
import type { AgentAction } from './lib/actions'
import { buildActionPreview } from './lib/actions'
import {
  addUserMessage,
  createAgentRunner,
  createAgentSession,
  queueUserMessage,
  recordAgentStep,
  runAgentStep,
  type AgentSession,
  type AgentStep,
} from './lib/agent'
import { createOpenAiClient, type ModelConfig } from './lib/openAiClient'
import type { PromptMode } from './lib/prompts'
import { modelScreenshotView } from './lib/screenshotCoordinates'
import { loadSettings, saveSettings, type LanguageMode, type ThemeMode } from './lib/settings'
import { createDefaultActionToolRegistry } from './lib/toolRegistry'
import { RunLog, type LogEntry, type LogScreenshot } from './components/RunLog'
import { ScreenshotLightbox } from './components/ScreenshotLightbox'

const REPOSITORY_URL = 'https://github.com/yeahhe365/webadb-autoglm'
const REPOSITORY_API_URL = 'https://api.github.com/repos/yeahhe365/webadb-autoglm'
const THEME_MODE_SEQUENCE: ThemeMode[] = ['system', 'light', 'dark']

type Locale = 'en-US' | 'zh-CN'

const APP_COPY = {
  'en-US': {
    settings: 'Settings',
    closeSettings: 'Close settings',
    close: 'Close',
    language: 'Language',
    languageSystem: 'System default',
    languageChinese: '中文',
    languageEnglish: 'English',
    aboutCopy:
      'Browser-based Android automation console for WebADB and OpenAI-compatible vision models.',
    githubRepository: 'GitHub repository',
    repositoryStats: 'Repository stats',
    stars: 'Stars',
    forks: 'Forks',
    openIssues: 'Open issues',
    githubStatsError: 'Could not load GitHub stats right now.',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    webUsbReady: 'ready',
    webUsbMissing: 'missing',
    model: 'Model',
    noModel: 'No model',
    modelSettings: 'Model settings',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    promptMode: 'Prompt mode',
    streamModelResponses: 'Stream model responses',
    device: 'Device',
    noDevice: 'No device',
    deviceDetails: 'Device details',
    serial: 'Serial',
    currentApp: 'Current app',
    package: 'Package',
    activity: 'Activity',
    keyboard: 'Keyboard',
    usbDebuggingRequired: 'USB debugging required',
    connect: 'Connect',
    disconnect: 'Disconnect',
    capture: 'Capture',
    enableAdbKeyboard: 'Enable ADB Keyboard',
    useAdbKeyboard: 'Use ADB Keyboard for text',
    confirmSensitiveTaps: 'Confirm sensitive taps',
    actionSettle: 'Action settle (ms)',
    doubleTapInterval: 'Double tap interval (ms)',
    keyboardStep: 'Keyboard step (ms)',
    supportedActions: 'Supported actions',
    capabilities: ['Launch', 'Tap', 'Type', 'Swipe', 'Back', 'Home', 'Long press', 'Double tap', 'Wait', 'Take over'],
    androidScreenshot: 'Android screenshot',
    expandedAndroidScreenshot: 'Expanded screenshot for Android screenshot',
    noScreenshot: 'No screenshot',
    chat: 'Chat',
    conversation: 'Conversation',
    noMessages: 'No messages yet',
    chatMessage: 'Chat message',
    chatPlaceholder: 'Send a follow-up instruction...',
    send: 'Send',
    newChat: 'New chat',
    maxSteps: 'Max steps',
    autoExecute: 'Auto execute',
    plan: 'Plan',
    run: 'Run',
    runAgent: 'Run agent',
    stop: 'Stop',
    reset: 'Reset',
    export: 'Export',
    pendingAction: 'Pending action',
    step: 'Step',
    none: 'None',
    acknowledge: 'Acknowledge',
    finish: 'Finish',
    execute: 'Execute',
    user: 'User',
    assistant: 'Assistant',
    observation: 'Observation',
    runLog: 'Run Log',
    clear: 'Clear',
    noEvents: 'No events yet',
  },
  'zh-CN': {
    settings: '设置',
    closeSettings: '关闭设置',
    close: '关闭',
    language: '语言',
    languageSystem: '系统默认',
    languageChinese: '中文',
    languageEnglish: 'English',
    aboutCopy: '基于浏览器的 Android 自动化控制台，支持 WebADB 和 OpenAI 兼容视觉模型。',
    githubRepository: 'GitHub 仓库',
    repositoryStats: '仓库统计',
    stars: '星标',
    forks: '复刻',
    openIssues: '开放问题',
    githubStatsError: '暂时无法加载 GitHub 统计。',
    theme: '主题',
    themeSystem: '系统',
    themeLight: '浅色',
    themeDark: '深色',
    webUsbReady: '可用',
    webUsbMissing: '不可用',
    model: '模型',
    noModel: '未设置模型',
    modelSettings: '模型设置',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    promptMode: '提示模式',
    streamModelResponses: '流式模型响应',
    device: '设备',
    noDevice: '无设备',
    deviceDetails: '设备详情',
    serial: '序列号',
    currentApp: '当前应用',
    package: '包名',
    activity: 'Activity',
    keyboard: '键盘',
    usbDebuggingRequired: '需要 USB 调试',
    connect: '连接',
    disconnect: '断开',
    capture: '截图',
    enableAdbKeyboard: '启用 ADB 键盘',
    useAdbKeyboard: '文本输入使用 ADB 键盘',
    confirmSensitiveTaps: '确认敏感点击',
    actionSettle: '动作等待 (ms)',
    doubleTapInterval: '双击间隔 (ms)',
    keyboardStep: '键盘步进 (ms)',
    supportedActions: '支持的动作',
    capabilities: ['启动', '点击', '输入', '滑动', '返回', '主页', '长按', '双击', '等待', '接管'],
    androidScreenshot: 'Android 截图',
    expandedAndroidScreenshot: '展开的 Android 截图',
    noScreenshot: '暂无截图',
    chat: '聊天',
    conversation: '对话',
    noMessages: '暂无消息',
    chatMessage: '聊天消息',
    chatPlaceholder: '发送后续指令...',
    send: '发送',
    newChat: '新聊天',
    maxSteps: '最大步数',
    autoExecute: '自动执行',
    plan: '计划',
    run: '运行',
    runAgent: '运行代理',
    stop: '停止',
    reset: '重置',
    export: '导出',
    pendingAction: '待处理动作',
    step: '步骤',
    none: '无',
    acknowledge: '确认',
    finish: '完成',
    execute: '执行',
    user: '用户',
    assistant: '助手',
    observation: '观察',
    runLog: '运行日志',
    clear: '清空',
    noEvents: '暂无事件',
  },
} as const

type AppCopy = (typeof APP_COPY)[Locale]

type RepositoryStats = {
  stars: number
  forks: number
  openIssues: number
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readRepositoryStats(value: unknown): RepositoryStats {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    stars: readNumber(record.stargazers_count),
    forks: readNumber(record.forks_count),
    openIssues: readNumber(record.open_issues_count),
  }
}

function nextThemeMode(current: ThemeMode): ThemeMode {
  const currentIndex = THEME_MODE_SEQUENCE.indexOf(current)
  return THEME_MODE_SEQUENCE[(currentIndex + 1) % THEME_MODE_SEQUENCE.length]
}

function resolveLocale(languageMode: LanguageMode): Locale {
  if (languageMode === 'zh-CN' || languageMode === 'en-US') {
    return languageMode
  }

  const browserLanguage = navigator.languages?.[0] ?? navigator.language
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

function themeModeLabel(themeMode: ThemeMode, copy: AppCopy) {
  if (themeMode === 'light') {
    return copy.themeLight
  }
  if (themeMode === 'dark') {
    return copy.themeDark
  }
  return copy.themeSystem
}

function ThemeModeIcon({ themeMode }: { themeMode: ThemeMode }) {
  if (themeMode === 'light') {
    return <Sun size={16} />
  }
  if (themeMode === 'dark') {
    return <Moon size={16} />
  }
  return <Monitor size={16} />
}

function pendingActionLabel(action: AgentAction['action'] | undefined, copy: AppCopy) {
  if (
    action === 'take_over' ||
    action === 'note' ||
    action === 'interact' ||
    action === 'call_api'
  ) {
    return copy.acknowledge
  }
  if (action === 'done') {
    return copy.finish
  }
  return copy.execute
}

function App() {
  const abortRef = useRef<AbortController | null>(null)
  const settings = useMemo(() => loadSettings(), [])
  const sessionRef = useRef<AgentSession>(createAgentSession(settings.task))
  const [conversation, setConversation] = useState(() => [...sessionRef.current.messages])
  const [backend] = useState(() => new WebAdbDeviceBackend())
  const client = useMemo(() => createOpenAiClient(), [])
  const actionToolRegistry = useMemo(() => createDefaultActionToolRegistry(), [])
  const [modelConfig, setModelConfig] = useState<ModelConfig>(settings.modelConfig)
  const [task, setTask] = useState(settings.task)
  const [chatInput, setChatInput] = useState('')
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps)
  const [autoExecute, setAutoExecute] = useState(settings.autoExecute)
  const [preferAdbKeyboard, setPreferAdbKeyboard] = useState(settings.preferAdbKeyboard)
  const [promptMode, setPromptMode] = useState<PromptMode>(settings.promptMode)
  const [confirmSensitiveActions, setConfirmSensitiveActions] = useState(
    settings.confirmSensitiveActions,
  )
  const [streamResponses, setStreamResponses] = useState(settings.streamResponses)
  const [actionSettleMs, setActionSettleMs] = useState(settings.actionSettleMs)
  const [doubleTapIntervalMs, setDoubleTapIntervalMs] = useState(settings.doubleTapIntervalMs)
  const [keyboardStepMs, setKeyboardStepMs] = useState(settings.keyboardStepMs)
  const [themeMode, setThemeMode] = useState(settings.themeMode)
  const [languageMode, setLanguageMode] = useState(settings.languageMode)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [currentApp, setCurrentApp] = useState<string>('Unknown')
  const [deviceState, setDeviceState] = useState<DeviceState>({ app: 'Unknown' })
  const [screenshot, setScreenshot] = useState<DeviceScreenshot | null>(null)
  const [pendingStep, setPendingStep] = useState<AgentStep | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [repositoryStats, setRepositoryStats] = useState<RepositoryStats | null>(null)
  const [repositoryStatsStatus, setRepositoryStatsStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  )

  const connected = deviceInfo !== null
  const hasModelConfig = Boolean(modelConfig.baseUrl && modelConfig.apiKey && modelConfig.model)
  const hasConversation = conversation.some((message) => message.role === 'user')
  const canRun = connected && !busy && hasModelConfig && hasConversation
  const displayedScreenshot = screenshot ? modelScreenshotView(screenshot) : null
  const activeLocale = useMemo(() => resolveLocale(languageMode), [languageMode])
  const copy = APP_COPY[activeLocale]
  const pendingButtonLabel = pendingActionLabel(pendingStep?.action.action, copy)

  useEffect(() => {
    saveSettings({
      modelConfig,
      task,
      maxSteps,
      autoExecute,
      preferAdbKeyboard,
      promptMode,
      confirmSensitiveActions,
      streamResponses,
      actionSettleMs,
      doubleTapIntervalMs,
      keyboardStepMs,
      themeMode,
      languageMode,
    })
  }, [
    actionSettleMs,
    autoExecute,
    confirmSensitiveActions,
    doubleTapIntervalMs,
    keyboardStepMs,
    languageMode,
    maxSteps,
    modelConfig,
    preferAdbKeyboard,
    promptMode,
    streamResponses,
    task,
    themeMode,
  ])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    document.documentElement.lang = activeLocale
  }, [activeLocale])

  useEffect(() => {
    backend.setPreferAdbKeyboard(preferAdbKeyboard)
  }, [backend, preferAdbKeyboard])

  useEffect(() => {
    backend.setTimingConfig({
      actionSettleMs,
      doubleTapIntervalMs,
      keyboardStepMs,
    })
  }, [actionSettleMs, backend, doubleTapIntervalMs, keyboardStepMs])

  useEffect(() => {
    if (!aboutOpen || repositoryStatsStatus !== 'idle') {
      return
    }

    async function loadRepositoryStats() {
      if (typeof fetch !== 'function') {
        setRepositoryStatsStatus('error')
        return
      }

      setRepositoryStatsStatus('loading')
      try {
        const response = await fetch(REPOSITORY_API_URL)
        if (!response.ok) {
          throw new Error(`GitHub responded with ${response.status}`)
        }
        const payload = await response.json()
        setRepositoryStats(readRepositoryStats(payload))
        setRepositoryStatsStatus('done')
      } catch {
        setRepositoryStatsStatus('error')
      }
    }

    void loadRepositoryStats()
  }, [aboutOpen, repositoryStatsStatus])

  function updateConfig<Key extends keyof ModelConfig>(key: Key, value: ModelConfig[Key]) {
    setModelConfig((current) => {
      return { ...current, [key]: value }
    })
  }

  function addLog(entry: Omit<LogEntry, 'id' | 'time'>) {
    setLogs((current) => [
      {
        ...entry,
        id: Date.now() + Math.random(),
        time: new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      },
      ...current,
    ])
  }

  function toLogScreenshot(value: DeviceScreenshot | null | undefined): LogScreenshot | undefined {
    if (!value) {
      return undefined
    }

    const view = modelScreenshotView(value)
    return {
      dataUrl: view.dataUrl,
      screen: view.screen,
    }
  }

  function ensureSession() {
    return sessionRef.current
  }

  function syncConversation() {
    setConversation([...sessionRef.current.messages])
    setTask(sessionRef.current.task)
  }

  function resetSession() {
    sessionRef.current = createAgentSession(task)
    setPendingStep(null)
    syncConversation()
    addLog({ tone: 'info', title: 'Agent context reset' })
  }

  function startNewChat() {
    sessionRef.current = createAgentSession('')
    setChatInput('')
    setPendingStep(null)
    syncConversation()
    addLog({ tone: 'info', title: 'New chat started' })
  }

  function clearRunLog() {
    setLogs([])
  }

  function confirmSensitiveAction(message: string) {
    if (!confirmSensitiveActions) {
      return true
    }

    return window.confirm(`Sensitive action requested:\n\n${message}\n\nExecute it?`)
  }

  function formatStepDetail(step: AgentStep) {
    return [
      `Current app: ${step.currentApp}`,
      `Timing: capture ${step.timing.captureMs}ms, app ${step.timing.currentAppMs}ms, model ${step.timing.modelMs}ms, parse ${step.timing.parseMs}ms, total ${step.timing.totalMs}ms`,
      step.modelOutput,
    ].join('\n\n')
  }

  function exportRunLog() {
    const payload = {
      exportedAt: new Date().toISOString(),
      device: deviceInfo,
      currentApp,
      deviceState,
      model: {
        ...modelConfig,
        apiKey: modelConfig.apiKey ? '<redacted>' : '',
      },
      promptMode,
      streamResponses,
      timing: {
        actionSettleMs,
        doubleTapIntervalMs,
        keyboardStepMs,
      },
      autoExecute,
      maxSteps,
      task,
      session: sessionRef.current,
      logs,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `webdroid-agent-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    addLog({ tone: 'ok', title: 'Run log exported' })
  }

  async function runTask(label: string, action: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await action()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      addLog({ tone: 'error', title: label, detail: message })
    } finally {
      setBusy(null)
    }
  }

  async function connectDevice() {
    await runTask('Connect device', async () => {
      const info = await backend.connect()
      setDeviceInfo(info)
      addLog({ tone: 'ok', title: 'Device connected', detail: `${info.name} (${info.serial})` })
      await captureScreen()
    })
  }

  async function disconnectDevice() {
    await runTask('Disconnect device', async () => {
      await backend.disconnect()
      setDeviceInfo(null)
      setCurrentApp('Unknown')
      setDeviceState({ app: 'Unknown' })
      setScreenshot(null)
      setPendingStep(null)
      addLog({ tone: 'info', title: 'Device disconnected' })
    })
  }

  async function captureScreen() {
    await runTask('Capture screen', async () => {
      const nextScreenshot = await backend.screenshot()
      const nextDeviceState = await backend.getDeviceState()
      setScreenshot(nextScreenshot)
      setCurrentApp(nextDeviceState.app)
      setDeviceState(nextDeviceState)
      addLog({
        tone: 'ok',
        title: 'Screen captured',
        detail: `${nextScreenshot.screen.width}x${nextScreenshot.screen.height}\n${formatDeviceState(nextDeviceState)}`,
        screenshot: toLogScreenshot(nextScreenshot),
      })
    })
  }

  async function enableAdbKeyboard() {
    await runTask('Enable ADB Keyboard', async () => {
      const result = await backend.enableAdbKeyboard()
      setPreferAdbKeyboard(true)
      addLog({ tone: 'ok', title: 'ADB Keyboard enabled', detail: result })
    })
  }

  function toggleAdbKeyboard(value: boolean) {
    setPreferAdbKeyboard(value)
    backend.setPreferAdbKeyboard(value)
  }

  async function planNextStep() {
    await runTask('Plan next action', async () => {
      const session = ensureSession()
      const step = await runAgentStep({
        device: backend,
        client,
        modelConfig: { ...modelConfig, stream: streamResponses },
        task: session.task,
        promptMode,
        session,
        index: session.history.length + 1,
      })
      setScreenshot(step.screenshot)
      setCurrentApp(step.currentApp)
      setDeviceState(step.deviceState)
      setPendingStep(step)
      syncConversation()
      addLog({
        tone: 'info',
        title: `Step ${step.index}: ${step.preview}`,
        detail: formatStepDetail(step),
        screenshot: toLogScreenshot(step.screenshot),
      })
    })
  }

  async function executePendingStep() {
    if (!pendingStep) {
      return
    }

    await runTask('Execute action', async () => {
      if (pendingStep.action.action === 'done') {
        recordAgentStep(ensureSession(), pendingStep)
        addLog({ tone: 'ok', title: 'Task complete', detail: pendingStep.action.summary })
        setPendingStep(null)
        syncConversation()
        return
      }

      const result = await actionToolRegistry.execute(pendingStep.executionAction, {
        device: backend,
        confirmSensitiveAction,
      })
      recordAgentStep(ensureSession(), pendingStep, result.summary, result.success)
      addLog({
        tone: result.success ? 'ok' : 'error',
        title: result.success ? `Executed ${pendingStep.preview}` : `Failed ${pendingStep.preview}`,
        detail: result.summary,
      })
      if (!result.success) {
        setError(result.summary)
      }
      setPendingStep(null)
      syncConversation()
    })
  }

  async function runAutoLoop() {
    const controller = new AbortController()
    abortRef.current = controller
    const session = ensureSession()

    await runTask('Run agent', async () => {
      const runner = createAgentRunner({ device: backend, client, toolRegistry: actionToolRegistry })
      const result = await runner.run({
        modelConfig: { ...modelConfig, stream: streamResponses },
        task: session.task,
        promptMode,
        autoExecute: true,
        maxSteps,
        session,
        signal: controller.signal,
        confirmSensitiveAction,
        onStep: (step) => {
          setScreenshot(step.screenshot)
          setCurrentApp(step.currentApp)
          setDeviceState(step.deviceState)
          setPendingStep(step.action.action === 'done' ? null : step)
          addLog({
            tone: 'info',
            title: `Step ${step.index}: ${step.preview}`,
            detail: formatStepDetail(step),
            screenshot: toLogScreenshot(step.screenshot),
          })
          syncConversation()
        },
        onExecuted: (step, commandResult) => {
          addLog({ tone: 'ok', title: `Executed ${step.preview}`, detail: commandResult })
          syncConversation()
        },
      })

      if (result.status === 'done') {
        addLog({ tone: 'ok', title: 'Task complete' })
      }
      if (result.status === 'max_steps') {
        addLog({ tone: 'warn', title: 'Max steps reached', detail: `${maxSteps} steps` })
      }
      if (result.status === 'stopped') {
        addLog({ tone: 'warn', title: 'Run stopped' })
      }
      if (result.status === 'awaiting_takeover') {
        addLog({ tone: 'warn', title: 'Manual takeover requested' })
      }
      if (result.status === 'loop_guard') {
        addLog({ tone: 'warn', title: 'Loop guard stopped the run', detail: result.reason })
      }
      if (result.status !== 'awaiting_takeover') {
        setPendingStep(null)
      }
      syncConversation()
    })
  }

  async function submitChatMessage() {
    const message = chatInput.trim()
    if (!message) {
      return
    }

    setChatInput('')
    const session = ensureSession()

    if (busy) {
      queueUserMessage(session, message)
      syncConversation()
      addLog({ tone: 'info', title: 'User message queued', detail: message })
      return
    }

    addUserMessage(session, message)
    syncConversation()
    addLog({ tone: 'info', title: 'User message', detail: message })

    if (!connected || !hasModelConfig) {
      return
    }

    if (autoExecute) {
      await runAutoLoop()
    } else {
      await planNextStep()
    }
  }

  function stopRun() {
    abortRef.current?.abort()
    addLog({ tone: 'warn', title: 'Stop requested' })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>WebDroid Agent</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-strip">
            <span className={isWebUsbSupported() ? 'status ok' : 'status warn'}>
              <Usb size={16} />
              WebUSB {isWebUsbSupported() ? copy.webUsbReady : copy.webUsbMissing}
            </span>
            <span className="status">
              <ScanEye size={16} />
              {currentApp}
            </span>
          </div>
          <button
            type="button"
            className="theme-button"
            onClick={() => setThemeMode((current) => nextThemeMode(current))}
            aria-label={`${copy.theme}: ${themeModeLabel(themeMode, copy)}`}
            title={`${copy.theme}: ${themeModeLabel(themeMode, copy)}`}
          >
            <ThemeModeIcon themeMode={themeMode} />
            {themeModeLabel(themeMode, copy)}
          </button>
          <button type="button" className="settings-button" onClick={() => setAboutOpen(true)}>
            <SettingsIcon size={16} />
            {copy.settings}
          </button>
        </div>
      </header>

      {aboutOpen ? (
        <div
          className="about-page"
          role="dialog"
          aria-modal="true"
          aria-label={copy.settings}
          onClick={() => setAboutOpen(false)}
        >
          <section className="about-panel" onClick={(event) => event.stopPropagation()}>
            <div className="about-header">
              <div>
                <p className="eyebrow">{copy.settings}</p>
                <h2>WebDroid Agent</h2>
              </div>
              <button
                type="button"
                className="about-close"
                onClick={() => setAboutOpen(false)}
                aria-label={copy.closeSettings}
              >
                {copy.close}
              </button>
            </div>
            <label className="settings-field">
              <span>
                <Languages size={16} />
                {copy.language}
              </span>
              <select
                value={languageMode}
                onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}
              >
                <option value="system">{copy.languageSystem}</option>
                <option value="zh-CN">{copy.languageChinese}</option>
                <option value="en-US">{copy.languageEnglish}</option>
              </select>
            </label>
            <p className="about-copy">{copy.aboutCopy}</p>
            <a
              className="repository-link"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={copy.githubRepository}
            >
              <Code2 size={18} />
              <span>{REPOSITORY_URL}</span>
              <ExternalLink size={15} />
            </a>
            <div className="repository-stats" aria-label={copy.repositoryStats}>
              <div>
                <Star size={18} />
                <strong>
                  {repositoryStatsStatus === 'loading'
                    ? '...'
                    : (repositoryStats?.stars.toLocaleString() ?? '-')}
                </strong>
                <span>{copy.stars}</span>
              </div>
              <div>
                <GitFork size={18} />
                <strong>
                  {repositoryStatsStatus === 'loading'
                    ? '...'
                    : (repositoryStats?.forks.toLocaleString() ?? '-')}
                </strong>
                <span>{copy.forks}</span>
              </div>
              <div>
                <AlertTriangle size={18} />
                <strong>
                  {repositoryStatsStatus === 'loading'
                    ? '...'
                    : (repositoryStats?.openIssues.toLocaleString() ?? '-')}
                </strong>
                <span>{copy.openIssues}</span>
              </div>
            </div>
            {repositoryStatsStatus === 'error' ? (
              <p className="about-error">{copy.githubStatsError}</p>
            ) : null}
          </section>
        </div>
      ) : null}

      {error ? (
        <div className="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="panel config-panel">
          <div className="panel-title">
            <KeyRound size={18} />
            <h2>{copy.model}</h2>
          </div>
          <div className="model-box">
            <span>{modelConfig.model || copy.noModel}</span>
            <details className="model-details">
              <summary>{copy.modelSettings}</summary>
              <label>
                {copy.baseUrl}
                <input
                  value={modelConfig.baseUrl}
                  onChange={(event) => updateConfig('baseUrl', event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label>
                {copy.apiKey}
                <input
                  value={modelConfig.apiKey}
                  onChange={(event) => updateConfig('apiKey', event.target.value)}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
              <label>
                {copy.model}
                <input
                  value={modelConfig.model}
                  onChange={(event) => updateConfig('model', event.target.value)}
                  placeholder="vision-model"
                />
              </label>
              <label>
                {copy.promptMode}
                <select
                  value={promptMode}
                  onChange={(event) => setPromptMode(event.target.value as PromptMode)}
                >
                  <option value="canonical-json">Canonical JSON</option>
                  <option value="autoglm-native">AutoGLM native</option>
                </select>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={streamResponses}
                  onChange={(event) => setStreamResponses(event.target.checked)}
                />
                <span>{copy.streamModelResponses}</span>
              </label>
            </details>
          </div>

          <div className="panel-title">
            <Usb size={18} />
            <h2>{copy.device}</h2>
          </div>
          <div className="device-box">
            <span>{deviceInfo?.name || copy.noDevice}</span>
            {connected ? (
              <details className="device-details">
                <summary>{copy.deviceDetails}</summary>
                <small>{copy.serial}: {deviceInfo.serial}</small>
                <small>{copy.currentApp}: {currentApp}</small>
                {deviceState.packageName ? <small>{copy.package}: {deviceState.packageName}</small> : null}
                {deviceState.activity ? <small>{copy.activity}: {deviceState.activity}</small> : null}
                {deviceState.keyboard ? <small>{copy.keyboard}: {deviceState.keyboard}</small> : null}
              </details>
            ) : (
              <>
                <small>{copy.usbDebuggingRequired}</small>
                <small>{copy.currentApp}: {currentApp}</small>
              </>
            )}
          </div>
          <div className="button-row">
            <button type="button" onClick={connectDevice} disabled={Boolean(busy) || connected}>
              <Link size={16} />
              {copy.connect}
            </button>
            <button type="button" onClick={disconnectDevice} disabled={Boolean(busy) || !connected}>
              <CircleStop size={16} />
              {copy.disconnect}
            </button>
          </div>
          <button type="button" className="wide" onClick={captureScreen} disabled={Boolean(busy) || !connected}>
            <ScanEye size={16} />
            {copy.capture}
          </button>
          <button
            type="button"
            className="wide"
            onClick={enableAdbKeyboard}
            disabled={Boolean(busy) || !connected}
          >
            <KeyRound size={16} />
            {copy.enableAdbKeyboard}
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={preferAdbKeyboard}
              onChange={(event) => toggleAdbKeyboard(event.target.checked)}
            />
            <span>{copy.useAdbKeyboard}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={confirmSensitiveActions}
              onChange={(event) => setConfirmSensitiveActions(event.target.checked)}
            />
            <span>{copy.confirmSensitiveTaps}</span>
          </label>
          <div className="timing-grid">
            <label>
              {copy.actionSettle}
              <input
                type="number"
                min={100}
                max={5000}
                step={50}
                value={actionSettleMs}
                onChange={(event) => setActionSettleMs(Number(event.target.value))}
              />
            </label>
            <label>
              {copy.doubleTapInterval}
              <input
                type="number"
                min={20}
                max={1000}
                step={5}
                value={doubleTapIntervalMs}
                onChange={(event) => setDoubleTapIntervalMs(Number(event.target.value))}
              />
            </label>
            <label>
              {copy.keyboardStep}
              <input
                type="number"
                min={100}
                max={5000}
                step={50}
                value={keyboardStepMs}
                onChange={(event) => setKeyboardStepMs(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="capability-grid" aria-label={copy.supportedActions}>
            {copy.capabilities.map((capability) => (
              <span key={capability}>{capability}</span>
            ))}
          </div>
        </aside>

        <section className="phone-stage" aria-label={displayedScreenshot ? copy.androidScreenshot : copy.noScreenshot}>
          {displayedScreenshot ? (
            <div className="phone-frame">
              <ScreenshotLightbox
                screenshot={displayedScreenshot}
                title={copy.androidScreenshot}
                thumbnailAlt={copy.androidScreenshot}
                expandedAlt={copy.expandedAndroidScreenshot}
                thumbnailClassName="phone-screenshot-button"
              >
                {pendingStep ? (
                  <ActionOverlay action={pendingStep.action} screen={displayedScreenshot.screen} />
                ) : null}
              </ScreenshotLightbox>
            </div>
          ) : null}
        </section>

        <aside className="panel run-panel">
          <div className="panel-title">
            <MessageSquare size={18} />
            <h2>{copy.chat}</h2>
          </div>
          <div className="conversation-list" aria-label={copy.conversation}>
            {conversation.length === 0 ? <p className="muted">{copy.noMessages}</p> : null}
            {conversation.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <span>{formatConversationRole(message.role, copy)}</span>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          <label>
            {copy.chatMessage}
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              rows={4}
              placeholder={copy.chatPlaceholder}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={submitChatMessage} disabled={!chatInput.trim()}>
              <Send size={16} />
              {copy.send}
            </button>
            <button type="button" onClick={startNewChat} disabled={Boolean(busy)}>
              <Plus size={16} />
              {copy.newChat}
            </button>
          </div>
          <label>
            {copy.maxSteps}
            <input
              type="number"
              min={1}
              max={200}
              value={maxSteps}
              onChange={(event) => setMaxSteps(Number(event.target.value))}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={(event) => setAutoExecute(event.target.checked)}
            />
            <span>{copy.autoExecute}</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={planNextStep} disabled={!canRun || autoExecute}>
              <StepForward size={16} />
              {copy.plan}
            </button>
            <button type="button" onClick={runAutoLoop} disabled={!canRun || !autoExecute}>
              {busy === 'Run agent' ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {copy.run}
            </button>
          </div>
          <button type="button" className="wide danger" onClick={stopRun} disabled={!busy}>
            <CircleStop size={16} />
            {copy.stop}
          </button>
          <div className="button-row">
            <button type="button" onClick={resetSession} disabled={Boolean(busy)}>
              <RotateCcw size={16} />
              {copy.reset}
            </button>
            <button type="button" onClick={exportRunLog} disabled={logs.length === 0}>
              <Download size={16} />
              {copy.export}
            </button>
          </div>

          <div className="pending-action">
            <div className="pending-header">
              <span>{copy.pendingAction}</span>
              {pendingStep ? <small>{copy.step} {pendingStep.index}</small> : null}
            </div>
            <p>{pendingStep ? buildActionPreview(pendingStep.action) : copy.none}</p>
            <button type="button" className="wide primary" onClick={executePendingStep} disabled={!pendingStep || Boolean(busy)}>
              <Check size={16} />
              {pendingButtonLabel}
            </button>
          </div>
        </aside>
      </section>

      <RunLog
        logs={logs}
        onClear={clearRunLog}
        labels={{
          clear: copy.clear,
          empty: copy.noEvents,
          title: copy.runLog,
          screenshotFor: (title) => `${copy.androidScreenshot}: ${title}`,
          expandedScreenshotFor: (title) => `${copy.expandedAndroidScreenshot}: ${title}`,
        }}
      />
    </main>
  )
}

function formatConversationRole(role: 'user' | 'assistant' | 'observation', copy: AppCopy) {
  if (role === 'assistant') {
    return copy.assistant
  }
  if (role === 'observation') {
    return copy.observation
  }
  return copy.user
}

function formatDeviceState(state: DeviceState) {
  return [
    `Current app: ${state.app}`,
    state.packageName ? `Package: ${state.packageName}` : null,
    state.activity ? `Activity: ${state.activity}` : null,
    state.orientation ? `Orientation: ${state.orientation}` : null,
    state.keyboard ? `Keyboard: ${state.keyboard}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function ActionOverlay({ action, screen }: { action: AgentAction; screen: { width: number; height: number } }) {
  if (action.action === 'tap' || action.action === 'long_press' || action.action === 'double_tap') {
    return (
      <span
        className={`tap-marker ${action.action}`}
        style={{
          left: `${(action.x / screen.width) * 100}%`,
          top: `${(action.y / screen.height) * 100}%`,
        }}
      />
    )
  }

  if (action.action === 'swipe') {
    return (
      <>
        <span
          className="swipe-marker start"
          style={{
            left: `${(action.fromX / screen.width) * 100}%`,
            top: `${(action.fromY / screen.height) * 100}%`,
          }}
        />
        <span
          className="swipe-marker end"
          style={{
            left: `${(action.toX / screen.width) * 100}%`,
            top: `${(action.toY / screen.height) * 100}%`,
          }}
        />
      </>
    )
  }

  return null
}

export default App
