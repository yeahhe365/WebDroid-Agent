import { describe, expect, it } from 'vitest'
import {
  createAgentThread,
  recordThreadAssistantMessage,
  recordThreadStatus,
  startThreadTurn,
} from './agentThread'
import type { AgentThread } from './agentThread'
import type { AgentAction } from './actionTypes'
import {
  TRAJECTORY_SCHEMA_VERSION,
  buildTrajectoryArtifact,
  fnv1a32,
  isTrajectoryArtifact,
  serializeTrajectory,
} from './trajectory'

const TIMING = { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 }

function buildThread() {
  const thread = createAgentThread('打开设置')
  const base = {
    task: '打开设置',
    promptContext: 'SECRET-CONTEXT-CONTENT',
    deviceSnapshot: {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      screenshot: { dataUrl: '', screen: { width: 1080, height: 2316 } },
    },
    modelOutput: '{"action":"wait","ms":1}',
    action: { action: 'wait' as const, ms: 1 },
    executionAction: { action: 'wait' as const, ms: 1 },
    preview: 'wait 1ms',
    timing: TIMING,
  }
  const first = startThreadTurn(thread, { ...base, index: 1, runId: 'run_a' })
  const second = startThreadTurn(thread, { ...base, index: 2, runId: 'run_a' })
  second.failureClass = 'device_timeout'
  second.executionResult = 'device command timed out after 30000ms.'
  recordThreadStatus(thread, 'awaiting_review', 'timeout')
  return { thread, first, second }
}

const MODEL = { provider: 'openai', model: 'gpt-4o', actionProtocol: 'webdroid_json' as const }

describe('buildTrajectoryArtifact', () => {
  it('projects only the turns of the requested run', () => {
    const { thread, second } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    expect(artifact.run.stepTurnIds).toEqual([expect.any(String), second.id])
    expect(artifact.steps).toHaveLength(2)
    expect(artifact.steps[1]?.failure?.class).toBe('device_timeout')
    expect(artifact.outcome.failureClass).toBe('device_timeout')
  })

  it('summarises prompt context instead of shipping it', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    const serialized = serializeTrajectory(artifact)
    expect(serialized).not.toContain('SECRET-CONTEXT-CONTENT')
    expect(artifact.steps[0]?.context).toEqual({
      chars: 'SECRET-CONTEXT-CONTENT'.length,
      digest: fnv1a32('SECRET-CONTEXT-CONTENT'),
    })
  })

  it('includes the full context only when explicitly asked', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL, includeContext: true })
    expect(artifact.steps[0]?.context).toEqual({ text: 'SECRET-CONTEXT-CONTENT' })
  })

  it('never leaks credentials, serials or pixels through the allowlist projection', () => {
    const { thread } = buildThread()
    thread.screenshotReferences = [
      {
        id: 'screenshot-step-1',
        step: 1,
        title: 'Step #1',
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot: { dataUrl: 'data:image/png;base64,AAAA', screen: { width: 1080, height: 2316 } },
        createdAt: 1,
      },
    ]
    const serialized = serializeTrajectory(
      buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL }),
    )
    expect(serialized).not.toContain('data:image')
    expect(serialized).not.toContain('baseUrl')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('serial')
    expect(serialized).toContain('screenshot-step-1')
  })

  it('marks a thread without a runId as partial and keeps an empty run id', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: '', model: MODEL })
    expect(artifact.run.runId).toBe('')
    expect(artifact.run.partial).toBe(true)
    expect(artifact.steps).toHaveLength(0)
  })
})

describe('fnv1a32', () => {
  it('is stable and prefixed', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'))
    expect(fnv1a32('abc')).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'))
  })
})

