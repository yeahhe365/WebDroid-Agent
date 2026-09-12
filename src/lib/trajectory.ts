import type { DeviceState } from '../adapters/deviceTypes'
import type {
  AgentScreenshotReference,
  AgentThread,
  AgentThreadEvent,
  AgentThreadStatus,
  AgentTurn,
  AgentTurnTiming,
} from './agentThread'
import type { AgentRunStatus } from './agent'
import type { ActionCoordinateMode, ActionProtocol } from './actionProtocol'
import type { ActionSafetyDecision } from './actionSafetyPolicy'
import type { AgentAction, ExecutableAtomicAction, ScreenSize } from './actionTypes'
import { coordinateModeForActionProtocol } from './coordinateSystems'
import type { FailureClass } from './failureTaxonomy'

export const TRAJECTORY_SCHEMA_VERSION = 1

/**
 * The device name is a fixed literal on purpose: `AgentTurn` carries no serial
 * (and no device name) at all, so this is structural sanitisation rather than a
 * filter that a later refactor could defeat.
 */
const TRAJECTORY_DEVICE_NAME = 'android-device'

/**
 * Portable, synchronous, dependency-free digest. Not a security hash.
 *
 * The projection is a sync pure function and neither runtime offers a sync
 * cryptographic hash (the browser only has async `crypto.subtle`), so v1 uses
 * FNV-1a 32-bit to answer "did this context change?" instead of sha256.
 */
export function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

export type TrajectoryStep = {
  index: number
  turnId: string
  timing: AgentTurnTiming
  currentApp: string
  deviceState: DeviceState
  context: { chars: number; digest: string } | { text: string }
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  toolName?: string
  executionResult: string
  success?: boolean
  failure?: { class: FailureClass; message: string }
  safetyDecision?: ActionSafetyDecision
  deviceCommands?: string[][]
  screenshot?: { id: string; step: number; screen: ScreenSize; modelScreen?: ScreenSize }
}

export type TrajectoryArtifact = {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION
  kind: 'webdroid.trajectory'
  exportedAt: string
  app: { version: string }
  run: {
    runId: string
    threadId: string
    task: string
    status: AgentRunStatus
    startedAt: number
    endedAt?: number
    partial: boolean
    stepTurnIds: string[]
  }
  model: {
    provider?: string
    model: string
    actionProtocol: ActionProtocol
    coordinateMode: ActionCoordinateMode
  }
  device: {
    name: string
    screen: ScreenSize
    modelScreen?: ScreenSize
    orientation?: string
  }
  steps: TrajectoryStep[]
  /**
   * `reason` / `finalResponse` are part of the v1 shape but have no projection
   * source yet; the projection writes `failureClass` only.
   */
  outcome: { failureClass?: FailureClass; reason?: string; finalResponse?: string }
}

export type BuildTrajectoryInput = {
  thread: AgentThread
  runId: string
  includeContext?: boolean
  model: { provider?: string; model: string; actionProtocol: ActionProtocol }
  coordinateMode?: ActionCoordinateMode
  now?: number
}

type ThreadStatusChangeEvent = Extract<AgentThreadEvent, { type: 'status_change' }>

/**
 * Projects one recorded run into a versioned, sanitised artifact.
 *
 * The projection is an **allowlist**: every field below is built by hand, so
 * `device.serial`, `model.baseUrl`, `model.apiKey`, secret values, screenshot
 * pixels (`data:image`) and the full `promptContext` have no path into the
 * artifact — even if a source record grows a new sensitive field later.
 */
