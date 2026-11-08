import { DeviceBackendError, type DeviceBackendErrorCode } from '../adapters/deviceTypes'
import type { AppCopy } from './appCopy'

/**
 * The adapter layer raises `DeviceBackendError` with English messages because
 * it runs outside React and has no locale. Anything the user is expected to
 * read is tagged with a code, and that code is translated here; everything else
 * keeps its raw message so the run log stays precise.
 */
function messageForCode(code: DeviceBackendErrorCode, copy: AppCopy): string {
  switch (code) {
    case 'webusb-unavailable':
      return copy.deviceErrorWebusbUnavailable
    case 'no-device-selected':
      return copy.deviceErrorNoDeviceSelected
    case 'device-not-connected':
      return copy.deviceErrorNotConnected
    case 'invalid-screenshot':
      return copy.deviceErrorInvalidScreenshot
  }
}

export function deviceErrorCode(caught: unknown): DeviceBackendErrorCode | null {
  return caught instanceof DeviceBackendError && caught.code ? caught.code : null
}

export function localizedErrorMessage(caught: unknown, copy: AppCopy): string {
  const code = deviceErrorCode(caught)
  if (code) {
    return messageForCode(code, copy)
  }

  return caught instanceof Error ? caught.message : String(caught)
}
