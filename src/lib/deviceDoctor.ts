import { isAdbKeyboardInstalled } from '../adapters/adbKeyboard'
import type { DeviceBackend, DeviceInfo, DeviceScreenshot, DeviceState } from '../adapters/deviceTypes'
import { normalizeBaseUrl } from './openAiClient'
import type { ModelConfig } from './openAiTypes'
import type { ModelConnectionTestResult } from './modelConnectionTest'

export type DoctorCheckStatus = 'ok' | 'warn' | 'error' | 'skipped'

export type DoctorCheckId =
  | 'webusb'
  | 'device'
  | 'screenshot'
  | 'screen_size'
  | 'current_app'
  | 'keyboard'
  | 'adb_keyboard'
  | 'model_config'
  | 'model_api'

export type DoctorCheckResult = {
  id: DoctorCheckId
  title: string
  status: DoctorCheckStatus
  detail: string
  fix?: string
}

export type DeviceDoctorInput = {
  connected: boolean
  device: DeviceBackend | null
  deviceInfo: DeviceInfo | null
  fetcher?: typeof fetch
  isWebUsbSupported: () => boolean
  modelConfig: ModelConfig
  /** When provided, the model check uses the same proxy-aware path as a real run. */
  probeModel?: (config: ModelConfig) => Promise<ModelConnectionTestResult>
}

export async function runDeviceDoctor({
  connected,
  device,
  deviceInfo,
  fetcher = fetch,
  isWebUsbSupported,
  modelConfig,
  probeModel,
}: DeviceDoctorInput): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = []
  const webUsbOk = isWebUsbSupported()
  const deviceReady = connected && device !== null && deviceInfo !== null
  const modelConfigReady = Boolean(
    modelConfig.baseUrl.trim() && modelConfig.apiKey.trim() && modelConfig.model.trim(),
  )

  results.push(
    webUsbOk
      ? ok('webusb', 'WebUSB', 'This browser exposes WebUSB.')
      : error(
          'webusb',
          'WebUSB',
          'WebUSB is not available in this browser.',
          'Use Chrome or Edge on HTTPS or localhost.',
        ),
  )

  results.push(
    deviceReady
      ? ok('device', 'ADB connection', `${deviceInfo.name} (${deviceInfo.serial}) is connected.`)
      : error(
          'device',
          'ADB connection',
          'No Android device is connected.',
          'Connect a USB-debugging Android device and approve the ADB prompt.',
        ),
  )

  let screenshot: DeviceScreenshot | null = null
  if (deviceReady) {
    try {
      screenshot = await device.screenshot()
      results.push(
        ok(
          'screenshot',
          'Screenshot',
          `Captured a screenshot (${screenshot.screen.width}x${screenshot.screen.height}).`,
        ),
      )
    } catch (caught) {
      results.push(
        error(
          'screenshot',
          'Screenshot',
          describeError(caught),
          'Wake and unlock the device, then try capturing again.',
        ),
      )
    }
  } else {
    results.push(skipped('screenshot', 'Screenshot', 'Connect a device before checking screenshots.'))
  }

  if (screenshot) {
    const { width, height } = screenshot.screen
    results.push(
      width > 0 && height > 0
        ? ok('screen_size', 'Screen size', `${width}x${height}`)
        : error('screen_size', 'Screen size', 'The screenshot did not report a valid size.'),
    )
  } else {
    results.push(skipped('screen_size', 'Screen size', 'Screenshot check did not produce a screen size.'))
  }

  if (deviceReady) {
    try {
      const deviceState = await device.getDeviceState()
      results.push(ok('current_app', 'Current app', formatDoctorDeviceState(deviceState)))
      results.push(
        deviceState.keyboard
          ? ok('keyboard', 'Input method', deviceState.keyboard)
          : warn(
              'keyboard',
              'Input method',
              'No active input method was reported.',
              'Open a text field or enable ADB Keyboard before testing complex text input.',
            ),
      )
    } catch (caught) {
      results.push(
        error(
          'current_app',
          'Current app',
          describeError(caught),
          'Keep the device unlocked and try again.',
        ),
      )
      results.push(skipped('keyboard', 'Input method', 'Device state could not be read.'))
    }
  } else {
    results.push(skipped('current_app', 'Current app', 'Connect a device before checking app state.'))
    results.push(skipped('keyboard', 'Input method', 'Connect a device before checking input methods.'))
  }

  if (deviceReady) {
    if (!device.getInputMethods) {
      results.push(
        warn(
          'adb_keyboard',
          'ADB Keyboard',
          'Installed input methods cannot be listed by this backend.',
          'Use the enable button if complex text input fails.',
        ),
      )
    } else {
      try {
        const inputMethods = await device.getInputMethods()
        results.push(
          isAdbKeyboardInstalled(inputMethods)
            ? ok('adb_keyboard', 'ADB Keyboard', 'ADB Keyboard or AutoGLM Keyboard is installed.')
            : warn(
                'adb_keyboard',
                'ADB Keyboard',
                'ADB Keyboard was not found in installed input methods.',
                'Install and enable ADB Keyboard for Chinese or complex text input.',
              ),
        )
      } catch (caught) {
        results.push(
          error(
            'adb_keyboard',
            'ADB Keyboard',
            describeError(caught),
            'Run the input-method check again after reconnecting the device.',
          ),
        )
      }
    }
  } else {
    results.push(skipped('adb_keyboard', 'ADB Keyboard', 'Connect a device before checking ADB Keyboard.'))
  }

  results.push(
    modelConfigReady
      ? ok('model_config', 'Model config', `${modelConfig.model} at ${normalizeBaseUrl(modelConfig.baseUrl)}`)
      : error(
          'model_config',
          'Model config',
          'Base URL, API key, and model are required.',
          'Fill in the model settings before running the agent.',
        ),
  )

  if (modelConfigReady) {
    try {
      if (probeModel) {
        const probe = await probeModel(modelConfig)
        results.push(
          probe.ok
            ? ok('model_api', 'Model API', `Connection succeeded for ${probe.message}.`)
            : error(
                'model_api',
                'Model API',
                probe.message,
                'Check the Base URL, API key, model name, and proxy configuration.',
              ),
        )
      } else {
        const response = await fetcher(`${normalizeBaseUrl(modelConfig.baseUrl)}/models`, {
          headers: {
            Authorization: `Bearer ${modelConfig.apiKey}`,
          },
        })
        results.push(
          response.ok
            ? ok('model_api', 'Model API', `/models responded with ${response.status}.`)
            : error(
                'model_api',
                'Model API',
                `/models responded with ${response.status}.`,
                'Check the Base URL, API key, provider CORS policy, and model access.',
              ),
        )
      }
    } catch (caught) {
      results.push(
        error(
          'model_api',
          'Model API',
          describeError(caught),
          'If this is a browser CORS failure, use an API endpoint that allows web requests.',
        ),
      )
    }
  } else {
    results.push(skipped('model_api', 'Model API', 'Model config is incomplete.'))
  }

  return results
}