export function buildTrajectoryArtifact(input: BuildTrajectoryInput): TrajectoryArtifact {
  // A thread with no run id has no run to slice out: it must not fall back to
  // "all turns" and it must not throw.
  const turns =
    input.runId === ''
      ? []
      : input.thread.turns.filter((turn) => turn.runId === input.runId)
  const firstTurn = turns[0]
  const endedAt = turns.at(-1)?.completedAt
  const failureClass = deriveRunFailureClass(turns, input.thread)
  // The screenshot reference for the run's first step describes the device the
  // run started on; `startThreadTurn` strips the screenshot from the turn, so
  // geometry can only come from `thread.screenshotReferences`.
  const deviceReference = firstTurn
    ? findScreenshotReference(input.thread, firstTurn.index)
    : undefined

  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    kind: 'webdroid.trajectory',
    exportedAt: new Date(input.now ?? Date.now()).toISOString(),
    app: { version: appVersion() },
    run: presentFields({
      runId: input.runId,
      threadId: input.thread.id,
      task: input.thread.task,
      status: projectRunStatus(input.thread.status),
      startedAt: firstTurn?.createdAt ?? input.thread.createdAt,
      endedAt,
      partial:
        input.runId === '' || input.thread.status === 'running' || endedAt === undefined,
      stepTurnIds: turns.map((turn) => turn.id),
    }),
    model: presentFields({
      provider: input.model.provider,
      model: input.model.model,
      actionProtocol: input.model.actionProtocol,
      coordinateMode:
        input.coordinateMode ??
        coordinateModeForActionProtocol(input.model.actionProtocol),
    }),
    device: presentFields({
      name: TRAJECTORY_DEVICE_NAME,
      screen: projectScreen(deviceReference?.screenshot?.screen) ?? { width: 0, height: 0 },
      modelScreen: projectScreen(deviceReference?.screenshot?.modelScreen),
      orientation: firstTurn?.deviceSnapshot.deviceState.orientation,
    }),
    steps: turns.map((turn) => projectStep(turn, input.thread, input.includeContext === true)),
    outcome: failureClass === undefined ? {} : { failureClass },
  }
}

export function serializeTrajectory(artifact: TrajectoryArtifact): string {
  return JSON.stringify(artifact, null, 2)
}

export function isTrajectoryArtifact(value: unknown): value is TrajectoryArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    candidate.schemaVersion === TRAJECTORY_SCHEMA_VERSION &&
    candidate.kind === 'webdroid.trajectory' &&
    Array.isArray(candidate.steps)
  )
}

function projectStep(
  turn: AgentTurn,
  thread: AgentThread,
  includeContext: boolean,
): TrajectoryStep {
  const step: TrajectoryStep = {
    index: turn.index,
    turnId: turn.id,
    timing: projectTiming(turn.timing),
    currentApp: turn.deviceSnapshot.currentApp,
    deviceState: projectDeviceState(turn.deviceSnapshot.deviceState),
    context: projectContext(turn.promptContext, includeContext),
    modelOutput: turn.modelOutput,
    action: projectAction(turn.action),
    executionAction: projectAction(turn.executionAction),
    executionResult: turn.executionResult ?? '',
  }

  if (turn.toolName !== undefined) {
    step.toolName = turn.toolName
  }
  if (turn.success !== undefined) {
    step.success = turn.success
  }
  // A `failure` block exists only where the source recorded a class; the
  // message is the recorded execution result, never a re-derived summary.
  if (turn.failureClass !== undefined) {
    step.failure = { class: turn.failureClass, message: turn.executionResult ?? '' }
  }
  if (turn.safetyDecision !== undefined) {
    step.safetyDecision = turn.safetyDecision
  }
  const deviceCommands = projectDeviceCommands(turn)
  if (deviceCommands !== undefined) {
    step.deviceCommands = deviceCommands
  }
  const screenshot = projectScreenshotReference(findScreenshotReference(thread, turn.index))
  if (screenshot !== undefined) {
    step.screenshot = screenshot
  }

  return step
}

function projectTiming(timing: AgentTurnTiming): AgentTurnTiming {
  return presentFields({
    captureMs: timing.captureMs,
    currentAppMs: timing.currentAppMs,
    executionMs: timing.executionMs,
    modelMs: timing.modelMs,
    parseMs: timing.parseMs,
    totalMs: timing.totalMs,
  })
}

function projectDeviceState(state: DeviceState): DeviceState {
  return presentFields({
    app: state.app,
    packageName: state.packageName,
    activity: state.activity,
    orientation: state.orientation,
    keyboard: state.keyboard,
  })
}

function projectContext(
  promptContext: string,
  includeContext: boolean,
): TrajectoryStep['context'] {
  return includeContext
    ? { text: promptContext }
    : { chars: promptContext.length, digest: fnv1a32(promptContext) }
}

