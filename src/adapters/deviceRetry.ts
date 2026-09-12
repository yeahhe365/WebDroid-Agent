import { DeviceBackendError, type DeviceRetryOptions } from './deviceTypes'

export const DEFAULT_DEVICE_READ_RETRY_DELAYS_MS = [250, 750, 1500] as const
export const DEFAULT_DEVICE_READ_MAX_ATTEMPTS = 4
/** A single hung ADB command must not block the agent forever. */
export const DEFAULT_DEVICE_OPERATION_TIMEOUT_MS = 15_000
export const DEFAULT_DEVICE_WRITE_TIMEOUT_MS = 30_000

/**
 * Reject when `operation` has not settled within `timeoutMs`. The underlying
 * device command may still be running on the device; the caller gets a normal
 * error instead of hanging forever.
 */
export function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new DeviceBackendError(`${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
    operation().then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function retryDeviceOperation<T>(
  operation: () => Promise<T>,
  {
    label,
    maxAttempts = DEFAULT_DEVICE_READ_MAX_ATTEMPTS,
    retryDelaysMs = DEFAULT_DEVICE_READ_RETRY_DELAYS_MS,
    recoverAfterAttempt,
    recover,
    wait = delay,
    shouldRetry,
    timeoutMs = DEFAULT_DEVICE_OPERATION_TIMEOUT_MS,
  }: DeviceRetryOptions,
): Promise<T> {
  let lastError: unknown
  let recoveryAttempted = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await (timeoutMs > 0 ? withTimeout(operation, timeoutMs, label) : operation())
    } catch (caught) {
      lastError = caught
      const isLastAttempt = attempt >= maxAttempts
      if (isLastAttempt || shouldRetry?.(caught, attempt) === false) {
        break
      }

      if (
        recover &&
        recoverAfterAttempt !== undefined &&
        attempt >= recoverAfterAttempt &&
        !recoveryAttempted
      ) {
        recoveryAttempted = true
        try {
          await recover(caught, attempt)
        } catch {
          // Recovery is best-effort; preserve the original read error.
        }
      }

      const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0
      if (delayMs > 0) {
        await wait(delayMs)
      }
    }
  }

  throw new DeviceBackendError(
    `Failed to get ${label} after ${maxAttempts} attempts: ${describeError(lastError)}`,
  )
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return String(error || 'unknown error')
}
