import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../../src/lib/actionTypes'
import { createAgentRunner, createAgentSession } from '../../src/lib/agent'
import type { ModelConfig } from '../../src/lib/openAiTypes'
import {
  ActionToolRegistry,
  createDefaultActionToolRegistry,
  type ActionToolContext,
  type ActionToolName,
  type ActionToolResult,
} from '../../src/lib/toolRegistry'
import {
  FakeDeviceBackend,
  createScriptedClient,
  type FakeRunScript,
} from '../helpers/fakeDeviceBackend'
import { loadFixtures } from './loadFixtures'

const MODEL_CONFIG: ModelConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'test',
  model: 'test-model',
}

type RunFixture = FakeRunScript & {
  abortAfterSteps?: number
}

/**
 * Run fixtures script exactly ONE `deviceResult` per attempt. The fake device
 * answers a call past the end of the script with `'ok'`, so a fixture that has
 * to exhaust the retry budget must script a failing result for *every* attempt —
 * otherwise the retry silently succeeds and the run never reaches the state
 * under test. (Model calls behave the other way round: they clamp to the last
 * scripted output, which is what lets a retry re-ask the model for the same
 * action.)
 *
 * `abortAfterSteps` belongs to the script, not to the harness: a fixture whose
 * expected status is only reachable through a stop signal has to declare the
 * driver, or a plain replay runs on to an unrelated end (replayed with no
 * driver, the abort fixture below finishes in `loop_guard` with 5 steps).
 */
const fixtures = loadFixtures<RunFixture>('test/fixtures/runs')

function findFixture(name: string): RunFixture {
  const fixture = fixtures.find((candidate) => candidate.name === name)
  expect(fixture, `missing run fixture ${name}`).toBeDefined()
  return fixture as RunFixture
}

/**
 * `onStep` fires before the announced step executes, so aborting on the
 * notification after the last allowed step stops the run at a step boundary,
 * with that many steps already applied to the device.
 */
function stopAfterSteps(steps: number) {
  const controller = new AbortController()
  let announced = 0
  return {
    signal: controller.signal,
    onStep: () => {
      announced += 1
      if (announced > steps) {
        controller.abort()
      }
    },
  }
}

/**
 * The real default registry, plus a stop signal fired while the runner is still
 * unwinding the executed action. This is the race `f338471` fixed: the device
 * side effect has already happened, so the runner must record the step before it
 * honours the abort.
 *
 * The fake device cannot drive this window itself: the registry wraps the device
 * call in `withAbort`, so a signal that fires while the device is busy surfaces
 * as an AbortError and the runner returns through its catch instead. Reaching
 * the post-execution check needs a registry that still reports the finished
 * execution.
 */
class AbortAfterExecutionRegistry extends ActionToolRegistry {
  #executions = 0

  constructor(
    private readonly delegate: ActionToolRegistry,
    private readonly abort: () => void,
  ) {
    super()
  }

  override getSignatures(exclude: readonly ActionToolName[] = []) {
    return this.delegate.getSignatures(exclude)
  }

  override async execute(
    action: AgentAction,
    context: ActionToolContext,
  ): Promise<ActionToolResult> {
    const result = await this.delegate.execute(action, context)
    this.#executions += 1
    if (this.#executions === 1) {
      this.abort()
    }
    return result
  }
}