describe('run-level outcome fallback', () => {
  it('uses the status change class when no step failed', () => {
    const thread = createAgentThread('打开设置')
    startThreadTurn(thread, {
      index: 1,
      runId: 'run_b',
      task: '打开设置',
      promptContext: 'ctx',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot: { dataUrl: '', screen: { width: 1080, height: 2316 } },
      },
      modelOutput: '{"action":"wait","ms":1}',
      action: { action: 'wait', ms: 1 },
      executionAction: { action: 'wait', ms: 1 },
      preview: 'wait 1ms',
      timing: TIMING,
    })
    recordThreadStatus(thread, 'stopped', 'loop guard', { failureClass: 'loop_guard' })

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_b',
      model: MODEL,
      includeDiagnostics: true,
    })
    expect(artifact.steps.every((step) => step.failure === undefined)).toBe(true)
    expect(artifact.outcome.failureClass).toBe('loop_guard')
    expect(artifact.outcome.reason).toBe('loop guard')
  })

  it('keeps the aborted outcome of a run whose last turn never completed', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_abort',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    // The abort lands after the run's final turn, whose completedAt is absent.
    recordThreadStatus(thread, 'stopped', 'user aborted', {
      failureClass: 'aborted',
      now: 5_000,
    })

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_abort',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(artifact.run.endedAt).toBeUndefined()
    expect(artifact.outcome.failureClass).toBe('aborted')
    expect(artifact.outcome.reason).toBe('user aborted')
  })

  it('does not attribute a later run\'s run-level class to an earlier run', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_first',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    startTurn(thread, {
      index: 2,
      runId: 'run_second',
      action: { action: 'wait', ms: 1 },
      now: 2_000,
    })
    // The second run's own outcome: it must never reach the first run's export.
    recordThreadStatus(thread, 'stopped', 'loop guard', {
      failureClass: 'loop_guard',
      now: 3_000,
    })

    const first = buildTrajectoryArtifact({
      thread,
      runId: 'run_first',
      model: MODEL,
      includeDiagnostics: true,
    })
    const second = buildTrajectoryArtifact({
      thread,
      runId: 'run_second',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(first.run.stepTurnIds).toHaveLength(1)
    expect(first.outcome.failureClass).toBeUndefined()
    expect(first.outcome.reason).toBeUndefined()
    expect(second.outcome.failureClass).toBe('loop_guard')
    expect(second.outcome.reason).toBe('loop guard')
  })
})

describe('run-level reason', () => {
  it('takes reason from the last status change inside the run window', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_reason',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    recordThreadStatus(thread, 'running', 'first note', { now: 1_100 })
    recordThreadStatus(thread, 'stopped', 'second note', { now: 1_200 })

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_reason',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(artifact.outcome.reason).toBe('second note')
    // No step and no status change recorded a class, so none is invented.
    expect(artifact.outcome.failureClass).toBeUndefined()
  })

  it('omits reason when the run window holds no status change', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_quiet',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })

    // Diagnostics requested, so the only thing that can keep `reason` out is
    // the empty run window — which is exactly what this test pins.
    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_quiet',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(Object.keys(artifact.outcome)).toEqual([])
  })

  it('does not project a final response, because a message has no run attribution', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_response',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    recordThreadAssistantMessage(thread, 'All done, the settings screen is open.', {
      now: 1_100,
    })

    // Diagnostics requested, so an empty outcome is not just the default
    // omission: even with `reason` in scope, nothing here invents a response.
    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_response',
      model: MODEL,
      includeDiagnostics: true,
    })

    // The response exists on the thread, and is still deliberately not
    // projected: `AgentConversationMessage` carries no run id to select it by.
    expect(thread.messages.some((message) => message.role === 'assistant')).toBe(true)
    expect('finalResponse' in artifact.outcome).toBe(false)
    expect(Object.keys(artifact.outcome)).toEqual([])
  })
})

