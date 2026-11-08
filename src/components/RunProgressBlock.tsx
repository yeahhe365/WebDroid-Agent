import {
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  XCircle,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import type { AgentTurn } from '../lib/agentThread'
import type { AppCopy } from '../lib/appCopy'
import { turnNarrative } from '../lib/chatRun'
import { getActionDisplay } from './actionDisplay'
import { useAppCopy } from './AppContext'

type RunProgressBlockProps = {
  active: boolean
  finishedAt?: number
  onOpenRunLog: () => void
  startedAt?: number
  turns: AgentTurn[]
}

type StepTone = 'planned' | 'running' | 'success' | 'failed' | 'review' | 'takeover'

const MAX_VISIBLE_STEPS = 5

export function RunProgressBlock({
  active,
  finishedAt,
  onOpenRunLog,
  startedAt,
  turns,
}: RunProgressBlockProps) {
  const copy = useAppCopy()
  const firstTurn = turns[0]
  const latestTurn = turns[turns.length - 1]
  const start = startedAt ?? (firstTurn ? firstTurn.createdAt - firstTurn.timing.totalMs : undefined)
  const end = finishedAt ??
    (latestTurn?.completedAt ?? (latestTurn ? latestTurn.createdAt + latestTurn.timing.totalMs : undefined))
  const elapsed = useElapsed(start, active, end)
  const tokenCount = turns.reduce((total, turn) => total + (turn.usage?.totalTokens ?? 0), 0)
  const hiddenCount = Math.max(0, turns.length - MAX_VISIBLE_STEPS)
  const visibleTurns = active ? turns.slice(-MAX_VISIBLE_STEPS) : []
  const latestNarrative = latestTurn ? turnNarrative(latestTurn) : ''
  const latestAction = latestTurn
    ? getActionDisplay(latestTurn.action, copy).label
    : copy.runProgressWorking
  const currentLabel = active
    ? latestTurn?.status === 'planned'
      ? copy.runCurrentStep(latestNarrative || latestAction)
      : copy.runProgressThinking
    : copy.runProgressWorking
  const finalTone = latestTurn?.status === 'failed' ? 'failed' : 'success'

  if (turns.length === 0) {
    return null
  }

  return (
    <section
      className={`run-progress-block ${active ? 'is-active' : 'is-complete'}`}
      aria-label={active ? copy.sessionStatusRunning : copy.sessionStatusDone}
    >
      {active ? (
        <div className="run-progress-live-head">
          <span className="run-progress-live-icon" aria-hidden="true">
            <LoaderCircle className="chat-run-status-spinner" size={15} />
          </span>
          <span className="run-progress-live-label">{currentLabel}</span>
          <span className="run-progress-clock" aria-label={copy.runDurationText(elapsed)}>
            {formatClock(elapsed)}
          </span>
        </div>
      ) : (
        <div className="run-progress-summary">
          <span className={`run-progress-summary-icon ${finalTone}`} aria-hidden="true">
            {finalTone === 'failed' ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
          </span>
          <span>{copy.runStepsText(turns.length)}</span>
          <span aria-hidden="true">·</span>
          <span>{copy.runDurationText(elapsed)}</span>
          {tokenCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{copy.runTokensText(tokenCount)}</span>
            </>
          ) : null}
          <button type="button" className="run-progress-link" onClick={onOpenRunLog}>
            {copy.runViewProcess}
          </button>
        </div>
      )}

      {active && hiddenCount > 0 ? (
        <p className="run-progress-earlier">{copy.runEarlierSteps(hiddenCount)}</p>
      ) : null}

      {active && visibleTurns.length > 0 ? (
        <ol className="run-progress-steps">
          {visibleTurns.map((turn, index) => (
            <RunProgressStep
              active={active}
              current={active && index === visibleTurns.length - 1 && turn.status === 'planned'}
              key={turn.id}
              turn={turn}
            />
          ))}
        </ol>
      ) : null}

      {active ? (
        <button type="button" className="run-progress-link run-progress-live-link" onClick={onOpenRunLog}>
          {copy.runViewProcess}
        </button>
      ) : null}
    </section>
  )
}

export function RunProgressPlaceholder({ startedAt }: { startedAt?: number }) {
  const copy = useAppCopy()
  const elapsed = useElapsed(startedAt, true)

  return (
    <section className="run-progress-block is-active" aria-label={copy.sessionStatusRunning}>
      <div className="run-progress-live-head">
        <span className="run-progress-live-icon" aria-hidden="true">
          <LoaderCircle className="chat-run-status-spinner" size={15} />
        </span>
        <span className="run-progress-live-label">{copy.runProgressStarting}</span>
        <span className="run-progress-clock">{formatClock(elapsed)}</span>
      </div>
    </section>
  )
}

function RunProgressStep({
  active,
  current,
  turn,
}: {
  active: boolean
  current: boolean
  turn: AgentTurn
}) {
  const copy = useAppCopy()
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const actionDisplay = getActionDisplay(turn.action, copy)
  const narrative = turnNarrative(turn)
  const tone = stepTone(turn, active, current)
  const status = stepStatusLabel(turn, copy, active, current)
  const result = turn.executionResult?.trim() || copy.stepNoResult

  return (
    <li className={`run-progress-step ${tone}`}>
      <span className="run-progress-dot" aria-hidden="true" />
      <button
        type="button"
        className="run-progress-step-main"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        aria-label={`${copy.step} ${turn.index}: ${actionDisplay.label}`}
        aria-current={current ? 'step' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="run-progress-step-index">#{turn.index}</span>
        <span className="run-progress-step-copy">
          <span className="run-progress-step-action">{actionDisplay.label}</span>
          {narrative && narrative !== actionDisplay.label ? (
            <span className="run-progress-step-narrative">{narrative}</span>
          ) : null}
        </span>
        <span className="run-progress-step-status">{status}</span>
        <span className="run-progress-step-time">
          {formatStepTiming(turn.timing.totalMs, copy)}
        </span>
        <ChevronDown
          className={`run-progress-step-chevron${open ? ' is-open' : ''}`}
          size={13}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="run-progress-step-detail" id={detailId}>
          <DetailRow label={copy.runStepResult} value={result} />
          <DetailRow label={copy.stepAction} value={turn.preview} />
          {turn.toolName ? <DetailRow label={copy.runStepTool} value={turn.toolName} /> : null}
          <DetailRow label={copy.runStepApp} value={turn.deviceSnapshot.currentApp} />
          {turn.modelOutput.trim() ? (
            <DetailRow label={copy.runStepModelOutput} value={turn.modelOutput} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-progress-detail-row">
      <span>{label}</span>
      <pre>{value}</pre>
    </div>
  )
}

function stepTone(turn: AgentTurn, active: boolean, current: boolean): StepTone {
  if (turn.status === 'failed') {
    return 'failed'
  }
  if (turn.status === 'awaiting_review') {
    return 'review'
  }
  if (turn.status === 'awaiting_takeover') {
    return 'takeover'
  }
  if (current) {
    return active ? 'running' : 'success'
  }
  if (turn.status === 'planned') {
    return active ? 'running' : 'planned'
  }
  return 'success'
}

function stepStatusLabel(
  turn: AgentTurn,
  copy: AppCopy,
  active: boolean,
  current: boolean,
) {
  if (current) {
    return copy.stepStatusRunning
  }
  switch (turn.status) {
    case 'planned':
      return active ? copy.stepStatusRunning : copy.stepStatusPlanned
    case 'failed':
      return copy.stepStatusFailed
    case 'awaiting_review':
      return copy.stepStatusAwaitingReview
    case 'awaiting_takeover':
      return copy.stepStatusTakeover
    case 'done':
      return copy.stepStatusDone
    case 'executed':
    default:
      return copy.stepStatusExecuted
  }
}

function useElapsed(startedAt: number | undefined, active: boolean, finishedAt?: number) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || startedAt === undefined) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, startedAt])

  if (startedAt === undefined) {
    return 0
  }
  const end = active ? now : (finishedAt ?? startedAt)
  return Math.max(0, end - startedAt)
}

function formatClock(totalMs: number) {
  const seconds = Math.max(0, Math.round(totalMs / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatStepTiming(totalMs: number, copy: AppCopy) {
  const seconds = Math.max(0, Math.round(totalMs / 1000))
  if (totalMs > 0 && seconds === 0) {
    return copy.stepTimingLessThanSecond
  }
  return copy.stepTimingSeconds(seconds)
}
