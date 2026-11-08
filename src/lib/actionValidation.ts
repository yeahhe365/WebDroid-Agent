import {
  canonicalActionName,
  isSupportedKey,
  normalizeKey,
} from './actionAliases'
import type { ActionCoordinateMode } from './actionProtocol'
import {
  readPointCoordinates,
  readSwipeCoordinates,
  type ActionCoordinateReader,
} from './actionCoordinates'
import { ActionValidationError } from './actionTypes'
import type {
  AgentAction,
  ExecutableAtomicAction,
  ScreenSize,
  TakeOverKind,
  TapAction,
} from './actionTypes'

const MAX_SEQUENCE_ACTIONS = 8
const MAX_REPEAT_COUNT = 10
const MAX_REPEAT_DELAY_MS = 5000
const MAX_COMPOSITE_ACTION_DEPTH = 1

const TAKE_OVER_KIND_ALIASES: Record<string, TakeOverKind> = {
  captcha: 'captcha',
  verification: 'captcha',
  verification_code: 'captcha',
  verify: 'captcha',
  otp: 'captcha',
  one_time_code: 'captcha',
  '2fa': 'captcha',
  mfa: 'captcha',
  sms_code: 'captcha',
  login: 'login',
  log_in: 'login',
  signin: 'login',
  sign_in: 'login',
  password: 'login',
  passcode: 'login',
  auth: 'login',
  authentication: 'login',
  credentials: 'login',
  payment: 'payment',
  pay: 'payment',
  checkout: 'payment',
  purchase: 'payment',
  order: 'payment',
  billing: 'payment',
  transfer: 'payment',
  wallet: 'payment',
  other: 'other',
  takeover: 'other',
  take_over: 'other',
  generic: 'other',
  manual: 'other',
  unknown: 'other',
  none: 'other',
}
export type ActionValidationOptions = {
  coordinateMode?: ActionCoordinateMode
}

export function validateAction(
  candidate: unknown,
  screen?: ScreenSize,
  options: ActionValidationOptions = {},
): AgentAction {
  return validateActionAtDepth(candidate, screen, 0, options.coordinateMode ?? 'screenshot_pixels')
}

