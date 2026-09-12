import {
  BookOpen,
  CheckCircle2,
  LoaderCircle,
  ScrollText,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { IconStop } from './icons'
import { useAppCopy } from './AppContext'
import { Button, IconButton } from './primitives'

type AppTopbarProps = {
  deviceConnected: boolean
  hasModelConfig: boolean
  isAgentRunning?: boolean
  isConfigOpen?: boolean
  isInspectOpen?: boolean
  isTutorialOpen: boolean
  latestLogTitle?: string | null
  modelLabel?: string | null
  runningStep?: number | null
  onOpenConfig: () => void
  onOpenInspect: () => void
  onOpenSettings: () => void
  onReadinessClick?: () => void
  onStopRun?: () => void
  onToggleTutorial: () => void
}

export function AppTopbar({
  deviceConnected,
  hasModelConfig,
  isAgentRunning = false,
  isConfigOpen = false,
  isInspectOpen = false,
  isTutorialOpen,
  latestLogTitle = null,
  modelLabel = null,
  runningStep = null,
  onOpenConfig,
  onOpenInspect,
  onOpenSettings,
  onReadinessClick,
  onStopRun,
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
  const modelChip = modelLabel?.trim() || copy.noModel

  return (
    <header className={isAgentRunning ? 'topbar topbar-running' : 'topbar'}>
      <div className="topbar-brand">
        <img
          alt="WebDroid Agent logo"
          className="app-logo"
          src="/webdroid-agent-logo-128.png"
        />
        <div className="topbar-brand-copy">
          <h1>WebDroid Agent</h1>
          <span className="topbar-product-tag">{copy.operatorConsoleTag}</span>
        </div>
      </div>

      <div className="command-center" aria-label={copy.readinessStatus}>
        {isAgentRunning ? (
          <div className="run-strip" role="status">
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
            <span className="run-strip-label">{runningLabel}</span>
            {onStopRun ? (
              <Button
                variant="danger"
                size="sm"
                className="run-strip-stop"
                aria-label={copy.stopRun}
                onClick={onStopRun}
              >
                <IconStop size={12} />
                <span>{copy.stopRun}</span>
              </Button>
            ) : null}
          </div>
        ) : readinessReady ? (
          <div className="command-meta">
            <span className="status ok readiness-pill" title={copy.agentReady}>
              <CheckCircle2 size={15} aria-hidden="true" />
              <span className="status-label">{copy.agentReady}</span>
            </span>
            <button
              type="button"
              className="model-chip"
              title={modelChip}
              onClick={onOpenConfig}
            >
              <span className="model-chip-label">{modelChip}</span>
            </button>
          </div>
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
        <IconButton
          size="md"
          aria-expanded={isInspectOpen}
          aria-label={isInspectOpen ? copy.closeInspect : copy.openInspect}
          title={latestLogTitle ? `${copy.inspect}: ${latestLogTitle}` : copy.inspect}
          onClick={onOpenInspect}
          className={isInspectOpen ? 'topbar-icon active' : 'topbar-icon'}
        >
          <ScrollText size={16} />
        </IconButton>
        <IconButton
          size="md"
          aria-expanded={isConfigOpen}
          aria-label={isConfigOpen ? copy.closeConfigurationPanel : copy.openConfigurationPanel}
          title={copy.configurationPanel}
          onClick={onOpenConfig}
          className={isConfigOpen ? 'topbar-icon active' : 'topbar-icon'}
        >
          <SlidersHorizontal size={16} />
        </IconButton>
        <Button
          variant={isTutorialOpen ? 'secondary' : 'ghost'}
          size="sm"
          aria-controls="tutorial-panel"
          aria-expanded={isTutorialOpen}
          aria-label={tutorialButtonLabel}
          onClick={onToggleTutorial}
          className="topbar-tutorial"
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
