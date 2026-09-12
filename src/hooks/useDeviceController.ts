import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ADB_KEYBOARD_APK_URL } from '../adapters/adbKeyboard'
import type {
  DeviceBackend,
  DeviceInfo,
  DeviceScreenshot,
  DeviceState,
  DeviceTimingConfig,
  InstalledApp,
} from '../adapters/deviceTypes'
import { getInstalledAppDisplayName } from '../adapters/installedApps'
import { isWebUsbSupported } from '../adapters/webUsbSupport'
import { buildActionPreview } from '../lib/actionPreview'
import type { AgentAction } from '../lib/actionTypes'
import type { AgentSession } from '../lib/agent'
import type { AppCopy } from '../lib/appCopy'
import type { BusyTask, BusyTaskId } from '../lib/busyTask'
import {
  formatDoctorResults,
  runDeviceDoctor,
  summarizeDoctorResults,
  type DoctorCheckResult,
} from '../lib/deviceDoctor'
import { createUnknownDeviceState, UNKNOWN_APP_NAME } from '../lib/deviceState'
import type { ModelConfig } from '../lib/openAiTypes'
import type { LogEntryInput } from '../lib/runLogEntries'
import { formatScreenCaptureDetail, toLogScreenshot } from '../lib/runLogEntries'
import { compactScreenshotForMemory, mapActionCoordinates, modelScreenshotView } from '../lib/screenshot'
import type { AppSettings } from '../lib/settings'
import { useDeviceBackendPreferences } from './useDeviceBackendPreferences'

type RunTask = (id: BusyTaskId, label: string, action: () => Promise<void>) => Promise<void>

export type DeviceSnapshotUpdate = {
  currentApp: string
  deviceState: DeviceState
  screenshot: DeviceScreenshot
}

type UseDeviceControllerInput = {
  addLog: (entry: LogEntryInput) => void
  backend: DeviceBackend & {
    enableAdbKeyboard?(): Promise<string>
    setPreferAdbKeyboard(value: boolean): void
    setTimingConfig(value: DeviceTimingConfig): void
  }
  busyTask: BusyTask | null
  confirmSensitiveActionRequest: (
    message: string,
    action: AgentAction,
  ) => boolean | Promise<boolean>
  copy: AppCopy
  initialSettings: AppSettings
  modelConfig: ModelConfig
  onPendingStepReset: () => void
  runTask: RunTask
}