describe('outcome diagnostics opt-in', () => {
  // The exact shape the error path records: `useAgentRunController` stores
  // `formatCaughtError(caught)` verbatim, and for a model call that is the
  // provider's own error body (`formatApiError`). A 401 body may name the
  // supplied key's prefix, and a self-hosted/gateway body may echo the request
  // endpoint, whose `baseUrl` (and, for Gemini, API key) is user-configured.
  const PROVIDER_ERROR =
    'Model API failed with 401: API key not valid. ' +
    'key=AIzaSyEXAMPLEKEYPREFIX https://gateway.internal:8443/v1beta/models/gemini-pro:generateContent?key=AIzaSyEXAMPLEKEYPREFIX'

  function threadWithProviderError() {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_diag',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    recordThreadStatus(thread, 'error', PROVIDER_ERROR, {
      failureClass: 'unknown',
      now: 2_000,
    })
    return thread
  }

  it('omits reason by default, even when the run recorded a status message', () => {
    const artifact = buildTrajectoryArtifact({
      thread: threadWithProviderError(),
      runId: 'run_diag',
      model: MODEL,
    })
    const serialized = serializeTrajectory(artifact)

    expect('reason' in artifact.outcome).toBe(false)
    // The omission is surgical: the classified outcome is still exported.
    expect(artifact.outcome).toEqual({ failureClass: 'unknown' })
    expect(serialized).not.toContain(PROVIDER_ERROR)
    expect(serialized).not.toContain('AIzaSyEXAMPLEKEYPREFIX')
    expect(serialized).not.toContain('gateway.internal')
  })

  it('includes reason only when includeDiagnostics is true', () => {
    const artifact = buildTrajectoryArtifact({
      thread: threadWithProviderError(),
      runId: 'run_diag',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(artifact.outcome.reason).toBe(PROVIDER_ERROR)
    expect(artifact.outcome.failureClass).toBe('unknown')
    expect(serializeTrajectory(artifact)).toContain(PROVIDER_ERROR)
  })
})

describe('run status', () => {
  it('reports a thread in error as error and partial, never done', () => {
    const thread = createAgentThread('打开设置')
    startTurn(thread, {
      index: 1,
      runId: 'run_error',
      action: { action: 'wait', ms: 1 },
      now: 1_000,
    })
    recordThreadStatus(thread, 'error', 'device bridge crashed', {
      failureClass: 'unknown',
      now: 2_000,
    })

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_error',
      model: MODEL,
      includeDiagnostics: true,
    })

    expect(artifact.run.status).toBe('error')
    expect(artifact.run.partial).toBe(true)
    expect(artifact.outcome.failureClass).toBe('unknown')
    expect(artifact.outcome.reason).toBe('device bridge crashed')
  })

  it('keeps non-terminal thread statuses instead of folding them into done', () => {
    for (const status of ['idle', 'running'] as const) {
      const thread = createAgentThread('打开设置')
      startTurn(thread, {
        index: 1,
        runId: `run_${status}`,
        action: { action: 'wait', ms: 1 },
        now: 1_000,
      })
      thread.status = status

      const artifact = buildTrajectoryArtifact({
        thread,
        runId: `run_${status}`,
        model: MODEL,
      })

      expect(artifact.run.status).toBe(status)
      expect(artifact.run.partial).toBe(true)
    }
  })
})

describe('compacted steps', () => {
  it('marks a compacted turn so empty fields read as discarded, not absent', () => {
    const { thread, first, second } = buildThread()
    first.compacted = true
    first.promptContext = ''
    first.modelOutput = ''

    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })

    expect(artifact.steps[0]?.compacted).toBe(true)
    expect(artifact.steps[0]?.modelOutput).toBe('')
    // The flag is projected, never inferred: an untouched turn stays unflagged.
    expect(artifact.steps[1]?.compacted).toBeUndefined()
    expect(second.compacted).toBeUndefined()
    expect(serializeTrajectory(artifact)).toContain('"compacted": true')
  })
})

describe('artifact envelope', () => {
  it('stamps the schema version, app version and an injected export time', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL, now: 0 })
    expect(artifact.schemaVersion).toBe(TRAJECTORY_SCHEMA_VERSION)
    expect(artifact.kind).toBe('webdroid.trajectory')
    expect(artifact.exportedAt).toBe('1970-01-01T00:00:00.000Z')
    expect(artifact.app.version).toBe(__APP_VERSION__)
    expect(artifact.model).toStrictEqual({
      provider: 'openai',
      model: 'gpt-4o',
      actionProtocol: 'webdroid_json',
      coordinateMode: 'screenshot_pixels',
    })
    expect(artifact.run.runId).toBe('run_a')
    expect(artifact.run.threadId).toBe(thread.id)
    expect(artifact.run.status).toBe('awaiting_review')
    // The buildThread turns were never completed, so the run is still partial.
    expect(artifact.run.partial).toBe(true)
    expect(artifact.run.endedAt).toBeUndefined()
  })

  it('derives the coordinate mode from the protocol unless told otherwise', () => {
    const { thread } = buildThread()
    const derived = buildTrajectoryArtifact({
      thread,
      runId: 'run_a',
      model: { model: 'gpt-4o', actionProtocol: 'webdroid_normalized_json' },
    })
    expect(derived.model.coordinateMode).toBe('normalized_0_1000')

    const overridden = buildTrajectoryArtifact({
      thread,
      runId: 'run_a',
      model: MODEL,
      coordinateMode: 'normalized_0_1000',
    })
    expect(overridden.model.coordinateMode).toBe('normalized_0_1000')
  })
})

