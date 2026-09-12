import { describe, expect, it } from 'vitest'
import { createAgentRunner, createAgentSession } from '../lib/agent'
import { createDefaultActionToolRegistry } from '../lib/toolRegistry'
import { toReportableDeviceCommand, type DeviceCommandStep } from './deviceTypes'
import { WebAdbDeviceBackend } from './webAdbBackend'

describe('toReportableDeviceCommand', () => {
  it('reports an argv step as a copy', () => {
    const step = ['input', 'keyevent', 'KEYCODE_HOME']
    const reported = toReportableDeviceCommand(step)
    expect(reported).toEqual(step)
    expect(reported).not.toBe(step)
  })

  it('reports nothing for a timer step, because a wait is not a command', () => {
    expect(toReportableDeviceCommand({ waitMs: 250 })).toBeNull()
  })
})

describe('tool registry command forwarding', () => {
  it('forwards onDeviceCommand to the device backend', async () => {
    const recorded: string[][] = []
    const registry = createDefaultActionToolRegistry()
    const device = {
      execute: async (
        _action: unknown,
        options?: { onDeviceCommand?: (argv: readonly string[]) => void },
      ) => {
        options?.onDeviceCommand?.(['input', 'tap', '1', '2'])
        return 'tapped'
      },
      screenshot: async () => ({ dataUrl: '', screen: { width: 1080, height: 2316 } }),
      getCurrentApp: async () => 'Chrome',
      getDeviceState: async () => ({ app: 'Chrome' }),
    }

    const result = await registry.execute(
      { action: 'tap', x: 1, y: 2 } as never,
      {
        device,
        onDeviceCommand: (argv: readonly string[]) => recorded.push([...argv]),
      } as never,
    )

    expect(result.success).toBe(true)
    expect(recorded).toEqual([['input', 'tap', '1', '2']])
  })
})

describe('web adb backend reporting', () => {
  it('reports each argv before the device handle is required', async () => {
    const recorded: string[][] = []
    const backend = new WebAdbDeviceBackend()

    await expect(
      backend.execute(
        { action: 'tap', x: 3, y: 4 },
        { onDeviceCommand: (argv) => recorded.push([...argv]) },
      ),
    ).rejects.toThrow('Connect an Android device first.')
    expect(recorded).toEqual([['input', 'tap', '3', '4']])
  })
})

/**
 * Stands in for a backend: it reports exactly the argv steps the offline rule
 * accepts, so a timer step can never reach the recorder.
 */
function commandReportingDevice(steps: readonly DeviceCommandStep[] = []) {
  return {
    connect: async () => ({ serial: 'fake', name: 'Fake' }),
    disconnect: async () => {},
    screenshot: async () => ({ dataUrl: '', screen: { width: 1080, height: 2316 } }),
    getCurrentApp: async () => 'Chrome',
    getDeviceState: async () => ({ app: 'Chrome' }),
    execute: async (
      _action: unknown,
      options?: { onDeviceCommand?: (argv: readonly string[]) => void },
    ) => {
      for (const step of steps) {
        const reported = toReportableDeviceCommand(step)
        if (reported) {
          options?.onDeviceCommand?.(reported)
        }
      }
      return 'tapped'
    },
  }
}

const MODEL_CONFIG = { baseUrl: 'http://localhost', apiKey: 't', model: 'm' }
const tapClient = { completeAction: async () => '{"action":"tap","x":5,"y":6}' }

describe('agent runner command collection', () => {
  it('collects forwarded commands onto the executed step', async () => {
    const device = commandReportingDevice([['input', 'tap', '5', '6'], { waitMs: 250 }])
    const runner = createAgentRunner({ device: device as never, client: tapClient })
    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'tap',
      autoExecute: true,
      maxSteps: 1,
    })

    expect(result.steps[0]?.deviceCommands).toEqual([['input', 'tap', '5', '6']])
  })

  it('persists the collected commands onto the turn, not just the step', async () => {
    const session = createAgentSession('tap')
    const device = commandReportingDevice([['input', 'tap', '5', '6']])
    const runner = createAgentRunner({ device: device as never, client: tapClient })
    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'tap',
      autoExecute: true,
      maxSteps: 1,
      session,
    })

    expect(result.steps[0]?.deviceCommands).toEqual([['input', 'tap', '5', '6']])
    expect(session.turns[0]?.deviceCommands).toEqual([['input', 'tap', '5', '6']])
  })

  it('invents no commands when the device reports none', async () => {
    const session = createAgentSession('tap')
    const runner = createAgentRunner({
      device: commandReportingDevice() as never,
      client: tapClient,
    })
    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'tap',
      autoExecute: true,
      maxSteps: 1,
      session,
    })

    expect(result.steps[0]?.deviceCommands).toBeUndefined()
    expect(session.turns[0]?.deviceCommands).toBeUndefined()
  })
})