export function useDeviceController({
  addLog,
  backend,
  busyTask,
  confirmSensitiveActionRequest,
  copy,
  initialSettings,
  modelConfig,
  onPendingStepReset,
  runTask,
}: UseDeviceControllerInput) {
  const [preferAdbKeyboard, setPreferAdbKeyboard] = useState(initialSettings.preferAdbKeyboard)
  const [confirmSensitiveActions, setConfirmSensitiveActions] = useState(
    initialSettings.confirmSensitiveActions,
  )
  const [unrestrictedMode, setUnrestrictedMode] = useState(initialSettings.unrestrictedMode)
  const [actionSettleMs, setActionSettleMs] = useState(initialSettings.actionSettleMs)
  const [doubleTapIntervalMs, setDoubleTapIntervalMs] = useState(
    initialSettings.doubleTapIntervalMs,
  )
  const [keyboardStepMs, setKeyboardStepMs] = useState(initialSettings.keyboardStepMs)
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [currentApp, setCurrentApp] = useState<string>(UNKNOWN_APP_NAME)
  const [deviceState, setDeviceState] = useState<DeviceState>(() => createUnknownDeviceState())
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [doctorResults, setDoctorResults] = useState<DoctorCheckResult[]>([])
  const [screenshot, setScreenshot] = useState<DeviceScreenshot | null>(null)

  const connected = deviceInfo !== null
  const displayedScreenshot = useMemo(
    () => (screenshot ? modelScreenshotView(screenshot) : null),
    [screenshot],
  )

  useDeviceBackendPreferences(backend, {
    actionSettleMs,
    doubleTapIntervalMs,
    keyboardStepMs,
    preferAdbKeyboard,
  })

  const applyDeviceSnapshot = useCallback(
    ({ currentApp, deviceState, screenshot }: DeviceSnapshotUpdate) => {
      setScreenshot(compactScreenshotForMemory(screenshot))
      setCurrentApp(currentApp)
      setDeviceState(deviceState)
    },
    [],
  )

  const applySessionDeviceState = useCallback((session: AgentSession) => {
    setCurrentApp(session.currentApp)
    setDeviceState(session.deviceState)
    setScreenshot(session.lastScreenshot ?? session.deviceSnapshot?.screenshot ?? null)
  }, [])

  const refreshDisplayedSnapshot = useCallback(async () => {
    const nextScreenshot = await backend.screenshot()
    const retainedScreenshot = compactScreenshotForMemory(nextScreenshot)
    const nextDeviceState = await backend.getDeviceState()
    applyDeviceSnapshot({
      screenshot: retainedScreenshot,
      currentApp: nextDeviceState.app,
      deviceState: nextDeviceState,
    })
    return { screenshot: retainedScreenshot, deviceState: nextDeviceState }
  }, [applyDeviceSnapshot, backend])

  const logScreenCapture = useCallback(
    (nextScreenshot: DeviceScreenshot, nextDeviceState: DeviceState) => {
      addLog({
        tone: 'ok',
        title: copy.screenCaptured,
        detail: formatScreenCaptureDetail(nextScreenshot, nextDeviceState),
        screenshot: toLogScreenshot(nextScreenshot),
      })
    },
    [addLog, copy],
  )

  const refreshInstalledApps = useCallback(async () => {
    if (!backend.getInstalledApps) {
      setInstalledApps([])
      return
    }

    try {
      setInstalledApps(await backend.getInstalledApps())
    } catch {
      setInstalledApps([])
    }
  }, [backend])

  const connectDevice = useCallback(async () => {
    await runTask('connect-device', copy.connectDeviceTask, async () => {
      const info = await backend.connect()
      setDeviceInfo(info)
      addLog({ tone: 'ok', title: copy.deviceConnected, detail: `${info.name} (${info.serial})` })
      const { screenshot: nextScreenshot, deviceState: nextDeviceState } =
        await refreshDisplayedSnapshot()
      logScreenCapture(nextScreenshot, nextDeviceState)
      await refreshInstalledApps()
    })
  }, [addLog, backend, copy, logScreenCapture, refreshDisplayedSnapshot, refreshInstalledApps, runTask])

  const disconnectDevice = useCallback(async () => {
    await runTask('disconnect-device', copy.disconnectDeviceTask, async () => {
      await backend.disconnect()
      setDeviceInfo(null)
      setCurrentApp(UNKNOWN_APP_NAME)
      setDeviceState(createUnknownDeviceState())
      setInstalledApps([])
      setDoctorResults([])
      setScreenshot(null)
      onPendingStepReset()
      addLog({ tone: 'info', title: copy.deviceDisconnected })
    })
  }, [addLog, backend, copy, onPendingStepReset, runTask])

  const deviceSerialRef = useRef<string | null>(null)
  useEffect(() => {
    deviceSerialRef.current = deviceInfo?.serial ?? null
  }, [deviceInfo])

  // A physical cable pull (or a revoked ADB authorisation) does not surface
  // through the ADB stack until the next command fails. Listen to the WebUSB
  // disconnect event so the UI stops claiming the device is connected.
  useEffect(() => {
    const usb = getNavigatorUsb()
    if (!usb) {
      return
    }

    const handleDisconnect = (event: unknown) => {
      const currentSerial = deviceSerialRef.current
      if (!currentSerial) {
        return
      }
      const eventSerial = readUsbDisconnectSerial(event)
      if (eventSerial && eventSerial !== currentSerial) {
        return
      }
      void disconnectDevice()
    }

    usb.addEventListener('disconnect', handleDisconnect)
    return () => usb.removeEventListener('disconnect', handleDisconnect)
  }, [disconnectDevice])

  // Device-side changes (stay-awake, screen brightness) are only undone by an
  // explicit disconnect(). Best effort on tab close so they are not left behind.
  useEffect(() => {
    const handlePageHide = () => {
      if (!deviceSerialRef.current) {
        return
      }
      void backend.disconnect().catch(() => undefined)
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [backend])

  const captureScreen = useCallback(async () => {
    await runTask('capture-screen', copy.captureScreenTask, async () => {
      const { screenshot: nextScreenshot, deviceState: nextDeviceState } =
        await refreshDisplayedSnapshot()
      logScreenCapture(nextScreenshot, nextDeviceState)
    })
  }, [copy, logScreenCapture, refreshDisplayedSnapshot, runTask])

  const configureAdbKeyboard = useCallback(async () => {
    await runTask('configure-adb-keyboard', copy.configureTextInput, async () => {
      if (!backend.getInputMethods || !backend.installAdbKeyboard || !backend.enableAdbKeyboard) {
        throw new Error(copy.noAdbKeyboardDownloadSupport)
      }

      const inputMethods = await backend.getInputMethods().catch(() => '')
      const adbKeyboardInstalled = /adbkeyboard/i.test(inputMethods)
      const details: string[] = []

      if (!adbKeyboardInstalled) {
        if (typeof fetch !== 'function') {
          throw new Error(copy.noAdbKeyboardDownloadSupport)
        }

        const response = await fetch(ADB_KEYBOARD_APK_URL)
        if (!response.ok) {
          throw new Error(copy.failedToDownloadAdbKeyboard(response.status))
        }

        const apkBytes = new Uint8Array(await response.arrayBuffer())
        details.push(await backend.installAdbKeyboard(apkBytes))
      }

      details.push(await backend.enableAdbKeyboard())
      setPreferAdbKeyboard(true)
      const nextDeviceState = await backend.getDeviceState().catch(() => null)
      if (nextDeviceState) {
        setCurrentApp(nextDeviceState.app)
        setDeviceState(nextDeviceState)
      }
      addLog({
        tone: 'ok',
        title: copy.adbKeyboardConfigured,
        detail: details.filter(Boolean).join('\n'),
      })
    })
  }, [addLog, backend, copy, runTask])

  const runDoctor = useCallback(async () => {
    await runTask('run-doctor', copy.runDoctor, async () => {
      const results = await runDeviceDoctor({
        connected,
        device: backend,
        deviceInfo,
        fetcher: globalThis.fetch,
        isWebUsbSupported,
        modelConfig,
      })
      setDoctorResults(results)
      addLog({
        tone: results.some((result) => result.status === 'error')
          ? 'error'
          : results.some((result) => result.status === 'warn')
            ? 'warn'
            : 'ok',
        title: copy.doctorSummary,
        detail: [summarizeDoctorResults(results), formatDoctorResults(results)].join('\n\n'),
      })
    })
  }, [addLog, backend, connected, copy, deviceInfo, modelConfig, runTask])

  const runDirectAction = useCallback(
    async (action: AgentAction) => {
      await runTask('direct-command', copy.directCommand, async () => {
        const result = await backend.execute(action)
        addLog({
          tone: 'ok',
          title: copy.directCommand,
          detail: [buildActionPreview(action), result].filter(Boolean).join('\n'),
        })
        await refreshDisplayedSnapshot()
      })
    },
    [addLog, backend, copy, refreshDisplayedSnapshot, runTask],
  )

  const runScreenshotAction = useCallback(
    (action: AgentAction) => {
      const executionAction =
        screenshot && displayedScreenshot
          ? mapActionCoordinates(action, displayedScreenshot.screen, screenshot.screen)
          : action
      void runDirectAction(executionAction)
    },
    [displayedScreenshot, runDirectAction, screenshot],
  )

  const launchInstalledApp = useCallback(
    (app: InstalledApp) => {
      void runDirectAction({
        action: 'launch',
        app: getInstalledAppDisplayName(app),
        packageName: app.packageName,
      })
    },
    [runDirectAction],
  )

  const toggleAdbKeyboard = useCallback(
    (value: boolean) => {
      setPreferAdbKeyboard(value)
      backend.setPreferAdbKeyboard(value)
    },
    [backend],
  )

  const confirmSensitiveAction = useCallback(
    (message: string, action: AgentAction) => {
      if (unrestrictedMode || !confirmSensitiveActions) {
        return true
      }

      return confirmSensitiveActionRequest(message, action)
    },
    [confirmSensitiveActionRequest, confirmSensitiveActions, unrestrictedMode],
  )

  return {
    actions: {
      onActionSettleMsChange: setActionSettleMs,
      onCaptureScreen: captureScreen,
      onConfirmSensitiveActionsChange: setConfirmSensitiveActions,
      onConfigureAdbKeyboard: configureAdbKeyboard,
      onConnectDevice: connectDevice,
      onDisconnectDevice: disconnectDevice,
      onDoubleTapIntervalMsChange: setDoubleTapIntervalMs,
      onKeyboardStepMsChange: setKeyboardStepMs,
      onLaunchInstalledApp: launchInstalledApp,
      onPreferAdbKeyboardChange: toggleAdbKeyboard,
      onRunDirectAction: runDirectAction,
      onRunDoctor: runDoctor,
      onUnrestrictedModeChange: setUnrestrictedMode,
    },
    applyDeviceSnapshot,
    applySessionDeviceState,
    confirmSensitiveAction,
    connected,
    currentApp,
    displayedScreenshot,
    options: {
      actionSettleMs,
      confirmSensitiveActions,
      doubleTapIntervalMs,
      keyboardStepMs,
      preferAdbKeyboard,
      unrestrictedMode,
    },
    refreshDisplayedSnapshot,
    runScreenshotAction,
    screenshot,
    state: {
      busyTask,
      connected,
      currentApp,
      deviceInfo,
      deviceState,
      doctorResults,
      installedApps,
    },
  }
}

type UsbEventTarget = {
  addEventListener(type: 'disconnect', listener: (event: unknown) => void): void
  removeEventListener(type: 'disconnect', listener: (event: unknown) => void): void
}

function getNavigatorUsb(): UsbEventTarget | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const usb = (navigator as { usb?: Partial<UsbEventTarget> }).usb
  if (
    !usb ||
    typeof usb.addEventListener !== 'function' ||
    typeof usb.removeEventListener !== 'function'
  ) {
    return null
  }
  return usb as UsbEventTarget
}

function readUsbDisconnectSerial(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) {
    return null
  }
  const device = (event as { device?: { serialNumber?: unknown } }).device
  return typeof device?.serialNumber === 'string' ? device.serialNumber : null
}