describe('screenshot projection', () => {
  it('keeps only reference geometry, never pixels', () => {
    const { thread } = buildThread()
    thread.screenshotReferences = [
      {
        id: 'step-1',
        step: 1,
        title: 'Step #1',
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot: {
          dataUrl: 'data:image/png;base64,AAAA',
          modelDataUrl: 'data:image/png;base64,BBBB',
          screen: { width: 1080, height: 2316 },
          modelScreen: { width: 540, height: 1158 },
        },
        createdAt: 1,
      },
    ]

    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    // toStrictEqual: a `dataUrl` copied into the reference would fail here even
    // though the substring guard in the leak test could not see it.
    expect(artifact.steps[0]?.screenshot).toStrictEqual({
      id: 'step-1',
      step: 1,
      screen: { width: 1080, height: 2316 },
      modelScreen: { width: 540, height: 1158 },
    })
    expect(artifact.device.screen).toStrictEqual({ width: 1080, height: 2316 })
    expect(artifact.device.modelScreen).toStrictEqual({ width: 540, height: 1158 })
    expect(artifact.device.name).toBe('android-device')
    expect(serializeTrajectory(artifact)).not.toContain('data:image')
  })
})

describe('secret argv guard', () => {
  it('drops the argv of a step that types a secret, because that argv is the secret', () => {
    const thread = createAgentThread('登录')
    const turn = startTurn(thread, {
      index: 1,
      runId: 'run_secret',
      action: { action: 'type_secret', secretId: 'login_password' },
    })
    turn.deviceCommands = [['input', 'text', 'SUPER-SECRET-VALUE']]

    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_secret', model: MODEL })
    const serialized = serializeTrajectory(artifact)

    expect(artifact.steps[0]?.deviceCommands).toBeUndefined()
    expect(serialized).not.toContain('SUPER-SECRET-VALUE')
    // The descriptor id is still recorded, so the step stays intelligible.
    expect(serialized).toContain('login_password')
  })

  it('drops the argv of a sequence that nests a secret action', () => {
    const thread = createAgentThread('登录')
    const turn = startTurn(thread, {
      index: 1,
      runId: 'run_secret_sequence',
      action: {
        action: 'sequence',
        actions: [
          { action: 'tap', x: 1, y: 2 },
          { action: 'type_secret', secretId: 'login_password' },
        ],
      },
    })
    turn.deviceCommands = [
      ['input', 'tap', '1', '2'],
      ['input', 'text', 'SUPER-SECRET-VALUE'],
    ]

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_secret_sequence',
      model: MODEL,
    })
    expect(artifact.steps[0]?.deviceCommands).toBeUndefined()
    expect(serializeTrajectory(artifact)).not.toContain('SUPER-SECRET-VALUE')
  })

  it('drops the argv of a repeat that nests a secret action', () => {
    const thread = createAgentThread('登录')
    const turn = startTurn(thread, {
      index: 1,
      runId: 'run_secret_repeat',
      action: {
        action: 'repeat',
        count: 2,
        actionToRepeat: { action: 'type_secret', secretId: 'login_password' },
      },
    })
    turn.deviceCommands = [
      ['input', 'text', 'SUPER-SECRET-VALUE'],
      ['input', 'text', 'SUPER-SECRET-VALUE'],
    ]

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_secret_repeat',
      model: MODEL,
    })

    expect(artifact.steps[0]?.deviceCommands).toBeUndefined()
    expect(serializeTrajectory(artifact)).not.toContain('SUPER-SECRET-VALUE')
    // The nested descriptor id is still recorded, so the step stays intelligible.
    expect(serializeTrajectory(artifact)).toContain('login_password')
  })

  it('drops the argv when the secret lives only in the execution action', () => {
    const thread = createAgentThread('登录')
    const turn = startTurn(thread, {
      index: 1,
      runId: 'run_secret_execution',
      // The planned action is clean; only the action that actually executed
      // carries the secret — which is the action the argv belongs to.
      action: { action: 'wait', ms: 1 },
      executionAction: { action: 'type_secret', secretId: 'login_password' },
    })
    turn.deviceCommands = [['input', 'text', 'SUPER-SECRET-VALUE']]

    const artifact = buildTrajectoryArtifact({
      thread,
      runId: 'run_secret_execution',
      model: MODEL,
    })

    expect(artifact.steps[0]?.deviceCommands).toBeUndefined()
    expect(serializeTrajectory(artifact)).not.toContain('SUPER-SECRET-VALUE')
    expect(artifact.steps[0]?.executionAction).toStrictEqual({
      action: 'type_secret',
      secretId: 'login_password',
    })
  })

  it('keeps the argv of an ordinary step', () => {
    const thread = createAgentThread('点一下')
    const turn = startTurn(thread, {
      index: 1,
      runId: 'run_tap',
      action: { action: 'tap', x: 5, y: 6 },
    })
    turn.deviceCommands = [['input', 'tap', '5', '6']]

    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_tap', model: MODEL })
    expect(artifact.steps[0]?.deviceCommands).toStrictEqual([['input', 'tap', '5', '6']])
  })
})