function validateActionAtDepth(
  candidate: unknown,
  screen: ScreenSize | undefined,
  depth: number,
  coordinateMode: ActionCoordinateMode,
): AgentAction {
  if (!isRecord(candidate)) {
    throw new ActionValidationError('Action must be a JSON object.')
  }

  if (typeof candidate.action !== 'string') {
    throw new ActionValidationError('Action must include an action name.')
  }

  const action = canonicalActionName(candidate.action)

  switch (action) {
    case 'launch': {
      const app = readFirstString(candidate, ['app'])
      const explicitPackageName = optionalString(candidate, 'packageName')
      if (explicitPackageName && !isValidPackageName(explicitPackageName)) {
        throw new ActionValidationError('packageName must be a valid Android package name.')
      }
      const packageName = explicitPackageName ?? optionalPackageNameFromApp(app)
      return withReason(packageName ? { action, app, packageName } : { action, app }, candidate)
    }
    case 'tap': {
      const { x, y } = readPoint(candidate, screen, coordinateMode)
      assertPointWithinScreen(x, y, screen)
      return withTapMetadata({ action, x, y }, candidate)
    }
    case 'swipe': {
      const { fromX, fromY, toX, toY } = readSwipePoints(candidate, screen, coordinateMode)
      assertPointWithinScreen(fromX, fromY, screen)
      assertPointWithinScreen(toX, toY, screen)
      const durationMs = readSwipeDurationMs(candidate, 400)
      return withReason({ action, fromX, fromY, toX, toY, durationMs }, candidate)
    }
    case 'input_text': {
      const text = readFirstString(candidate, ['text'])
      if (hasControlCharacters(text)) {
        throw new ActionValidationError('input_text cannot contain control characters.')
      }
      if (text.length > 500) {
        throw new ActionValidationError('input_text is limited to 500 characters.')
      }
      const clear = readOptionalBoolean(candidate, ['clear']) ?? false
      return withReason(clear ? { action, text, clear } : { action, text }, candidate)
    }
    case 'type_secret': {
      const secretId = readFirstString(candidate, ['secretId'])
      const clear = readOptionalBoolean(candidate, ['clear']) ?? false
      return withReason(clear ? { action, secretId, clear } : { action, secretId }, candidate)
    }
    case 'open_url': {
      const url = readFirstString(candidate, ['url'])
      if (hasControlCharacters(url)) {
        throw new ActionValidationError('open_url cannot contain control characters.')
      }
      if (url.length > 2048) {
        throw new ActionValidationError('open_url is limited to 2048 characters.')
      }
      if (!hasAllowedUriScheme(url)) {
        throw new ActionValidationError('open_url scheme must be one of: http, https, mailto, tel, market.')
      }
      return withReason({ action, url }, candidate)
    }
    case 'set_clipboard': {
      const text = readFirstString(candidate, ['text'])
      if (hasControlCharacters(text)) {
        throw new ActionValidationError('set_clipboard cannot contain control characters.')
      }
      if (text.length > 4000) {
        throw new ActionValidationError('set_clipboard is limited to 4000 characters.')
      }
      return withReason({ action, text }, candidate)
    }
    case 'paste':
      return withReason({ action }, candidate)
    case 'key': {
      const key = normalizeKey(readFirstString(candidate, ['key']))
      if (!isSupportedKey(key)) {
        throw new ActionValidationError(`Unsupported key "${key}".`)
      }
      return withReason({ action, key }, candidate)
    }
    case 'back':
      return withReason({ action }, candidate)
    case 'home':
      return withReason({ action }, candidate)
    case 'long_press': {
      const { x, y } = readPoint(candidate, screen, coordinateMode)
      assertPointWithinScreen(x, y, screen)
      const durationMs = readLongPressDurationMs(candidate, 800)
      return withReason({ action, x, y, durationMs }, candidate)
    }
    case 'double_tap': {
      const { x, y } = readPoint(candidate, screen, coordinateMode)
      assertPointWithinScreen(x, y, screen)
      return withReason({ action, x, y }, candidate)
    }
    case 'wait': {
      const ms = readWaitDurationMs(candidate)
      return withReason({ action, ms }, candidate)
    }
    case 'take_over': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'reason') ??
        'Manual takeover requested.'
      const kind = readTakeOverKind(candidate.kind)
      return withReason(kind ? { action, kind, message } : { action, message }, candidate)
    }
    case 'note': {
      const message = optionalString(candidate, 'message') ?? 'Observation noted.'
      return withReason({ action, message }, candidate)
    }
    case 'interact': {
      const message =
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'content') ??
        'User interaction required.'
      return withReason({ action: 'take_over', message }, candidate)
    }
    case 'call_api': {
      const instruction =
        optionalString(candidate, 'instruction') ??
        optionalString(candidate, 'message') ??
        optionalString(candidate, 'content') ??
        'Summarize the recorded context.'
      return withReason(
        { action: 'take_over', message: `Unsupported call_api requested: ${instruction}` },
        candidate,
      )
    }
    case 'custom_tool': {
      const tool = readFirstString(candidate, ['tool'])
      const input = readCustomToolInput(candidate)
      return withReason(
        input === undefined ? { action, tool } : { action, tool, input },
        candidate,
      )
    }
    case 'view_screenshot': {
      const ref = optionalString(candidate, 'ref')
      const step = readOptionalPositiveInteger(candidate, ['step'])

      if (!ref && step === undefined) {
        throw new ActionValidationError('view_screenshot must include a ref or step.')
      }

      return withReason(
        {
          action,
          ...(ref ? { ref } : {}),
          ...(step === undefined ? {} : { step }),
        },
        candidate,
      )
    }
    case 'sequence': {
      assertCompositeActionDepth(depth)
      const actions = readActionList(candidate, screen, depth, coordinateMode)
      return withReason({ action, actions }, candidate)
    }
    case 'repeat': {
      assertCompositeActionDepth(depth)
      const actionToRepeat = readRepeatAction(candidate, screen, depth, coordinateMode)
      const count = readRepeatCount(candidate)
      const delayMs = readOptionalDelayMs(candidate)
      return withReason(
        delayMs === undefined
          ? { action, count, actionToRepeat }
          : { action, count, actionToRepeat, delayMs },
        candidate,
      )
    }
    case 'done': {
      const summary = readCompletionSummary(candidate)
      return withReason(summary ? { action, summary } : { action }, candidate)
    }
    default:
      throw new ActionValidationError(`Unsupported action "${action}".`)
  }
}

