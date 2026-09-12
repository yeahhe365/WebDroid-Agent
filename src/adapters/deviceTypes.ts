import type { AgentAction, ScreenSize } from '../lib/actionTypes'
import type { ActionCoordinateMode } from '../lib/actionProtocol'
import type { DeviceScreenTree } from './uiAutomator'

export type { DeviceScreenTree } from './uiAutomator'

export type DeviceInfo = {
  serial: string
  name: string
}

export type DeviceScreenshot = {
  bytes?: Uint8Array
  dataUrl: string
  screen: ScreenSize
  modelDataUrl?: string
  modelScreen?: ScreenSize
  modelGridDivisions?: number
}

export type DeviceScreenshotOptions = {
  coordinateMode?: ActionCoordinateMode
}

export type DeviceState = {
  app: string
  packageName?: string
  activity?: string
  orientation?: 'portrait' | 'landscape' | 'unknown'
  keyboard?: string
}

export type InstalledApp = {
  packageName: string
  activity?: string
  label?: string
}

export type DeviceCommandStep = readonly string[] | { waitMs: number }

export type ExecuteActionOptions = {
  confirmSensitiveAction?: (message: string, action: AgentAction) => boolean | Promise<boolean>
  signal?: AbortSignal
}

export type DeviceTimingConfig = {
  actionSettleMs: number
  doubleTapIntervalMs: number
  keyboardStepMs: number
}

export type DeviceRetryOptions = {
  label: string
  maxAttempts?: number
  retryDelaysMs?: readonly number[]
  /** Per-attempt timeout; a hung device command is turned into a retryable error. */
  timeoutMs?: number
  recoverAfterAttempt?: number
  recover?: (error: unknown, attempt: number) => Promise<void> | void
  wait?: (ms: number) => Promise<void>
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

export type DeviceBackend = {
  connect(): Promise<DeviceInfo>
  disconnect(): Promise<void>
  screenshot(options?: DeviceScreenshotOptions): Promise<DeviceScreenshot>
  getCurrentApp(): Promise<string>
  getDeviceState(): Promise<DeviceState>
  getScreenTree?(): Promise<DeviceScreenTree>
  getInputMethods?(): Promise<string>
  getInstalledApps?(): Promise<InstalledApp[]>
  installAdbKeyboard?(apkBytes: Uint8Array): Promise<string>
  startScreenBlackout?(): Promise<string>
  stopScreenBlackout?(): Promise<string>
  execute(action: AgentAction, options?: ExecuteActionOptions): Promise<string>
}

export class DeviceBackendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceBackendError'
  }
}