describe('context digest', () => {
  it('distinguishes two contexts that differ', () => {
    const first = createAgentThread('t')
    startTurn(first, {
      index: 1,
      runId: 'run_digest',
      action: { action: 'wait', ms: 1 },
      promptContext: 'context-a',
    })
    const second = createAgentThread('t')
    startTurn(second, {
      index: 1,
      runId: 'run_digest',
      action: { action: 'wait', ms: 1 },
      promptContext: 'context-b',
    })

    const digestOf = (thread: AgentThread) =>
      buildTrajectoryArtifact({ thread, runId: 'run_digest', model: MODEL }).steps[0]?.context
    expect(digestOf(first)).not.toStrictEqual(digestOf(second))
    expect(digestOf(first)).toStrictEqual({
      chars: 'context-a'.length,
      digest: fnv1a32('context-a'),
    })
  })

  it('matches the published FNV-1a 32-bit reference vectors', () => {
    expect(fnv1a32('')).toBe('fnv1a32:811c9dc5')
    expect(fnv1a32('abc')).toBe('fnv1a32:1a47e90b')
  })
})

describe('isTrajectoryArtifact', () => {
  it('accepts a built artifact, including after a serialize round-trip', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    expect(isTrajectoryArtifact(artifact)).toBe(true)
    const roundTripped: unknown = JSON.parse(serializeTrajectory(artifact))
    expect(isTrajectoryArtifact(roundTripped)).toBe(true)
  })

  it('rejects values that are not a v1 trajectory', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    expect(isTrajectoryArtifact(null)).toBe(false)
    expect(isTrajectoryArtifact([])).toBe(false)
    expect(isTrajectoryArtifact('webdroid.trajectory')).toBe(false)
    expect(isTrajectoryArtifact({ ...artifact, schemaVersion: 2 })).toBe(false)
    expect(isTrajectoryArtifact({ ...artifact, kind: 'webdroid.something-else' })).toBe(false)
    expect(isTrajectoryArtifact({ ...artifact, steps: 'nope' })).toBe(false)
  })
})

function startTurn(
  thread: AgentThread,
  input: {
    index: number
    runId: string
    action: AgentAction
    executionAction?: AgentAction
    promptContext?: string
    now?: number
  },
) {
  return startThreadTurn(thread, {
    index: input.index,
    runId: input.runId,
    task: thread.task,
    promptContext: input.promptContext ?? 'ctx',
    deviceSnapshot: {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome' },
      screenshot: { dataUrl: '', screen: { width: 1080, height: 2316 } },
    },
    modelOutput: JSON.stringify({ action: input.action.action }),
    action: input.action,
    executionAction: input.executionAction ?? input.action,
    preview: input.action.action,
    timing: TIMING,
    ...(input.now === undefined ? {} : { now: input.now }),
  })
}
