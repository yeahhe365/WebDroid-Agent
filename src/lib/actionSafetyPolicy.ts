import type { DeviceState } from '../adapters/deviceTypes'
import type { AgentAction, TakeOverKind } from './actionTypes'

function normalizeNFKC(value: string): string {
  return value.normalize('NFKC')
}

export type ActionSafetyDecision = 'allow' | 'confirm' | 'block' | 'take_over'

export type ActionSafetyPolicyResult = {
  decision: ActionSafetyDecision
  category?: string
  message?: string
  /** Structured reason for a take_over decision, for stable UI cards. */
  takeoverKind?: TakeOverKind
}

export type ActionSafetyContext = {
  task?: string
  currentApp?: string
  deviceState?: DeviceState
  modelOutput?: string
}

const ALLOW: ActionSafetyPolicyResult = { decision: 'allow' }

const PAYMENT_CRITICAL_PATTERNS = [
  /确认付款|立即支付|去支付|付款|转账|提现|充值|提交订单|下单|结算/,
  /\b(pay now|payment|checkout|place order|submit order|buy now|send money|transfer money)\b/i,
]

// Context-level signals that the current screen belongs to a payment flow.
// Deliberately narrow: bare "order" / "订单" also appears in read-only flows
// such as "查看我的订单" (view my orders), and matching it turned every tap into
// a confirmation prompt. Committing actions are still covered by
// PAYMENT_CRITICAL_PATTERNS above.
const PAYMENT_CONTEXT_PATTERNS = [
  /支付|账单|收款|付款|支付宝|微信支付/,
  /\b(payment|checkout|billing|invoice|wallet|paypal|venmo|cash app|place order|submit order)\b/i,
]

const SECRET_OR_LOGIN_PATTERNS = [
  /密码|验证码|校验码|动态码|短信码|口令|人机验证|验证码|登录|登陆/,
  /\b(password|passcode|verification code|one[- ]?time code|otp|captcha|login|log in|sign in|2fa|mfa)\b/i,
]

const CAPTCHA_EVIDENCE_PATTERNS = [
  /验证码|校验码|动态码|短信码|人机验证/,
  /\b(captcha|verification code|one[- ]?time code|otp|2fa|mfa)\b/i,
]

const LOGIN_EVIDENCE_PATTERNS = [
  /密码|口令|登录|登陆/,
  /\b(password|passcode|login|log in|sign in)\b/i,
]

const DESTRUCTIVE_CRITICAL_PATTERNS = [
  /注销账号|删除账号|删除账户|恢复出厂|格式化/,
  /\b(delete account|remove account|close account|factory reset|format device)\b/i,
]

const DESTRUCTIVE_CONFIRM_PATTERNS = [
  /删除|移除|清空|卸载|重置|禁用/,
  /\b(delete|remove|clear|erase|uninstall|reset|disable)\b/i,
]

const AUTHORIZATION_CONFIRM_PATTERNS = [
  /授权|允许|权限|同意|隐私|账号设置|账户设置|安全设置|修改密码/,
  /\b(authorize|approve|allow|grant|permission|consent|privacy|account settings|security settings|change password)\b/i,
]

const PAYMENT_PACKAGE_PATTERNS = [
  /alipay|paypal|bank|wallet|venmo|cashapp/i,
  /com\.eg\.android\.AlipayGphone/i,
]

const MUTATING_ACTIONS = new Set<AgentAction['action']>([
  'tap',
  'long_press',
  'double_tap',
  'input_text',
  'type_secret',
  'open_url',
  'paste',
  'set_clipboard',
  'key',
])

