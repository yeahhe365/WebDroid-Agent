import type { ScreenSize } from '../lib/actionTypes'
import { resolveAppNameFromPackage } from './appPackages'
import { DeviceBackendError, type DeviceState } from './deviceTypes'

export function parseCurrentAppFromDumpsys(output: string) {
  const packageName = parseFocusedComponent(output)?.packageName
  if (!packageName) {
    return 'System Home'
  }

  return resolveAppNameFromPackage(packageName) ?? packageName
}

export function parseDeviceStateFromDumpsys(output: string): DeviceState {
  const focus = parseFocusedComponent(output)
  if (!focus) {
    return { app: 'System Home', orientation: parseOrientation(output) }
  }

  return {
    app: resolveAppNameFromPackage(focus.packageName) ?? focus.packageName,
    packageName: focus.packageName,
    activity: focus.activity,
    orientation: parseOrientation(output),
  }
}

export function parsePngSize(bytes: Uint8Array): ScreenSize {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const isPng = signature.every((value, index) => bytes[index] === value)

  if (!isPng || bytes.length < 24) {
    throw new DeviceBackendError(
      'Screenshot is not a valid PNG.',
      'io',
      'invalid-screenshot',
    )
  }

  return {
    width: readUInt32(bytes, 16),
    height: readUInt32(bytes, 20),
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType = 'image/png') {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

function parseFocusedComponent(output: string): { packageName: string; activity?: string } | null {
  const focusLines = output
    .split('\n')
    .filter((line) => line.includes('mCurrentFocus') || line.includes('mFocusedApp'))

  for (const line of focusLines) {
    const packageMatch = line.match(/\b([a-zA-Z][\w]*(?:\.[\w]+)+)\/([^\s}]+)/)
    if (packageMatch) {
      return {
        packageName: packageMatch[1],
        activity: packageMatch[2],
      }
    }
  }

  return null
}

function parseOrientation(output: string): DeviceState['orientation'] {
  const match = output.match(/\bmCurrentAppOrientation=(-?\d+)/)
  if (!match) {
    return undefined
  }

  if (match[1] === '1') {
    return 'portrait'
  }
  if (match[1] === '0') {
    return 'landscape'
  }
  return 'unknown'
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}