function assertPointWithinScreen(x: number, y: number, screen?: ScreenSize) {
  if (!screen) {
    return
  }

  if (x < 0 || y < 0 || x >= screen.width || y >= screen.height) {
    throw new ActionValidationError(
      `Point (${x}, ${y}) is outside the current screen ${screen.width}x${screen.height}.`,
    )
  }
}

function readInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (!Number.isInteger(value)) {
    throw new ActionValidationError(`${key} must be an integer.`)
  }
  return value as number
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ActionValidationError(`${key} must be a number.`)
  }
  return value
}

function readWaitDurationMs(record: Record<string, unknown>) {
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 100, 10000)
  }
  if ('seconds' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'seconds') * 1000), 100, 10000)
  }
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 100, 10000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 100, 10000)
  }
  return 1000
}

function readSwipeDurationMs(record: Record<string, unknown>, defaultDurationMs: number) {
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 100, 2000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 100, 2000)
  }
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 100, 2000)
  }
  return defaultDurationMs
}

function readLongPressDurationMs(record: Record<string, unknown>, defaultDurationMs: number) {
  if ('durationMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'durationMs')), 500, 5000)
  }
  if ('ms' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'ms')), 500, 5000)
  }
  if ('duration' in record) {
    return clamp(Math.round(readDurationSeconds(record, 'duration') * 1000), 500, 5000)
  }
  return defaultDurationMs
}

function readDurationSeconds(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^-?\d+(\.\d+)?/)
    if (match) {
      return Number(match[0])
    }
  }
  throw new ActionValidationError(`${key} must be a number of seconds.`)
}

function readCompletionSummary(record: Record<string, unknown>) {
  return optionalString(record, 'summary')
}

function readFirstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = optionalString(record, key)
    if (value) {
      return value
    }
  }

  throw new ActionValidationError(`${keys[0]} must be a non-empty string.`)
}

function readOptionalBoolean(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!(key in record)) {
      continue
    }
    const value = record[key]
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      if (/^true$/i.test(value)) {
        return true
      }
      if (/^false$/i.test(value)) {
        return false
      }
    }
    throw new ActionValidationError(`${key} must be a boolean.`)
  }
  return undefined
}

function readActionList(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  depth: number,
  coordinateMode: ActionCoordinateMode,
) {
  const value = record.actions
  if (!Array.isArray(value)) {
    throw new ActionValidationError('sequence actions must be an array.')
  }
  if (value.length === 0) {
    throw new ActionValidationError('sequence must include at least one action.')
  }
  if (value.length > MAX_SEQUENCE_ACTIONS) {
    throw new ActionValidationError(`sequence is limited to ${MAX_SEQUENCE_ACTIONS} actions.`)
  }

  return value.map((item) => validateCompositeChildAction(item, screen, depth, coordinateMode))
}

function readRepeatAction(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  depth: number,
  coordinateMode: ActionCoordinateMode,
) {
  const value = record.actionToRepeat
  if (value === undefined) {
    throw new ActionValidationError('repeat must include actionToRepeat.')
  }
  return validateCompositeChildAction(value, screen, depth, coordinateMode)
}

function readRepeatCount(record: Record<string, unknown>) {
  const raw = record.count
  if (!Number.isInteger(raw)) {
    throw new ActionValidationError('repeat count must be an integer.')
  }

  const count = raw as number
  if (count < 1 || count > MAX_REPEAT_COUNT) {
    throw new ActionValidationError(`repeat count must be between 1 and ${MAX_REPEAT_COUNT}.`)
  }
  return count
}

