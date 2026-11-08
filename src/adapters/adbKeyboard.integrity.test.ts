import { describe, expect, it } from 'vitest'
import {
  ADB_KEYBOARD_APK_MAX_BYTES,
  ADB_KEYBOARD_APK_SHA256,
  ADB_KEYBOARD_APK_URL,
  adbKeyboardApkSha256,
  assertAdbKeyboardApk,
} from './adbKeyboard'

// sha256([0x50, 0x4b, 0x03, 0x04]) — a tiny local payload for the verifier.
const TEST_BYTES = new Uint8Array([80, 75, 3, 4])
const TEST_SHA256 = '8dcc7e601606217f3b754766511182a916b17e9a26a94c9d887104eba92e9bb2'

describe('ADB Keyboard APK integrity', () => {
  it('accepts a payload that matches the expected digest', async () => {
    expect(await adbKeyboardApkSha256(TEST_BYTES)).toBe(TEST_SHA256)
    await expect(assertAdbKeyboardApk(TEST_BYTES, TEST_SHA256)).resolves.toBeUndefined()
  })

  it('rejects a payload that does not match the pinned digest', async () => {
    await expect(assertAdbKeyboardApk(TEST_BYTES)).rejects.toThrow('checksum mismatch')
  })

  it('rejects empty and oversized payloads before hashing', async () => {
    await expect(assertAdbKeyboardApk(new Uint8Array())).rejects.toThrow('empty')
    await expect(
      assertAdbKeyboardApk(new Uint8Array(ADB_KEYBOARD_APK_MAX_BYTES + 1), TEST_SHA256),
    ).rejects.toThrow('larger than')
  })

  it('pins the download to a commit and a full SHA-256 digest', () => {
    expect(ADB_KEYBOARD_APK_URL).not.toContain('/master/')
    expect(ADB_KEYBOARD_APK_URL).toContain('8dd0b6924e45ac5565f77f13cf8e8eaf47dbb1b0')
    expect(ADB_KEYBOARD_APK_SHA256).toMatch(/^[a-f0-9]{64}$/)
  })
})
