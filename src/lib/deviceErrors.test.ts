import { describe, expect, it } from 'vitest'
import { DeviceBackendError } from '../adapters/deviceTypes'
import { parsePngSize } from '../adapters/deviceParsers'
import { APP_COPY } from './appCopy'
import { deviceErrorCode, localizedErrorMessage } from './deviceErrors'

const zh = APP_COPY['zh-CN']
const en = APP_COPY['en-US']

describe('device error localization', () => {
  it('translates a coded error into the active locale', () => {
    const caught = new DeviceBackendError('No Android ADB device was selected.', 'io', 'no-device-selected')

    expect(localizedErrorMessage(caught, zh)).toBe('没有选择 Android 设备。')
    expect(localizedErrorMessage(caught, en)).toBe('No Android device was selected.')
  })

  it('keeps the raw message for errors that are not meant for the user', () => {
    const caught = new DeviceBackendError('adb command failed')

    expect(deviceErrorCode(caught)).toBeNull()
    expect(localizedErrorMessage(caught, zh)).toBe('adb command failed')
  })

  it('falls back for values that are not errors at all', () => {
    expect(localizedErrorMessage('boom', zh)).toBe('boom')
    expect(localizedErrorMessage(undefined, zh)).toBe('undefined')
  })

  it('covers every code the adapter can raise', () => {
    const codes = [
      'webusb-unavailable',
      'no-device-selected',
      'device-not-connected',
      'invalid-screenshot',
    ] as const

    const messages = codes.map((code) =>
      localizedErrorMessage(new DeviceBackendError('raw', 'io', code), zh),
    )

    // Each code gets its own sentence, and none of them falls through to the
    // untranslated adapter message.
    expect(messages).not.toContain('raw')
    expect(new Set(messages).size).toBe(codes.length)
  })
})

describe('adapter error codes', () => {
  it('tags a corrupt screenshot so the UI can say so in Chinese', () => {
    let caught: unknown
    try {
      parsePngSize(new Uint8Array([1, 2, 3, 4]))
    } catch (error) {
      caught = error
    }

    expect(deviceErrorCode(caught)).toBe('invalid-screenshot')
    expect(localizedErrorMessage(caught, zh)).toBe('截图数据无效，请重试。')
  })
})
