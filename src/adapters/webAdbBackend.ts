import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import AdbWebCredentialStore from '@yume-chan/adb-credential-web'
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import { ReadableStream } from '@yume-chan/stream-extra'
import type { AgentAction } from '../lib/actionTypes'
import { delayWithAbort, isAbortError, throwIfAborted, withAbort } from '../lib/abortSignal'
import {
  ADB_KEYBOARD_REMOTE_APK_PATH,
  encodeAdbKeyboardText,
  findAdbKeyboardIme,
  isAndroidInputTextSafe,
} from './adbKeyboard'
import {
  bytesToDataUrl,
  parseDeviceStateFromDumpsys,
  parsePngSize,
} from './deviceParsers'
import {
  DEFAULT_DEVICE_OPERATION_TIMEOUT_MS,
  DEFAULT_DEVICE_WRITE_TIMEOUT_MS,
  delay,
  retryDeviceOperation,
  withTimeout,
} from './deviceRetry'
import { DEFAULT_DEVICE_TIMING } from './deviceTiming'
import {
  DeviceBackendError,
  type DeviceCommandStep,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceScreenshot,
  type DeviceScreenshotOptions,
  type DeviceState,
  type DeviceTimingConfig,
  type ExecuteActionOptions,
  type InstalledApp,
} from './deviceTypes'
import { buildInputCommandSequence, buildSetClipboardCommand } from './inputCommands'
import { parseInstalledAppsFromPackageOutput } from './installedApps'
import { assertSensitiveActionConfirmed } from './sensitiveActions'
import { preprocessScreenshotForModel } from './screenshotPreprocess'
import {
  buildDeleteScreenBrightnessCommand,
  buildDeleteScreenBrightnessModeCommand,
  buildReadScreenBrightnessCommand,
  buildReadScreenBrightnessModeCommand,
  buildSetScreenBrightnessCommand,
  buildSetScreenBrightnessModeCommand,
  normalizeScreenSetting,
  SCREEN_BRIGHTNESS_BLACKOUT_VALUE,
  SCREEN_BRIGHTNESS_MODE_MANUAL_VALUE,
  type ScreenBlackoutRestoreSettings,
} from './screenBlackoutCommands'
import {
  buildEnableStayAwakeCommand,
  buildReadStayAwakeSettingCommand,
  buildRestoreStayAwakeSettingCommand,
  buildWakeDeviceCommand,
  normalizeStayAwakeSetting,
} from './stayAwakeCommands'
import {
  buildDumpScreenTreeCommand,
  buildReadScreenTreeCommand,
  buildRemoveScreenTreeCommand,
  parseUiAutomatorDumpXml,
} from './uiAutomator'

const ADB_KEYBOARD_BROADCAST_ERROR = [
  'ADB Keyboard or AutoGLM Keyboard was detected but did not accept the text or clear broadcast.',
  'Re-enable the keyboard on the device, then try again.',
].join(' ')

const ADB_KEYBOARD_MISSING_ERROR = [
  'Clearing text, Chinese text, or complex text requires ADB Keyboard or AutoGLM Keyboard.',
  'Install and enable it on the device, then try again.',
].join(' ')

const DEVICE_READ_RECOVER_AFTER_ATTEMPT = 2

export class WebAdbDeviceBackend implements DeviceBackend {
  #adb: Adb | null = null
  #deviceInfo: DeviceInfo | null = null
  #preferAdbKeyboard = false
  #timing: DeviceTimingConfig = DEFAULT_DEVICE_TIMING
  #installedApps: InstalledApp[] | null = null
  #stayAwakeRestoreValue: string | null = null
  #stayAwakeEnabled = false
  #screenBlackoutRestoreSettings: ScreenBlackoutRestoreSettings | null = null
  #clipboardText: string | null = null

  get isConnected() {
    return this.#adb !== null
  }

  get deviceInfo() {
    return this.#deviceInfo
  }

  async connect(): Promise<DeviceInfo> {
    if (this.#adb) {
      await this.disconnect()
    }

    this.#installedApps = null
    this.#clipboardText = null
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!manager) {
      throw new DeviceBackendError('WebUSB is not available in this browser.')
    }

