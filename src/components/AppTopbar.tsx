import { BookOpen, CheckCircle2, LoaderCircle, Settings as SettingsIcon } from 'lucide-react'
import { useAppCopy } from './AppContext'
import { Button, IconButton } from './primitives'

type AppTopbarProps = {
  deviceConnected: boolean
  hasModelConfig: boolean
  isAgentRunning?: boolean
  isTutorialOpen: boolean
  runningStep?: number | null
  onOpenSettings: () => void
  onReadinessClick?: () => void
  onToggleTutorial: () => void
}

export function AppTopbar({
  deviceConnected,
  hasModelConfig,
  isAgentRunning = false,
  isTutorialOpen,
  runningStep = null,
  onOpenSettings,
  onReadinessClick,
  onToggleTutorial,
}: AppTopbarProps) {
  const copy = useAppCopy()
  const tutorialButtonLabel = isTutorialOpen ? copy.closeTutorial : copy.openTutorial
  const readinessReady = deviceConnected && hasModelConfig
  const readinessLabel = readinessReady
    ? copy.agentReady
    : !deviceConnected && !hasModelConfig
      ? copy.readinessNeedsBoth
      : !deviceConnected
        ? copy.readinessNeedsDevice
        : copy.readinessNeedsModel
  const runningLabel =
    runningStep && runningStep > 0
      ? copy.agentRunningStep(runningStep)
      : copy.agentRunningStatus

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img
          alt="WebDroid Agent logo"
          className="app-logo"
          src="/webdroid-agent-logo-128.png"
        />
        <h1>WebDroid Agent</h1>
      </div>
      <div className="status-strip" aria-label={copy.readinessStatus}>
        {isAgentRunning ? (
          <span className="status ok readiness-pill is-running" title={runningLabel}>
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
            <span className="status-label">{runningLabel}</span>
          </span>
        ) : readinessReady ? (
          <span className="status ok readiness-pill" title={copy.agentReady}>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span className="status-label">{copy.agentReady}</span>
          </span>
        ) : (
          <button
            type="button"
            className="status warn readiness-pill readiness-action"
            title={readinessLabel}
            onClick={onReadinessClick}
          >
            <span className="status-label">{readinessLabel}</span>
          </button>
        )}
      </div>
      <div className="topbar-actions">
        <Button
          variant={isTutorialOpen ? 'secondary' : 'ghost'}
          size="sm"
          aria-controls="tutorial-panel"
          aria-expanded={isTutorialOpen}
          aria-label={tutorialButtonLabel}
          onClick={onToggleTutorial}
        >
          <BookOpen size={16} />
          <span className="topbar-button-label">{copy.tutorial}</span>
        </Button>
        <IconButton
          size="md"
          aria-label={copy.settings}
          onClick={onOpenSettings}
          className="settings-button"
        >
          <SettingsIcon size={16} />
        </IconButton>
      </div>
    </header>
  )
}
