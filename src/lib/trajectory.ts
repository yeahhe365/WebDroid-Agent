import type { DeviceState } from '../adapters/deviceTypes'
import type {
  AgentScreenshotReference,
  AgentThread,
  AgentThreadEvent,
  AgentThreadStatus,
  AgentTurn,
  AgentTurnTiming,
  ReviewKind,
} from './agentThread'
import type { ActionCoordinateMode, ActionProtocol } from './actionProtocol'
import type { ActionSafetyDecision } from './actionSafetyPolicy'
import type { AgentAction, ExecutableAtomicAction, ScreenSize, TakeOverKind } from './actionTypes'
import { actionPairRecordsSecretValue } from './actionSecrets'
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
  takeoverKind?: TakeOverKind
  reviewKind?: ReviewKind
  deviceCommands?: string[][]
  /**
   * True when context compaction had already discarded this turn's
   * `promptContext` and `modelOutput` (`compactThreadContext` keeps only the
   * most recent completed turns). Those fields are then empty strings and the
   * context digest is the digest of "", which would otherwise read as "there
   * was no context" rather than "it was discarded". The retention policy itself
   * is unchanged; this only makes it visible in the artifact.
   */
  compacted?: boolean
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
    /**
     * The thread's own status verbatim, including the non-terminal `'idle'` /
     * `'running'` (an export taken mid-run) and the thread-level `'error'`: a
     * run that died with an exception is a distinct, failed outcome, and folding
     * it — or a partial run — into `'done'` would export it as a successful one.
     */
    status: AgentThreadStatus
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
   * `reason` is the `message` of the run's own last `status_change` event;
   * `failureClass` is the run-level fallback for outcomes no step owns.
   *
   * **`reason` is unredacted free text and can contain model-provider error
   * output, so it is excluded unless the caller sets
   * `includeDiagnostics: true`.** The message is recorded verbatim, and on the
   * error path it is the caught `Error.message` — for a model call that is the
   * provider's own error body (`formatApiError`). Those bodies are outside this
   * app's control: a 401 can name the supplied key's prefix, and a self-hosted
   * or gateway provider can echo the request endpoint, whose `baseUrl` (and,
   * for Gemini, API key) is user-supplied. It cannot be regex-scrubbed without
   * giving false confidence, so it is opt-in like `promptContext` instead.
   *
   * There is deliberately no `finalResponse`: `AgentConversationMessage` is
   * `{ id, role, content }` — no run id, no turn id, no timestamp — so no
   * message can be attributed to a run window. The recorded terminal message of
   * a successful run already arrives here as `reason` (`recordThreadStatus`
   * stores `result.finalResponse` as the message), and any separate guess at
   * "which message was the final response" would be exactly that: a guess.
   */
  outcome: { failureClass?: FailureClass; reason?: string }
}

