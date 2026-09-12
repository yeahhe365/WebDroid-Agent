import {
  DeviceBackendError,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceScreenshot,
  type DeviceState,
} from '../../src/adapters/deviceTypes'
import type { AgentAction } from '../../src/lib/actionTypes'
import type { OpenAiClient } from '../../src/lib/openAiTypes'

export type FakeRunScript = {
  schemaVersion: 1
  name: string
  device: {
    screen: { width: number; height: number }
    modelScreen?: { width: number; height: number }
    currentApp: string
    packageName?: string
  }
  steps: {
    modelOutput: string
    deviceResult: { kind: 'ok'; summary?: string } | { kind: 'io' | 'timeout'; message?: string }
  }[]
  expect?: { status: string; failureClasses: string[] }
}

export class FakeDeviceBackend implements DeviceBackend {
  executedActions: AgentAction[] = []
  executeCalls = 0
  #stepIndex = 0

  constructor(private readonly script: FakeRunScript) {}

  async connect(): Promise<DeviceInfo> {
    return { serial: 'fake', name: 'Fake Device' }
  }

  async disconnect(): Promise<void> {}

  async screenshot(): Promise<DeviceScreenshot> {
    return {
      dataUrl: '',
      screen: this.script.device.screen,
      ...(this.script.device.modelScreen ? { modelScreen: this.script.device.modelScreen } : {}),
    }
  }

  async getCurrentApp(): Promise<string> {
    return this.script.device.currentApp
  }

  async getDeviceState(): Promise<DeviceState> {
    return {
      app: this.script.device.currentApp,
      ...(this.script.device.packageName ? { packageName: this.script.device.packageName } : {}),
    }
  }

  async execute(action: AgentAction): Promise<string> {
    const step = this.script.steps[this.#stepIndex]
    this.#stepIndex += 1
    this.executeCalls += 1
    this.executedActions.push(action)

    const result = step?.deviceResult
    if (result && result.kind !== 'ok') {
      throw new DeviceBackendError(
        result.message ??
          (result.kind === 'timeout' ? 'device command timed out.' : 'device command failed.'),
        result.kind,
      )
    }
    // Past the end of the script every execution succeeds with a plain summary:
    // a fixture that must exhaust the retry budget scripts one result per attempt.
    return result?.summary ?? 'ok'
  }
}

export function createScriptedClient(script: FakeRunScript): OpenAiClient {
  let callIndex = 0
  return {
    async completeAction() {
      // Retries call the model more often than the script has steps, so the last
      // scripted output is repeated instead of throwing.
      const step = script.steps[Math.min(callIndex, script.steps.length - 1)]
      callIndex += 1
      return step?.modelOutput ?? '{"action":"done","summary":"ok"}'
    },
  }
}
