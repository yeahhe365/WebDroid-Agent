import { describe, expect, it } from 'vitest'
import { DeviceBackendError } from '../../src/adapters/deviceTypes'
import type { AgentAction } from '../../src/lib/actionTypes'
import { FakeDeviceBackend, createScriptedClient, type FakeRunScript } from './fakeDeviceBackend'

const script: FakeRunScript = {
  schemaVersion: 1,
  name: 'unit',
  device: { screen: { width: 1080, height: 2316 }, modelScreen: { width: 720, height: 1544 }, currentApp: 'Chrome' },
  steps: [
    { modelOutput: '{"action":"tap","x":1,"y":2}', deviceResult: { kind: 'ok', summary: 'tapped' } },
    { modelOutput: '{"action":"tap","x":3,"y":4}', deviceResult: { kind: 'timeout', message: 'slow' } },
  ],
}

describe('FakeDeviceBackend', () => {
  it('serves geometry and app state from the script without any canvas work', async () => {
    const device = new FakeDeviceBackend(script)
    const screenshot = await device.screenshot()
    expect(screenshot.screen).toEqual({ width: 1080, height: 2316 })
    expect(screenshot.modelScreen).toEqual({ width: 720, height: 1544 })
    expect(await device.getCurrentApp()).toBe('Chrome')
  })

  it('replays ok and timeout results in order and counts calls', async () => {
    const device = new FakeDeviceBackend(script)
    await expect(device.execute({ action: 'tap', x: 1, y: 2 })).resolves.toBe('tapped')
    const error = await device.execute({ action: 'tap', x: 3, y: 4 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(DeviceBackendError)
    expect((error as DeviceBackendError).kind).toBe('timeout')
    expect(device.executeCalls).toBe(2)
    expect(device.executedActions).toHaveLength(2)
  })

  it('reports the scripted device state and connects without a transport', async () => {
    const device = new FakeDeviceBackend({ ...script, device: { ...script.device, packageName: 'com.android.chrome' } })
    expect(await device.getDeviceState()).toEqual({ app: 'Chrome', packageName: 'com.android.chrome' })
    await expect(device.connect()).resolves.toEqual({ serial: 'fake', name: 'Fake Device' })
    await expect(device.disconnect()).resolves.toBeUndefined()
  })

  it('records the actions it was handed, in order, including a failed attempt', async () => {
    const device = new FakeDeviceBackend(script)
    await device.execute({ action: 'tap', x: 1, y: 2 })
    // The second scripted step times out, but the attempt is still recorded.
    await device.execute({ action: 'launch', app: 'Chrome' }).catch(() => undefined)
    expect(device.executedActions).toEqual([
      { action: 'tap', x: 1, y: 2 },
      { action: 'launch', app: 'Chrome' },
    ])
    expect(device.executeCalls).toBe(2)
  })

  it('does not throw past the last step and replays a script identically twice', async () => {
    const actions: AgentAction[] = [
      { action: 'tap', x: 1, y: 2 },
      { action: 'tap', x: 3, y: 4 },
      { action: 'tap', x: 5, y: 6 },
      { action: 'tap', x: 7, y: 8 },
    ]
    const expected = ['ok:tapped', 'error:timeout:slow', 'ok:ok', 'ok:ok']
    await expect(replay(new FakeDeviceBackend(script), actions)).resolves.toEqual(expected)
    await expect(replay(new FakeDeviceBackend(script), actions)).resolves.toEqual(expected)
  })
})

describe('FakeDeviceBackend scripted failures', () => {
  it('maps an io step to a DeviceBackendError with kind io', async () => {
    const device = new FakeDeviceBackend({
      ...script,
      steps: [{ modelOutput: '{"action":"tap","x":1,"y":2}', deviceResult: { kind: 'io', message: 'adb closed' } }],
    })
    const error = await device.execute({ action: 'tap', x: 1, y: 2 }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DeviceBackendError)
    expect((error as DeviceBackendError).kind).toBe('io')
    expect((error as DeviceBackendError).message).toBe('adb closed')
  })
})

describe('createScriptedClient', () => {
  it('returns the scripted model output per step, clamping past the end', async () => {
    const client = createScriptedClient(script)
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":1,"y":2}')
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":3,"y":4}')
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":3,"y":4}')
  })

  it('keeps an independent cursor for every client it hands out', async () => {
    const first = createScriptedClient(script)
    const second = createScriptedClient(script)
    expect(await first.completeAction({} as never)).toBe('{"action":"tap","x":1,"y":2}')
    expect(await second.completeAction({} as never)).toBe('{"action":"tap","x":1,"y":2}')
    expect(await first.completeAction({} as never)).toBe('{"action":"tap","x":3,"y":4}')
  })
})

async function replay(device: FakeDeviceBackend, actions: AgentAction[]): Promise<string[]> {
  const outcomes: string[] = []
  for (const action of actions) {
    outcomes.push(
      await device.execute(action).then(
        (summary) => `ok:${summary}`,
        (caught: unknown) =>
          caught instanceof DeviceBackendError ? `error:${caught.kind}:${caught.message}` : 'error:unknown',
      ),
    )
  }
  return outcomes
}