export type BuildTrajectoryInput = {
  thread: AgentThread
  runId: string
  /**
   * Ships the full `promptContext` text instead of a `{ chars, digest }`
   * summary. Off by default, because the context can quote task text and
   * secret descriptors.
   */
  includeContext?: boolean
  /**
   * Adds `outcome.reason`, which is **unredacted free text**: the run
   * controller records the status message verbatim, and on the error path that
   * message is the caught `Error.message` — for a model call, the provider's own
   * error body. Provider bodies can name the supplied key's prefix or echo the
   * request endpoint (whose `baseUrl`, and — for Gemini — API key, is
   * user-configured), so the field is opt-in and off by default. The artifact is
   * meant to be committable.
   */
  includeDiagnostics?: boolean
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
  const outcome = deriveRunOutcome(turns, input.thread, input.includeDiagnostics === true)
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
    outcome,
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
  // Projected from the recorded flag, never re-derived from empty strings: an
  // empty `modelOutput` can also mean the model really returned nothing.
  if (turn.compacted === true) {
    step.compacted = true
  }
  // A `failure` block exists only where the source recorded a class; the
  // message is the recorded execution result, never a re-derived summary.
  if (turn.failureClass !== undefined) {
    step.failure = { class: turn.failureClass, message: turn.executionResult ?? '' }
  }
  if (turn.safetyDecision !== undefined) {
    step.safetyDecision = turn.safetyDecision
  }
  if (turn.takeoverKind !== undefined) {
    step.takeoverKind = turn.takeoverKind
  }
  if (turn.reviewKind !== undefined) {
    step.reviewKind = turn.reviewKind
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
 *
 * This is the third layer of the same guard (the registry no longer forwards
 * the argv, and `threadStore` strips it on both the write and the read path, so
 * an artifact projected straight from a live turn is covered here too).
 */
function projectDeviceCommands(turn: AgentTurn): string[][] | undefined {
  if (!turn.deviceCommands || turn.deviceCommands.length === 0) {
    return undefined
  }
  if (actionPairRecordsSecretValue(turn.action, turn.executionAction)) {
    return undefined
  }
  return turn.deviceCommands.map((argv) => argv.slice())
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
    case 'tap_ref':
      return presentFields({
        action: 'tap_ref' as const,
        ref: action.ref,
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
        kind: action.kind,
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

/**
 * The slice of thread history that belongs to one run: it starts at the run's
 * first turn and ends at the first turn that follows the run's last turn, when
 * the thread has one. Without that upper bound, exporting an *earlier* run of a
 * thread that holds several runs would attribute a later run's run-level
 * `loop_guard` / `aborted` event to it.
 *
 * The window deliberately does not end at `run.endedAt`: an aborted run has no
 * completed last turn, and its abort event is recorded *after* the run's final
 * turn — bounding by `endedAt` would hide the very event this fallback exists
 * to read. When the run is the thread's last one there is no following turn, so
 * the window is left open above.
 */
type RunWindow = {
  startedAt: number
  endsAt?: number
}

function resolveRunWindow(
  turns: readonly AgentTurn[],
  thread: AgentThread,
): RunWindow | undefined {
  const firstTurn = turns[0]
  const lastTurn = turns.at(-1)
  if (firstTurn === undefined || lastTurn === undefined) {
    return undefined
  }

  const lastTurnPosition = thread.turns.indexOf(lastTurn)
  const nextTurn =
    lastTurnPosition < 0 ? undefined : thread.turns[lastTurnPosition + 1]
  return { startedAt: firstTurn.createdAt, endsAt: nextTurn?.createdAt }
}

function isInsideRunWindow(
  event: AgentThreadEvent,
  window: RunWindow | undefined,
): boolean {
  if (window === undefined || event.createdAt < window.startedAt) {
    return false
  }
  return window.endsAt === undefined || event.createdAt <= window.endsAt
}

/**
 * Resolves the run's outcome from within its own window only.
 *
 * `loop_guard` and `aborted` are run-level outcomes, not step failures: the step
 * that tripped the loop guard never executed, and an abort ends the run as a
 * whole. They are recorded on the run's status_change events instead, and the
 * last such event inside the window is also the run's recorded reason — when the
 * caller opted into `includeDiagnostics`, since that message is unredacted free
 * text and may echo provider error output.
 */
function deriveRunOutcome(
  turns: readonly AgentTurn[],
  thread: AgentThread,
  includeDiagnostics: boolean,
): TrajectoryArtifact['outcome'] {
  const window = resolveRunWindow(turns, thread)
  const statusEvents = thread.events.filter(
    (event): event is ThreadStatusChangeEvent =>
      event.type === 'status_change' && isInsideRunWindow(event, window),
  )
  const lastFailedTurn = turns.findLast((turn) => turn.failureClass !== undefined)
  const lastClassedEvent = statusEvents.findLast(
    (event) => event.failureClass !== undefined,
  )

  return presentFields({
    failureClass: lastFailedTurn?.failureClass ?? lastClassedEvent?.failureClass,
    // The reason is the *last* status change of the run. A message-less status
    // change therefore yields no `reason` key rather than reaching further back
    // for an older message the run has already moved past. It is dropped
    // entirely unless diagnostics were requested: see `includeDiagnostics`.
    reason: includeDiagnostics ? statusEvents.at(-1)?.message : undefined,
  })
}

/**
 * Maps the thread status verbatim. Every status is a real outcome, including the
 * non-terminal `idle` / `running` (a mid-run export) — folding those into
 * `'done'` would export a partial run as a finished one (`run.partial` marks it,
 * but the status must not lie on its own). `assertNever` keeps the mapping
 * exhaustive when `AgentThreadStatus` grows.
 */
function projectRunStatus(
  status: AgentThreadStatus,
): TrajectoryArtifact['run']['status'] {
  switch (status) {
    case 'idle':
    case 'running':
    case 'paused':
    case 'awaiting_review':
    case 'awaiting_takeover':
    case 'done':
    case 'stopped':
    case 'error':
      return status
    default:
      return assertNeverRunStatus(status)
  }
}

function assertNeverRunStatus(status: never): never {
  throw new Error(`Unhandled thread status in trajectory projection: ${String(status)}`)
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