function projectScreenshotReference(
  reference: AgentScreenshotReference | undefined,
): NonNullable<TrajectoryStep['screenshot']> | undefined {
  const screen = projectScreen(reference?.screenshot?.screen)
  if (!reference || !screen) {
    return undefined
  }

  // Only reference metadata survives: `screenshot.dataUrl` / `bytes` never
  // enter the artifact because no line here reads them.
  return presentFields({
    id: reference.id,
    step: reference.step,
    screen,
    modelScreen: projectScreen(reference.screenshot?.modelScreen),
  })
}

/**
 * Copies the argv a step attempted to send, with one structural exception:
 * `toolRegistry` resolves `type_secret` into an `input_text` command carrying
 * the real value, so the argv of such a step *is* the secret. The milestone
 * rule is "secrets are recorded as descriptor ids only", so that argv is
 * dropped by action shape — never by pattern-matching argv strings.
 */
function projectDeviceCommands(turn: AgentTurn): string[][] | undefined {
  if (!turn.deviceCommands || turn.deviceCommands.length === 0) {
    return undefined
  }
  if (actionRecordsSecretValue(turn.action) || actionRecordsSecretValue(turn.executionAction)) {
    return undefined
  }
  return turn.deviceCommands.map((argv) => argv.slice())
}

/** Action kinds that make the recorded argv carry a resolved secret value. */
const SECRET_BEARING_ACTIONS: Record<AgentAction['action'], boolean> = {
  type_secret: true,
  tap: false,
  swipe: false,
  launch: false,
  input_text: false,
  open_url: false,
  set_clipboard: false,
  paste: false,
  key: false,
  back: false,
  home: false,
  long_press: false,
  double_tap: false,
  wait: false,
  take_over: false,
  note: false,
  interact: false,
  call_api: false,
  custom_tool: false,
  view_screenshot: false,
  sequence: false,
  repeat: false,
  done: false,
}

function actionRecordsSecretValue(action: AgentAction): boolean {
  if (action.action === 'sequence') {
    return action.actions.some((child) => actionRecordsSecretValue(child))
  }
  if (action.action === 'repeat') {
    return actionRecordsSecretValue(action.actionToRepeat)
  }
  return SECRET_BEARING_ACTIONS[action.action]
}

/**
 * Rebuilds an action field by field. A new field on an existing variant is
 * dropped until it is allowed here on purpose — that is the point of an
 * allowlist. A new action variant is a compile error, not a silent gap.
 */