function readOptionalDelayMs(record: Record<string, unknown>) {
  if ('delayMs' in record) {
    return clamp(Math.round(readFiniteNumber(record, 'delayMs')), 0, MAX_REPEAT_DELAY_MS)
  }
  return undefined
}

function validateCompositeChildAction(
  candidate: unknown,
  screen: ScreenSize | undefined,
  depth: number,
  coordinateMode: ActionCoordinateMode,
) {
  const action = validateActionAtDepth(candidate, screen, depth + 1, coordinateMode)
  if (!isCompositeChildAction(action)) {
    throw new ActionValidationError(`"${action.action}" cannot be used inside a composite action.`)
  }
  return action
}

function assertCompositeActionDepth(depth: number) {
  if (depth >= MAX_COMPOSITE_ACTION_DEPTH) {
    throw new ActionValidationError('Composite actions cannot be nested.')
  }
}

function isCompositeChildAction(action: AgentAction): action is ExecutableAtomicAction {
  return ![
    'call_api',
    'done',
    'interact',
    'repeat',
    'sequence',
    'take_over',
    'view_screenshot',
  ].includes(action.action)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readTakeOverKind(value: unknown): TakeOverKind | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!normalized) {
    return undefined
  }
  // Unknown values fall back to the generic takeover card instead of rejecting
  // the whole action. The field is presentation metadata, not a safety gate.
  return TAKE_OVER_KIND_ALIASES[normalized] ?? 'other'
}

function withReason<T extends AgentAction>(action: T, source: Record<string, unknown>): T {
  const reason = optionalString(source, 'reason')
  if (!reason) {
    return action
  }

  return { ...action, reason } as T
}

function withTapMetadata(action: TapAction, source: Record<string, unknown>): TapAction {
  const base = withReason(action, source)
  const message = optionalString(source, 'message')
  const risk = optionalString(source, 'risk')

  if (risk && risk !== 'sensitive') {
    throw new ActionValidationError(`Unsupported tap risk "${risk}".`)
  }

  return {
    ...base,
    ...(message ? { message } : {}),
    ...(risk === 'sensitive' ? { risk } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPoint(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  coordinateMode: ActionCoordinateMode,
): { x: number; y: number } {
  return readPointCoordinates(record, screen, coordinateMode, coordinateReaderForMode(coordinateMode))
}

function readOptionalPositiveInteger(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (!(key in record)) {
      continue
    }
    const value = record[key]
    if (Number.isInteger(value) && (value as number) > 0) {
      return value as number
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number(value.trim())
      if (parsed > 0) {
        return parsed
      }
    }
    throw new ActionValidationError(`${key} must be a positive integer.`)
  }
  return undefined
}

function readSwipePoints(
  record: Record<string, unknown>,
  screen: ScreenSize | undefined,
  coordinateMode: ActionCoordinateMode,
): { fromX: number; fromY: number; toX: number; toY: number } {
  return readSwipeCoordinates(record, screen, coordinateMode, coordinateReaderForMode(coordinateMode))
}

function coordinateReaderForMode(coordinateMode: ActionCoordinateMode): ActionCoordinateReader {
  return coordinateMode === 'screenshot_pixels' ? readInteger : readFiniteNumber
}

function readCustomToolInput(record: Record<string, unknown>) {
  if ('input' in record) {
    return record.input
  }
  return undefined
}

function optionalPackageNameFromApp(app: string): string | undefined {
  if (!app.includes('.')) {
    return undefined
  }
  return isValidPackageName(app) ? app : undefined
}

function isValidPackageName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

const ALLOWED_URI_SCHEMES = ['http', 'https', 'mailto', 'tel', 'market'] as const

function hasAllowedUriScheme(value: string): boolean {
  const match = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)
  if (!match) {
    return false
  }
  const scheme = match[1].toLowerCase()
  return (ALLOWED_URI_SCHEMES as readonly string[]).includes(scheme)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