describe('device loop replay', () => {
  it('has run fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const script of fixtures) {
    it(`${script.name} reaches ${script.expect?.status}`, async () => {
      const device = new FakeDeviceBackend(script)
      const runner = createAgentRunner({ device, client: createScriptedClient(script) })
      const stop =
        script.abortAfterSteps === undefined ? undefined : stopAfterSteps(script.abortAfterSteps)

      const result = await runner.run({
        modelConfig: MODEL_CONFIG,
        task: 'replay',
        autoExecute: true,
        maxSteps: 6,
        signal: stop?.signal,
        onStep: stop?.onStep,
      })

      expect(result.status).toBe(script.expect?.status)
      expect(result.steps.map((step) => step.failureClass ?? null).filter(Boolean)).toEqual(
        script.expect?.failureClasses ?? [],
      )
      // Every retained step performed exactly one device call in these scripts:
      // a step the runner refused to execute (abort, loop guard, review) must not
      // show up as an executed action, and an executed step must not be missing.
      expect(device.executedActions.length).toBe(result.steps.length)
    })
  }

  it('re-executes a timed-out device command until the third timeout stops the run', async () => {
    const script = findFixture('device-timeout-then-review')
    const device = new FakeDeviceBackend(script)
    const runner = createAgentRunner({ device, client: createScriptedClient(script) })

    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'replay',
      autoExecute: true,
      maxSteps: 6,
    })

    // The loop stops on `recoverableExecutionFailures > 2`, so the budget is
    // exactly three executions, one per scripted timeout. A fourth execution
    // would resolve 'ok' past the end of the script and prove nothing, so the
    // call count — not just the final status — is the assertion that matters.
    expect(device.executeCalls).toBe(3)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((step) => step.failureClass)).toEqual([
      'device_timeout',
      'device_timeout',
      'device_timeout',
    ])
    // All three attempts re-issued the same device command: the scripted client
    // clamps past the end of the script and hands the retry the same action.
    const replayedCommands = device.executedActions.map((action) => JSON.stringify(action))
    expect(replayedCommands).toHaveLength(3)
    expect(new Set(replayedCommands).size).toBe(1)
    // The run stopped on a device timeout, not on max_steps or the loop guard.
    expect(result.reason).toContain('timed out')
  })

  it('stops mid-run without losing the steps that already ran', async () => {
    const script = findFixture('abort-keeps-executed-steps')
    const device = new FakeDeviceBackend(script)
    const session = createAgentSession('replay')
    const stop = stopAfterSteps(1)
    const runner = createAgentRunner({ device, client: createScriptedClient(script) })

    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'replay',
      autoExecute: true,
      maxSteps: 6,
      session,
      signal: stop.signal,
      onStep: stop.onStep,
    })

    expect(result.status).toBe('stopped')
    // The second step is announced and then dropped: the abort lands before it
    // is executed, so neither the result nor the device has seen it.
    expect(result.steps).toHaveLength(1)
    expect(device.executedActions).toHaveLength(1)
    expect(device.executeCalls).toBe(1)
    // The step that did run survived with its execution evidence, and the
    // session recorded it — otherwise a resumed run could repeat an action the
    // device has already applied.
    expect(result.steps[0]?.toolName).toBe('tap')
    expect(result.steps[0]?.executionResult).toBe('tapped')
    expect(typeof result.steps[0]?.timing.executionMs).toBe('number')
    expect(session.turns[0]?.executionResult).toBe('tapped')
    expect(session.turns[0]?.success).toBe(true)
  })

  it('keeps an executed step when the stop signal lands before the runner inspects the result', async () => {
    const script = findFixture('abort-keeps-executed-steps')
    const device = new FakeDeviceBackend(script)
    const session = createAgentSession('replay')
    const controller = new AbortController()
    const toolRegistry = new AbortAfterExecutionRegistry(createDefaultActionToolRegistry(), () =>
      controller.abort(),
    )
    const runner = createAgentRunner({
      device,
      client: createScriptedClient(script),
      toolRegistry,
    })

    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'replay',
      autoExecute: true,
      maxSteps: 6,
      session,
      signal: controller.signal,
    })

    expect(result.status).toBe('stopped')
    expect(device.executedActions).toHaveLength(1)
    expect(result.steps).toHaveLength(1)
    // The device action was applied, so the step must be reported with its
    // post-execution evidence and recorded in the session. Returning as soon as
    // the signal is seen would leave the side effect invisible to the session
    // and a later run could repeat it (f338471).
    expect(result.steps[0]?.toolName).toBe('tap')
    expect(result.steps[0]?.executionResult).toBe('tapped')
    expect(session.turns[0]?.executionResult).toBe('tapped')
    expect(session.turns[0]?.success).toBe(true)
  })
})