    const device = await manager.requestDevice()
    if (!device) {
      throw new DeviceBackendError('No Android ADB device was selected.')
    }

    const connection = await device.connect()
    let transport: AdbDaemonTransport
    try {
      transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: new AdbWebCredentialStore('webdroid-agent'),
      })
    } catch (caught) {
      // Authentication fails when the user declines the on-device prompt.
      // Release the USB connection instead of leaving the interface open.
      await closeUsbConnection(connection)
      throw caught instanceof DeviceBackendError
        ? caught
        : new DeviceBackendError(
            `Failed to authorise the ADB connection: ${
              caught instanceof Error ? caught.message : String(caught)
            }`,
          )
    }

    this.#adb = new Adb(transport)
    this.#deviceInfo = {
      serial: device.serial,
      name: device.name || transport.banner.model || 'Android device',
    }

    await this.#enableStayAwakeDuringConnection().catch(() => undefined)

    return this.#deviceInfo
  }

  async disconnect() {
    const adb = this.#adb
    if (adb) {
      await this.#restoreScreenBlackout(adb).catch(() => undefined)
      await this.#restoreStayAwakeAfterConnection(adb).catch(() => undefined)
    }
    await adb?.close()
    this.#adb = null
    this.#deviceInfo = null
    this.#installedApps = null
    this.#clipboardText = null
  }

  async screenshot(options?: DeviceScreenshotOptions): Promise<DeviceScreenshot> {
    return retryDeviceOperation(() => this.#readScreenshot(options), {
      label: 'screenshot',
      recoverAfterAttempt: DEVICE_READ_RECOVER_AFTER_ATTEMPT,
      recover: () => this.#recoverDeviceRead(),
    })
  }

  async getCurrentApp(): Promise<string> {
    return (await this.getDeviceState()).app
  }

  async getDeviceState(): Promise<DeviceState> {
    return retryDeviceOperation(() => this.#readDeviceState(), {
      label: 'device state',
      recoverAfterAttempt: DEVICE_READ_RECOVER_AFTER_ATTEMPT,
      recover: () => this.#recoverDeviceRead(),
    })
  }

  async getScreenTree() {
    return retryDeviceOperation(() => this.#readScreenTree(), {
      label: 'screen tree',
      maxAttempts: 2,
      recoverAfterAttempt: 1,
      recover: () => this.#recoverDeviceRead(),
    })
  }

  async getInputMethods(): Promise<string> {
    return retryDeviceOperation(
      () => this.#requireAdb().subprocess.noneProtocol.spawnWaitText(['ime', 'list', '-s']),
      {
        label: 'input methods',
        recoverAfterAttempt: DEVICE_READ_RECOVER_AFTER_ATTEMPT,
        recover: () => this.#recoverDeviceRead(),
      },
    )
  }

  async getInstalledApps(): Promise<InstalledApp[]> {
    if (this.#installedApps) {
      return this.#installedApps
    }

    this.#installedApps = await retryDeviceOperation(() => this.#readInstalledApps(), {
      label: 'installed apps',
      recoverAfterAttempt: DEVICE_READ_RECOVER_AFTER_ATTEMPT,
      recover: () => this.#recoverDeviceRead(),
    })
    return this.#installedApps
  }

  async #readScreenshot(options?: DeviceScreenshotOptions): Promise<DeviceScreenshot> {
    const adb = this.#requireAdb()
    const bytes = await adb.subprocess.noneProtocol.spawnWait(['screencap', '-p'])
    const screen = parsePngSize(bytes)
    let modelScreenshot:
      | { modelDataUrl: string; modelScreen: typeof screen; modelGridDivisions?: number }
      | undefined
    const imageUrl = createImageObjectUrl(bytes)

    try {
      modelScreenshot = await preprocessScreenshotForModel({
        dataUrl: imageUrl,
        screen,
        coordinateMode: options?.coordinateMode,
      })
    } catch {
      const dataUrl = bytesToDataUrl(bytes)
      modelScreenshot = { modelDataUrl: dataUrl, modelScreen: screen }
    } finally {
      revokeImageObjectUrl(imageUrl)
    }

    return {
      dataUrl: modelScreenshot.modelDataUrl,
      screen,
      modelScreen: modelScreenshot.modelScreen,
      modelGridDivisions: modelScreenshot.modelGridDivisions,
    }
  }

  async #readDeviceState(): Promise<DeviceState> {
    const adb = this.#requireAdb()
    const [windowOutput, keyboard] = await Promise.all([
      adb.subprocess.noneProtocol.spawnWaitText(['dumpsys', 'window']),
      this.#getCurrentInputMethod().catch(() => undefined),
    ])
    return {
      ...parseDeviceStateFromDumpsys(windowOutput),
      ...(keyboard ? { keyboard } : {}),
    }
  }

  async #readScreenTree() {
    const adb = this.#requireAdb()
    await adb.subprocess.noneProtocol.spawnWaitText(buildDumpScreenTreeCommand())
    try {
      const xml = await adb.subprocess.noneProtocol.spawnWaitText(buildReadScreenTreeCommand())
      return parseUiAutomatorDumpXml(xml)
    } finally {
      await adb.subprocess.noneProtocol.spawnWaitText(buildRemoveScreenTreeCommand()).catch(() => undefined)
    }
  }

  async #recoverDeviceRead() {
    const adb = this.#requireAdb()
    await delay(150)
    await withTimeout(
      () => adb.subprocess.noneProtocol.spawnWaitText(['echo', 'webdroid-device-read-recovery']),
      DEFAULT_DEVICE_OPERATION_TIMEOUT_MS,
      'device read recovery',
    )
  }

  async #enableStayAwakeDuringConnection() {
    const adb = this.#requireAdb()
    const originalValue = await adb.subprocess.noneProtocol
      .spawnWaitText(buildReadStayAwakeSettingCommand())
      .then(normalizeStayAwakeSetting)
      .catch(() => null)
    if (!originalValue) {
      // We could not read the user's setting, so we must not change it: there
      // would be no way to restore it on disconnect.
      return
    }
    await adb.subprocess.noneProtocol.spawnWaitText(buildEnableStayAwakeCommand())
    this.#stayAwakeRestoreValue = originalValue
    this.#stayAwakeEnabled = true
    await adb.subprocess.noneProtocol.spawnWait(buildWakeDeviceCommand()).catch(() => undefined)
  }

  async #restoreStayAwakeAfterConnection(adb: Adb) {
    if (!this.#stayAwakeEnabled) {
      return
    }

    try {
      if (!this.#stayAwakeRestoreValue) {
        // Unknown original value: leave the device as it is rather than
        // force-disabling a setting the user may have enabled themselves.
        return
      }

      await adb.subprocess.noneProtocol.spawnWaitText(
        buildRestoreStayAwakeSettingCommand(this.#stayAwakeRestoreValue),
      )
    } finally {
      this.#stayAwakeRestoreValue = null
      this.#stayAwakeEnabled = false
    }
  }

  async execute(action: AgentAction, options?: ExecuteActionOptions): Promise<string> {
    const signal = options?.signal
    throwIfAborted(signal)

    if (action.action === 'wait') {
      await delayWithAbort(action.ms, signal)
      return `Waited ${action.ms}ms.`
    }

    if (action.action === 'take_over') {
      return action.message
    }

    if (action.action === 'note') {
      return action.message
    }

    if (action.action === 'done') {
      return action.summary || 'Task completed.'
    }

    if (action.action === 'interact') {
      throw new DeviceBackendError(`Manual interaction required: ${action.message}`)
    }

    if (action.action === 'call_api') {
      throw new DeviceBackendError(`Unsupported call_api action: ${action.instruction}`)
    }

    if (action.action === 'set_clipboard') {
      this.#clipboardText = action.text
      const syncResult = await this.#setDeviceClipboard(action.text, signal).catch((caught) => {
        if (isAbortError(caught)) {
          throw caught
        }
        return caught instanceof Error ? caught.message : String(caught)
      })
      return await this.#withActionSettle(
        [
          `Stored ${action.text.length} clipboard characters in WebDroid.`,
          syncResult ? `Device clipboard sync: ${syncResult}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        signal,
      )
    }

    if (action.action === 'paste' && this.#clipboardText) {
      const executed = await this.#pasteWebDroidClipboardText(this.#clipboardText, signal)
      return await this.#withActionSettle(
        [executed, 'Pasted WebDroid clipboard text.'].join('\n'),
        signal,
      )
    }

    if (
      action.action === 'input_text' &&
      (action.clear || this.#preferAdbKeyboard || !isAndroidInputTextSafe(action.text))
    ) {
      const executed = await this.#inputTextWithAdbKeyboard(action.text, {
        clear: action.clear,
        signal,
      })
      return await this.#withActionSettle(executed, signal)
    }

    await assertSensitiveActionConfirmed(action, options)
    throwIfAborted(signal)

    const installedApps =
      action.action === 'launch' ? await this.getInstalledApps().catch(() => []) : undefined
    throwIfAborted(signal)
    const sequence = buildInputCommandSequence(action, this.#timing, installedApps)
    if (sequence.length === 0) {
      return 'No device command required.'
    }

    const executed: string[] = []
    for (const step of sequence) {
      await this.#executeCommandStep(step, signal)
      executed.push(isWaitStep(step) ? `wait ${step.waitMs}ms` : step.join(' '))
    }

    return await this.#withActionSettle(executed.join('\n'), signal)
  }

  async enableAdbKeyboard(): Promise<string> {
    const adb = this.#requireAdb()
    const keyboardIme = await this.#detectAdbKeyboardIme()
    const enable = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', keyboardIme])
    const set = await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', keyboardIme])
    this.#preferAdbKeyboard = true
    return [enable.trim(), set.trim()].filter(Boolean).join('\n') || `Enabled ${keyboardIme}`
  }

  async installAdbKeyboard(apkBytes: Uint8Array): Promise<string> {
    if (apkBytes.byteLength === 0) {
      throw new DeviceBackendError('Downloaded ADB Keyboard APK is empty.')
    }

    const adb = this.#requireAdb()
    const sync = await adb.sync()
    try {
      await sync.write({
        filename: ADB_KEYBOARD_REMOTE_APK_PATH,
        file: bytesToReadableStream(apkBytes),
        permission: 0o644,
      })
    } finally {
      await sync.dispose().catch(() => undefined)
    }

    try {
      const installOutput = await adb.subprocess.noneProtocol.spawnWaitText([
        'pm',
        'install',
        '-r',
        ADB_KEYBOARD_REMOTE_APK_PATH,
      ])
      this.#installedApps = null
      return [
        `Pushed ${apkBytes.byteLength} bytes to ${ADB_KEYBOARD_REMOTE_APK_PATH}.`,
        installOutput.trim() || 'pm install completed.',
      ].join('\n')
    } finally {
      await adb.rm(ADB_KEYBOARD_REMOTE_APK_PATH, { force: true }).catch(() => undefined)
    }
  }

  async startScreenBlackout(): Promise<string> {
    const adb = this.#requireAdb()
    if (this.#screenBlackoutRestoreSettings) {
      return 'Screen blackout is already active.'
    }

    const [brightness, brightnessMode] = await Promise.all([
      adb.subprocess.noneProtocol
        .spawnWaitText(buildReadScreenBrightnessCommand())
        .then(normalizeScreenSetting)
        .catch(() => null),
      adb.subprocess.noneProtocol
        .spawnWaitText(buildReadScreenBrightnessModeCommand())
        .then(normalizeScreenSetting)
        .catch(() => null),
    ])

    this.#screenBlackoutRestoreSettings = { brightness, brightnessMode }
    try {
      await adb.subprocess.noneProtocol.spawnWaitText(
        buildSetScreenBrightnessModeCommand(SCREEN_BRIGHTNESS_MODE_MANUAL_VALUE),
      )
      await adb.subprocess.noneProtocol.spawnWaitText(
        buildSetScreenBrightnessCommand(SCREEN_BRIGHTNESS_BLACKOUT_VALUE),
      )
      return 'Screen brightness set to 0 for automatic control.'
    } catch (caught) {
      await this.#restoreScreenBlackout(adb).catch(() => undefined)
      throw caught
    }
  }

  async stopScreenBlackout(): Promise<string> {
    return await this.#restoreScreenBlackout(this.#requireAdb())
  }

  setPreferAdbKeyboard(value: boolean) {
    this.#preferAdbKeyboard = value
  }

  setTimingConfig(value: DeviceTimingConfig) {
    this.#timing = value
  }

  async #readInstalledApps(): Promise<InstalledApp[]> {
    const adb = this.#requireAdb()
    const output = await adb.subprocess.noneProtocol.spawnWaitText([
      'cmd',
      'package',
      'query-activities',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
    ])
    return parseInstalledAppsFromPackageOutput(output)
  }

  async #executeCommandStep(step: DeviceCommandStep, signal?: AbortSignal) {
    throwIfAborted(signal)
    if (isWaitStep(step)) {
      await delayWithAbort(step.waitMs, signal)
      return
    }

    const adb = this.#requireAdb()
    await withAbort(
      withTimeout(
        () => adb.subprocess.noneProtocol.spawnWait(step),
        DEFAULT_DEVICE_WRITE_TIMEOUT_MS,
        'device command',
      ),
      signal,
    )
  }

  async #restoreScreenBlackout(adb: Adb) {
    const restoreSettings = this.#screenBlackoutRestoreSettings
    if (!restoreSettings) {
      return 'Screen blackout is not active.'
    }

    try {
      if (restoreSettings.brightness) {
        await adb.subprocess.noneProtocol.spawnWaitText(
          buildSetScreenBrightnessCommand(restoreSettings.brightness),
        )
      } else {
        await adb.subprocess.noneProtocol.spawnWaitText(buildDeleteScreenBrightnessCommand())
      }

      if (restoreSettings.brightnessMode) {
        await adb.subprocess.noneProtocol.spawnWaitText(
          buildSetScreenBrightnessModeCommand(restoreSettings.brightnessMode),
        )
      } else {
        await adb.subprocess.noneProtocol.spawnWaitText(buildDeleteScreenBrightnessModeCommand())
      }

      return 'Screen brightness restored.'
    } finally {
      this.#screenBlackoutRestoreSettings = null
    }
  }

  async #withActionSettle(result: string, signal?: AbortSignal) {
    if (this.#timing.actionSettleMs <= 0) {
      return result
    }

    await delayWithAbort(this.#timing.actionSettleMs, signal)
    return [result, `wait ${this.#timing.actionSettleMs}ms`].filter(Boolean).join('\n')
  }

  async #inputTextWithAdbKeyboard(
    text: string,
    options: { clear?: boolean; signal?: AbortSignal } = {},
  ) {
    const signal = options.signal
    const adb = this.#requireAdb()
    const keyboardIme = await this.#detectAdbKeyboardIme()
    const originalIme = await this.#getCurrentInputMethod()
    const executed: string[] = []

    try {
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'enable', keyboardIme])
      executed.push(`ime enable ${keyboardIme}`)
      await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', keyboardIme])
      executed.push(`ime set ${keyboardIme}`)
      await this.#sendAdbKeyboardText('')
      executed.push('am broadcast -a ADB_INPUT_B64 --es msg <empty>')
      await delayWithAbort(this.#timing.keyboardStepMs, signal)

      if (options.clear) {
        await withAbort(
          adb.subprocess.noneProtocol.spawnWait(['am', 'broadcast', '-a', 'ADB_CLEAR_TEXT']),
          signal,
        )
        executed.push('am broadcast -a ADB_CLEAR_TEXT')
        await delayWithAbort(this.#timing.keyboardStepMs, signal)
      }

      const command = await this.#sendAdbKeyboardText(text)
      executed.push(command.join(' '))
      await delayWithAbort(this.#timing.keyboardStepMs, signal)
    } catch (caught) {
      if (isAbortError(caught)) {
        throw caught
      }
      throw new DeviceBackendError(ADB_KEYBOARD_BROADCAST_ERROR)
    } finally {
      if (originalIme && originalIme !== keyboardIme) {
        await adb.subprocess.noneProtocol.spawnWaitText(['ime', 'set', originalIme])
        await delay(this.#timing.keyboardStepMs)
      }
    }

    this.#preferAdbKeyboard = true
    return executed.join('\n')
  }

  async #setDeviceClipboard(text: string, signal?: AbortSignal) {
    const adb = this.#requireAdb()
    await withAbort(
      adb.subprocess.noneProtocol.spawnWaitText([...buildSetClipboardCommand(text)]),
      signal,
    )
    return 'cmd clipboard set completed.'
  }

  async #pasteWebDroidClipboardText(text: string, signal?: AbortSignal) {
    if (this.#preferAdbKeyboard || !isAndroidInputTextSafe(text)) {
      try {
        return await this.#inputTextWithAdbKeyboard(text, { signal })
      } catch (caught) {
        if (isAbortError(caught)) {
          throw caught
        }
        await this.#executeCommandStep(['input', 'keyevent', 'KEYCODE_PASTE'], signal)
        return [
          'input keyevent KEYCODE_PASTE',
          `ADB Keyboard paste fallback failed: ${
            caught instanceof Error ? caught.message : String(caught)
          }`,
        ].join('\n')
      }
    }

    const sequence = buildInputCommandSequence({ action: 'input_text', text }, this.#timing)
    const executed: string[] = []
    for (const step of sequence) {
      await this.#executeCommandStep(step, signal)
      executed.push(isWaitStep(step) ? `wait ${step.waitMs}ms` : step.join(' '))
    }
    return executed.join('\n')
  }

  async #sendAdbKeyboardText(text: string) {
    const command = [
      'am',
      'broadcast',
      '-a',
      'ADB_INPUT_B64',
      '--es',
      'msg',
      encodeAdbKeyboardText(text),
    ]
    const adb = this.#requireAdb()
    await adb.subprocess.noneProtocol.spawnWait(command)
    return command
  }

  async #detectAdbKeyboardIme() {
    const imeList = await this.#requireAdb().subprocess.noneProtocol.spawnWaitText([
      'ime',
      'list',
      '-s',
    ])
    const keyboardIme = findAdbKeyboardIme(imeList)
    if (!keyboardIme) {
      throw new DeviceBackendError(ADB_KEYBOARD_MISSING_ERROR)
    }
    return keyboardIme
  }

  async #getCurrentInputMethod() {
    const result = await this.#requireAdb().subprocess.noneProtocol.spawnWaitText([
      'settings',
      'get',
      'secure',
      'default_input_method',
    ])
    return result.trim()
  }

  #requireAdb() {
    if (!this.#adb) {
      throw new DeviceBackendError('Connect an Android device first.')
    }

    return this.#adb
  }
}

function isWaitStep(step: DeviceCommandStep): step is { waitMs: number } {
  return !Array.isArray(step)
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function createImageObjectUrl(bytes: Uint8Array) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return bytesToDataUrl(bytes)
  }
  const blobBytes = new Uint8Array(bytes)
  return URL.createObjectURL(new Blob([blobBytes], { type: 'image/png' }))
}

function revokeImageObjectUrl(value: string) {
  if (!value.startsWith('blob:') || typeof URL === 'undefined') {
    return
  }
  URL.revokeObjectURL(value)
}

/**
 * Cancelling the readable stream performs the library's USB cleanup (interface
 * release + device close); aborting the writable is a best-effort backstop.
 */
async function closeUsbConnection(connection: {
  readable: ReadableStream<unknown>
  writable: WritableStream<unknown>
}): Promise<void> {
  try {
    await connection.readable.cancel()
  } catch {
    // Best effort: the connection may already be gone.
  }
  try {
    await connection.writable.abort()
  } catch {
    // Best effort: the connection may already be gone.
  }
}