export function evaluateActionSafety(
  action: AgentAction,
  context: ActionSafetyContext = {},
): ActionSafetyPolicyResult {
  if (!MUTATING_ACTIONS.has(action.action)) {
    return ALLOW
  }

  const evidence = collectPolicyEvidence(action, context)
  const isPaymentApp = matchesAny(evidence.device, PAYMENT_PACKAGE_PATTERNS)

  // `type_secret` is the sanctioned way to enter a password: the value never
  // reaches the model or the logs. Treating its own reason ("enter the
  // password") as a login step would block the only safe path, so the
  // secret/login takeover rule does not apply to it. Irreversible-action
  // checks below still do.
  if (action.action !== 'type_secret' && matchesAny(evidence.all, SECRET_OR_LOGIN_PATTERNS)) {
    return {
      decision: 'take_over',
      category: 'secret_or_login',
      takeoverKind: secretOrLoginTakeoverKind(evidence.all),
      message:
        'Safety policy requires manual takeover for login, password, captcha, or verification-code steps.',
    }
  }

  if (matchesAny(evidence.all, DESTRUCTIVE_CRITICAL_PATTERNS)) {
    return {
      decision: 'block',
      category: 'critical_destructive',
      message:
        'Safety policy blocked a potentially irreversible account or device destructive action.',
    }
  }

  if (matchesAny(evidence.all, PAYMENT_CRITICAL_PATTERNS)) {
    return {
      decision: 'block',
      category: 'payment',
      message: 'Safety policy blocked a payment, checkout, order, or money-transfer action.',
    }
  }

  if (matchesAny(evidence.all, DESTRUCTIVE_CONFIRM_PATTERNS)) {
    return {
      decision: 'confirm',
      category: 'destructive',
      message: 'Safety policy requires confirmation before a destructive action.',
    }
  }

  if (matchesAny(evidence.all, AUTHORIZATION_CONFIRM_PATTERNS)) {
    return {
      decision: 'confirm',
      category: 'authorization',
      message: 'Safety policy requires confirmation before authorization, permission, or account-setting changes.',
    }
  }

  if (isPaymentApp || matchesAny(evidence.actionOrDevice, PAYMENT_CONTEXT_PATTERNS)) {
    return {
      decision: 'confirm',
      category: 'payment_context',
      message: 'Safety policy requires confirmation inside payment, billing, wallet, or order flows.',
    }
  }

  return ALLOW
}

/**
 * Irreversible actions are always blocked (require manual takeover) regardless of
 * `unrestrictedMode`. These are operations like factory reset, account deletion, and
 * payment/wire transfer that cannot be undone once executed.
 */
export function evaluateIrreversibleSafety(
  action: AgentAction,
  context: ActionSafetyContext = {},
): ActionSafetyPolicyResult | null {
  if (!MUTATING_ACTIONS.has(action.action)) {
    return null
  }

  const evidence = collectPolicyEvidence(action, context)

  if (matchesAny(evidence.all, DESTRUCTIVE_CRITICAL_PATTERNS)) {
    return {
      decision: 'block',
      category: 'critical_destructive',
      message:
        'Irreversible action blocked by safety policy. Factory reset, account deletion, and similar operations always require manual takeover — even in unrestricted mode.',
    }
  }

  if (matchesAny(evidence.all, PAYMENT_CRITICAL_PATTERNS)) {
    return {
      decision: 'block',
      category: 'payment',
      message:
        'Payment action blocked by safety policy. Payments, transfers, and checkouts always require manual takeover — even in unrestricted mode.',
    }
  }

  return null
}

function collectPolicyEvidence(action: AgentAction, context: ActionSafetyContext) {
  const actionFields = [
    'reason' in action ? action.reason : undefined,
    action.action === 'tap' ? action.message : undefined,
    action.action === 'input_text' ? action.text : undefined,
    action.action === 'type_secret' ? action.secretId : undefined,
    action.action === 'set_clipboard' ? action.text : undefined,
    action.action === 'open_url' ? action.url : undefined,
    action.action === 'launch' ? action.app : undefined,
    action.action === 'key' ? action.key : undefined,
  ].map((field) => (field ? normalizeNFKC(field) : field))

  const deviceFields = [
    context.currentApp,
    context.deviceState?.app,
    context.deviceState?.packageName,
    context.deviceState?.activity,
  ].map((field) => (field ? normalizeNFKC(field) : field))

  return {
    // The whole task/model output is intentionally included for the critical
    // block rules: if the user's task is "delete account" or "pay now", any
    // candidate action deserves the stricter verdict.
    all: [...actionFields, ...deviceFields, context.task, context.modelOutput]
      .map((field) => (field ? normalizeNFKC(field) : field))
      .join('\n'),
    // Confirmation-level rules look only at the action and the screen, so a
    // read-only task such as "view my orders" does not make every tap prompt.
    actionOrDevice: [...actionFields, ...deviceFields]
      .map((field) => (field ? normalizeNFKC(field) : field))
      .join('\n'),
    device: deviceFields.join('\n'),
  }
}

function matchesAny(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function secretOrLoginTakeoverKind(value: string): TakeOverKind {
  if (matchesAny(value, CAPTCHA_EVIDENCE_PATTERNS)) {
    return 'captcha'
  }
  if (matchesAny(value, LOGIN_EVIDENCE_PATTERNS)) {
    return 'login'
  }
  return 'other'
}
