import {
  AlertTriangle,
  CreditCard,
  Hand,
  LogIn,
  MessageSquare,
  Pause,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import type { TakeOverKind } from '../lib/actionTypes'
import type { AgentThreadStatus, ReviewKind } from '../lib/agentThread'
import type { AppCopy } from '../lib/appCopy'
import type { FailureClass } from '../lib/failureTaxonomy'
import { needsYouKind, type NeedsYouKind } from '../lib/needsYou'
import { useAppCopy } from './AppContext'
import { Button } from './primitives'

type NeedsYouCardProps = {
  failureClass?: FailureClass
  message?: string
  onAnswer?: () => void
  onContinue: (message: string) => void
  onOpenRunLog: () => void
  onResume?: () => void
  status: AgentThreadStatus
  takeoverKind?: TakeOverKind
  reviewKind?: ReviewKind
}

export function NeedsYouCard({
  failureClass,
  message,
  onAnswer,
  onContinue,
  onOpenRunLog,
  onResume,
  status,
  takeoverKind,
  reviewKind,
}: NeedsYouCardProps) {
  const copy = useAppCopy()
  const kind = needsYouKind(status, failureClass, message, takeoverKind, reviewKind)
  if (!kind) {
    return null
  }

  const view = needsYouView(kind, copy, message)
  const Icon = view.icon
  const actionMessage = needsYouActionMessage(kind, copy)
  const canResume = kind === 'paused' && status === 'paused' && onResume !== undefined
  const primaryLabel = canResume
    ? copy.needsYouResumeRun
    : kind === 'answer'
      ? copy.needsYouAnswerAction
      : needsYouPrimaryLabel(kind, copy)
  const primaryAction = canResume
    ? onResume
    : kind === 'answer' && onAnswer
      ? onAnswer
      : () => onContinue(actionMessage)

  return (
    <article className={`needs-you-card ${kind}`} aria-label={view.title}>
      <div className="needs-you-head">
        <span className="needs-you-icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <div className="needs-you-heading">
          <span className="needs-you-eyebrow">{view.eyebrow}</span>
          <h3>{view.title}</h3>
        </div>
      </div>
      <p className="needs-you-body">{view.body}</p>
      <div className="needs-you-actions">
        <Button variant="primary" size="sm" onClick={primaryAction}>
          {primaryLabel}
        </Button>
        <button type="button" className="needs-you-link" onClick={onOpenRunLog}>
          {copy.needsYouViewProcess}
        </button>
      </div>
    </article>
  )
}

function needsYouView(kind: NeedsYouKind, copy: AppCopy, message?: string) {
  const fallback = message?.trim()
  switch (kind) {
    case 'login':
      return {
        eyebrow: copy.sessionStatusAwaitingTakeover,
        title: copy.needsYouLoginTitle,
        body: fallback || copy.needsYouLoginBody,
        icon: LogIn,
      }
    case 'captcha':
      return {
        eyebrow: copy.sessionStatusAwaitingTakeover,
        title: copy.needsYouCaptchaTitle,
        body: fallback || copy.needsYouCaptchaBody,
        icon: ShieldAlert,
      }
    case 'payment':
      return {
        eyebrow: copy.sessionStatusAwaitingTakeover,
        title: copy.needsYouPaymentTitle,
        body: fallback || copy.needsYouPaymentBody,
        icon: CreditCard,
      }
    case 'takeover':
      return {
        eyebrow: copy.sessionStatusAwaitingTakeover,
        title: copy.needsYouTakeoverTitle,
        body: fallback || copy.needsYouTakeoverBody,
        icon: Hand,
      }
    case 'answer':
      return {
        eyebrow: copy.sessionStatusAwaitingReview,
        title: copy.needsYouAnswerTitle,
        body: fallback || copy.needsYouAnswerBody,
        icon: MessageSquare,
      }
    case 'review':
      return {
        eyebrow: copy.sessionStatusAwaitingReview,
        title: copy.needsYouReviewTitle,
        body: fallback || copy.needsYouReviewBody,
        icon: AlertTriangle,
      }
    case 'paused':
      return {
        eyebrow: copy.sessionStatusPaused,
        title: copy.needsYouPausedTitle,
        body: fallback || copy.needsYouPausedBody,
        icon: Pause,
      }
    case 'error':
      return {
        eyebrow: copy.sessionStatusError,
        title: copy.needsYouErrorTitle,
        body: fallback || copy.needsYouErrorBody,
        icon: XCircle,
      }
    case 'stopped':
    default:
      return {
        eyebrow: copy.sessionStatusStopped,
        title: copy.needsYouStoppedTitle,
        body: fallback || copy.needsYouStoppedBody,
        icon: XCircle,
      }
  }
}

function needsYouPrimaryLabel(kind: NeedsYouKind, copy: AppCopy) {
  if (kind === 'takeover' || kind === 'login' || kind === 'captcha' || kind === 'payment') {
    return copy.needsYouResume
  }
  if (kind === 'review' || kind === 'answer' || kind === 'paused') {
    return copy.needsYouContinue
  }
  return copy.needsYouRetry
}

function needsYouActionMessage(kind: NeedsYouKind, copy: AppCopy) {
  if (kind === 'takeover' || kind === 'login' || kind === 'captcha' || kind === 'payment') {
    return copy.resumeAfterTakeoverMessage
  }
  if (kind === 'review' || kind === 'answer') {
    return copy.resumeAfterReviewMessage
  }
  if (kind === 'paused') {
    return copy.continueAfterStopMessage
  }
  return copy.retryAfterErrorMessage
}
