export const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME'
/**
 * Pinned to a commit, not `master`: the APK is installed on the user's phone,
 * so an upstream push must not silently change what we download. Keep the
 * checksum in sync with the URL after any intentional upgrade.
 */
export const ADB_KEYBOARD_APK_URL =
  'https://raw.githubusercontent.com/senzhk/ADBKeyBoard/8dd0b6924e45ac5565f77f13cf8e8eaf47dbb1b0/ADBKeyboard.apk'
export const ADB_KEYBOARD_APK_SHA256 =
  'e698adea5633135a067b038f9a0cf41baa4de09888713a81593fb2b9682cdc59'
export const ADB_KEYBOARD_APK_MAX_BYTES = 10 * 1024 * 1024
export const ADB_KEYBOARD_REMOTE_APK_PATH = '/data/local/tmp/webdroid-adbkeyboard.apk'

/**
 * Refuse to install an APK that does not match the pinned digest. The source
 * is a third-party GitHub repository, so a compromised branch or a network
 * substitution must not be able to run code on the device.
 */
export async function assertAdbKeyboardApk(
  bytes: Uint8Array,
  expectedSha256: string = ADB_KEYBOARD_APK_SHA256,
) {
  if (bytes.byteLength === 0) {
    throw new Error('Downloaded ADB Keyboard APK is empty.')
  }
  if (bytes.byteLength > ADB_KEYBOARD_APK_MAX_BYTES) {
    throw new Error(
      `ADB Keyboard APK is larger than ${ADB_KEYBOARD_APK_MAX_BYTES} bytes; refusing to install.`,
    )
  }

  const actualSha256 = await adbKeyboardApkSha256(bytes)
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `ADB Keyboard APK checksum mismatch (expected ${expectedSha256}, got ${actualSha256}). Refusing to install.`,
    )
  }
}

export async function adbKeyboardApkSha256(bytes: Uint8Array) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error(
      'This browser cannot verify the ADB Keyboard APK (Web Crypto is unavailable).',
    )
  }

  // Copy into a plain ArrayBuffer-backed view; the source may be a view over
  // a SharedArrayBuffer, which Web Crypto does not accept.
  const payload = new Uint8Array(bytes.byteLength)
  payload.set(bytes)
  const digest = await subtle.digest('SHA-256', payload)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function escapeInputText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\s/g, '%s')
}

export function isAndroidInputTextSafe(text: string) {
  return /^[A-Za-z0-9 .,@_:+\\/-]+$/.test(text)
}

export function isAdbKeyboardInstalled(imeListOutput: string) {
  return findAdbKeyboardIme(imeListOutput) !== null
}

export function findAdbKeyboardIme(imeListOutput: string) {
  const imes = imeListOutput.split(/\s+/).map(normalizeImeListItem).filter(Boolean)
  const exact = imes.find((ime) => ime === ADB_KEYBOARD_IME)
  if (exact) {
    return exact
  }

  return (
    imes.find((ime) => {
      const lower = ime.toLowerCase()
      return lower.includes('autoglm') || lower.includes('adbkeyboard') || lower.endsWith('/.adbime')
    }) ?? null
  )
}

export function encodeAdbKeyboardText(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function normalizeImeListItem(value: string) {
  return value.replace(/^ime:/, '').trim()
}