function projectAction(action: AgentAction): AgentAction {
  switch (action.action) {
    case 'tap':
      return presentFields({
        action: 'tap' as const,
        x: action.x,
        y: action.y,
        message: action.message,
        risk: action.risk,
        reason: action.reason,
      })
    case 'swipe':
      return presentFields({
        action: 'swipe' as const,
        fromX: action.fromX,
        fromY: action.fromY,
        toX: action.toX,
        toY: action.toY,
        durationMs: action.durationMs,
        reason: action.reason,
      })
    case 'launch':
      return presentFields({
        action: 'launch' as const,
        app: action.app,
        packageName: action.packageName,
        reason: action.reason,
      })
    case 'input_text':
      return presentFields({
        action: 'input_text' as const,
        text: action.text,
        clear: action.clear,
        reason: action.reason,
      })
    case 'type_secret':
      // The secret value is deliberately absent from the source action too:
      // only its descriptor id is ever recorded.
      return presentFields({
        action: 'type_secret' as const,
        secretId: action.secretId,
        clear: action.clear,
        reason: action.reason,
      })
    case 'open_url':
      return presentFields({
        action: 'open_url' as const,
        url: action.url,
        reason: action.reason,
      })
    case 'set_clipboard':
      return presentFields({
        action: 'set_clipboard' as const,
        text: action.text,
        reason: action.reason,
      })
    case 'paste':
      return presentFields({ action: 'paste' as const, reason: action.reason })
    case 'key':
      return presentFields({
        action: 'key' as const,
        key: action.key,
        reason: action.reason,
      })
    case 'back':
      return presentFields({ action: 'back' as const, reason: action.reason })
    case 'home':
      return presentFields({ action: 'home' as const, reason: action.reason })
    case 'long_press':
      return presentFields({
        action: 'long_press' as const,
        x: action.x,
        y: action.y,
        durationMs: action.durationMs,
        reason: action.reason,
      })
    case 'double_tap':
      return presentFields({
        action: 'double_tap' as const,
        x: action.x,
        y: action.y,
        reason: action.reason,
      })
    case 'wait':
      return presentFields({
        action: 'wait' as const,
        ms: action.ms,
        reason: action.reason,
      })
    case 'take_over':
      return presentFields({
        action: 'take_over' as const,
        message: action.message,
        reason: action.reason,
      })
    case 'note':
      return presentFields({
        action: 'note' as const,
        message: action.message,
        reason: action.reason,
      })
    case 'interact':
      return presentFields({
        action: 'interact' as const,
        message: action.message,
        reason: action.reason,
      })
    case 'call_api':
      return presentFields({
        action: 'call_api' as const,
        instruction: action.instruction,
        reason: action.reason,
      })
    case 'custom_tool':
      return presentFields({
        action: 'custom_tool' as const,
        tool: action.tool,
        input: action.input,
        reason: action.reason,
      })
    case 'view_screenshot':
      return presentFields({
        action: 'view_screenshot' as const,
        ref: action.ref,
        step: action.step,
        reason: action.reason,
      })
    case 'sequence':
      return presentFields({
        action: 'sequence' as const,
        actions: action.actions.map(projectExecutableAction),
        reason: action.reason,
      })
    case 'repeat':
      return presentFields({
        action: 'repeat' as const,
        count: action.count,
        actionToRepeat: projectExecutableAction(action.actionToRepeat),
        delayMs: action.delayMs,
        reason: action.reason,
      })
    case 'done':
      return presentFields({
        action: 'done' as const,
        summary: action.summary,
        reason: action.reason,
      })
    default:
      return assertNeverAction(action)
  }
}

/**
 * The recursion preserves the variant, so narrowing the result back to the
 * executable subset is sound.
 */
function projectExecutableAction(action: ExecutableAtomicAction): ExecutableAtomicAction {
  return projectAction(action) as ExecutableAtomicAction
}

function deriveRunFailureClass(
  turns: readonly AgentTurn[],
  thread: AgentThread,
): FailureClass | undefined {
  const lastFailedTurn = turns.findLast((turn) => turn.failureClass !== undefined)
  if (lastFailedTurn?.failureClass) {
    return lastFailedTurn.failureClass
  }

  const runStartedAt = turns[0]?.createdAt
  if (runStartedAt === undefined) {
    return undefined
  }

  // `loop_guard` and `aborted` are run-level outcomes, not step failures: the
  // step that tripped the loop guard never executed, and an abort ends the run
  // as a whole. They are recorded on the run's status_change events instead.
  const runLevelOutcome = thread.events.findLast(
    (event): event is ThreadStatusChangeEvent =>
      event.type === 'status_change' &&
      event.failureClass !== undefined &&
      event.createdAt >= runStartedAt,
  )
  return runLevelOutcome?.failureClass
}

function projectRunStatus(status: AgentThreadStatus): AgentRunStatus {
  switch (status) {
    case 'awaiting_review':
    case 'awaiting_takeover':
    case 'done':
      return status
    case 'stopped':
      return 'stopped'
    default:
      // 'idle' / 'running' / 'error' are not run outcomes; `run.partial` marks
      // the runs that never reached one.
      return 'done'
  }
}

function projectScreen(screen: ScreenSize | undefined): ScreenSize | undefined {
  if (!screen || typeof screen.width !== 'number' || typeof screen.height !== 'number') {
    return undefined
  }
  return { width: screen.width, height: screen.height }
}

function findScreenshotReference(thread: AgentThread, step: number) {
  return thread.screenshotReferences?.find((reference) => reference.step === step)
}

function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
}

/**
 * Drops the allowlisted fields that are absent, so the artifact carries no
 * `undefined`-valued keys. It can only remove entries from a literal that was
 * already built field by field; it never merges anything from the source
 * record.
 */
function presentFields<Fields extends object>(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Fields
}

function assertNeverAction(action: never): never {
  throw new Error(`Unhandled action in trajectory projection: ${JSON.stringify(action)}`)
}
