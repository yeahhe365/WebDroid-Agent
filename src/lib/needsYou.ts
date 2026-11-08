import type { TakeOverKind } from './actionTypes'
import type { AgentThreadStatus, ReviewKind } from './agentThread'
import type { FailureClass } from './failureTaxonomy'

export type NeedsYouKind =
  | 'takeover'
  | 'login'
  | 'captcha'
  | 'payment'
  | 'review'
  | 'answer'
  | 'paused'
  | 'stopped'
  | 'error'

const TAKEOVER_CARD: Record<TakeOverKind, NeedsYouKind> = {
  login: 'login',
  captcha: 'captcha',
  payment: 'payment',
  other: 'takeover',
}

export function needsYouKind(
  status: AgentThreadStatus,
  failureClass?: FailureClass,
  message?: string,
  takeoverKind?: TakeOverKind,
  reviewKind?: ReviewKind,
): NeedsYouKind | null {
  if (status === 'awaiting_takeover') {
    return cardForTakeoverKind(takeoverKind) ?? takeoverKindFromMessage(message)
  }
  if (status === 'awaiting_review') {
    if (reviewKind === 'answer') {
      return 'answer'
    }
    if (reviewKind) {
      return 'review'
    }
    return isQuestion(message) ? 'answer' : 'review'
  }
  if (status === 'paused') {
    return 'paused'
  }
  if (status === 'stopped') {
    return failureClass === 'aborted' ? 'paused' : 'stopped'
  }
  if (status === 'error') {
    return 'error'
  }
  return null
}

function cardForTakeoverKind(kind?: TakeOverKind): NeedsYouKind | null {
  return kind ? TAKEOVER_CARD[kind] ?? null : null
}

function takeoverKindFromMessage(message?: string): NeedsYouKind {
  const text = message?.toLowerCase() ?? ''
  if (/验证码|captcha|verification|人机验证/.test(text)) {
    return 'captcha'
  }
  if (/登录|login|sign in|password|密码/.test(text)) {
    return 'login'
  }
  if (/付款|支付|payment|pay\b|checkout|下单/.test(text)) {
    return 'payment'
  }
  return 'takeover'
}

function isQuestion(message?: string) {
  return Boolean(message && /[?？]\s*$/.test(message.trim()))
}