export function summarizeDoctorResults(results: readonly DoctorCheckResult[]) {
  const counts = results.reduce(
    (summary, result) => {
      summary[result.status] += 1
      return summary
    },
    { error: 0, ok: 0, skipped: 0, warn: 0 } satisfies Record<DoctorCheckStatus, number>,
  )

  return `${counts.ok} ok, ${counts.warn} warnings, ${counts.error} errors, ${counts.skipped} skipped`
}

export function formatDoctorResults(results: readonly DoctorCheckResult[]) {
  return results
    .map((result) =>
      [
        `[${result.status.toUpperCase()}] ${result.title}: ${result.detail}`,
        result.fix ? `Fix: ${result.fix}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

function ok(id: DoctorCheckId, title: string, detail: string): DoctorCheckResult {
  return { id, title, status: 'ok', detail }
}

function warn(id: DoctorCheckId, title: string, detail: string, fix?: string): DoctorCheckResult {
  return { id, title, status: 'warn', detail, ...(fix ? { fix } : {}) }
}

function error(id: DoctorCheckId, title: string, detail: string, fix?: string): DoctorCheckResult {
  return { id, title, status: 'error', detail, ...(fix ? { fix } : {}) }
}

function skipped(id: DoctorCheckId, title: string, detail: string): DoctorCheckResult {
  return { id, title, status: 'skipped', detail }
}

function formatDoctorDeviceState(state: DeviceState) {
  return [
    state.app,
    state.packageName ? `package=${state.packageName}` : null,
    state.activity ? `activity=${state.activity}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return String(error || 'Unknown error')
}
