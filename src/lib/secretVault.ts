/**
 * Lightweight at-rest encryption for sensitive values stored in localStorage.
 *
 * Browser localStorage is fully readable by any XSS payload running in the same
 * origin, so this is NOT a strong boundary — a determined attacker with script
 * execution can still recover the values by reading back the key material that
 * this module itself persists. The goal here is defense-in-depth: make secrets
 * opaque in casual inspection of localStorage / IndexedDB exports, and ensure a
 * single static string dump does not immediately reveal secret values.
 *
 * Encryption uses Web Crypto AES-GCM with a per-installation key stored in
 * IndexedDB (which is at least not surfaced in DevTools "Application > Local
 * Storage" the way plain strings are).
 */

const DB_NAME = 'webdroid-agent-vault'
const STORE_NAME = 'keys'
const KEY_RECORD_ID = 'secret-encryption-key'

export type VaultStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type VaultCrypto = {
  randomUUID(): string
  getRandomValues<T extends ArrayBufferView | null>(array: T): T
  subtle: {
    encrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>
    decrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>
    importKey(
      format: 'raw',
      keyData: BufferSource,
      algorithm: AesKeyAlgorithm,
      extractable: boolean,
      keyUsages: readonly KeyUsage[],
    ): Promise<CryptoKey>
    generateKey(
      algorithm: AesKeyGenParams,
      extractable: boolean,
      keyUsages: readonly KeyUsage[],
    ): Promise<CryptoKey>
  }
}

export type VaultIndexedDB = {
  open(name: string, version?: number): IDBOpenDBRequest
}

/**
 * Shape of the persisted key record. The current implementation stores a
 * non-extractable `CryptoKey` (structured clone); `raw` is kept for
 * compatibility with older records that stored raw key bytes.
 */
export type VaultKeyRecord = {
  id: string
  key?: CryptoKey
  raw?: ArrayBuffer
}

const ENCRYPTED_PREFIX = 'enc:v1:'

function isCryptoAvailable(crypto: VaultCrypto | undefined): crypto is VaultCrypto {
  return Boolean(
    crypto &&
      typeof crypto.subtle === 'object' &&
      crypto.subtle !== null &&
      typeof crypto.subtle.importKey === 'function' &&
      typeof crypto.subtle.encrypt === 'function',
  )
}

function getVaultCrypto(): VaultCrypto | undefined {
  const cryptoRef = (globalThis as { crypto?: VaultCrypto }).crypto
  return isCryptoAvailable(cryptoRef) ? cryptoRef : undefined
}

function openKeyStore(indexedDb: VaultIndexedDB): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let database: IDBDatabase | null = null
    try {
      const request = indexedDb.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => {
        database = request.result
        resolve(database)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(database)
    }
  })
}

function readKeyRecord(database: IDBDatabase): Promise<VaultKeyRecord | null> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(KEY_RECORD_ID)
      request.onsuccess = () =>
        resolve((request.result as VaultKeyRecord | undefined) ?? null)
      request.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function writeKeyRecord(database: IDBDatabase, record: VaultKeyRecord): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record)
      // Resolve only after the write commits, so later reads (possibly on a new
      // connection) observe the same key.
      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => resolve(false)
      transaction.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

async function loadOrCreateKey(
  indexedDb: VaultIndexedDB | undefined,
  crypto: VaultCrypto,
): Promise<CryptoKey | null> {
  if (!indexedDb) {
    return null
  }
  const database = await openKeyStore(indexedDb)
  if (!database) {
    return null
  }

  try {
    const existing = await readKeyRecord(database)
    // Preferred path: the key is stored as a non-extractable CryptoKey object
    // (structured clone). Reusing it keeps previously encrypted values
    // decryptable.
    if (existing?.key) {
      return existing.key
    }
    // Legacy path: older records may hold the raw key bytes.
    if (existing?.raw) {
      try {
        return await crypto.subtle.importKey(
          'raw',
          existing.raw,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        )
      } catch {
        // fall through to generate a new key
      }
    }

    const newKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    // CryptoKey is non-extractable, so we cannot store the raw bytes.
    // Instead store the key object itself via structured clone.
    await writeKeyRecord(database, { id: KEY_RECORD_ID, key: newKey })
    return newKey
  } catch {
    return null
  } finally {
    database.close()
  }
}

async function encryptValue(crypto: VaultCrypto, key: CryptoKey, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(value)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )
  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipherBuffer), iv.length)
  return `${ENCRYPTED_PREFIX}${base64Encode(combined)}`
}

async function decryptValue(crypto: VaultCrypto, key: CryptoKey, value: string): Promise<string> {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return value
  }
  const combined = base64Decode(value.slice(ENCRYPTED_PREFIX.length))
  const iv = combined.slice(0, 12)
  const cipher = combined.slice(12)
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher,
  )
  return new TextDecoder().decode(plainBuffer)
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Encrypt every `value` field on the secret records in place, returning the
 * list of ids that were encrypted. Falls back to returning the records
 * unchanged when Web Crypto / IndexedDB is unavailable (e.g. insecure context).
 */
export async function encryptSecretValues(
  records: ReadonlyArray<{ id: string; value: string }>,
): Promise<string[]> {
  const crypto = getVaultCrypto()
  if (!crypto) {
    return []
  }
  const indexedDb = (globalThis as { indexedDB?: VaultIndexedDB }).indexedDB
  const key = await loadOrCreateKey(indexedDb, crypto)
  if (!key) {
    return []
  }
  const encryptedIds: string[] = []
  for (const record of records) {
    if (!record.value || record.value.startsWith(ENCRYPTED_PREFIX)) {
      continue
    }
    try {
      record.value = await encryptValue(crypto, key, record.value)
      encryptedIds.push(record.id)
    } catch {
      // leave value in plaintext if encryption fails; better to keep working
    }
  }
  return encryptedIds
}

/**
 * Decrypt any value that was previously encrypted by `encryptSecretValues`.
 * Plaintext values are returned unchanged for backward compatibility.
 */
export async function decryptSecretValue(value: string): Promise<string> {
  const crypto = getVaultCrypto()
  if (!crypto || !value.startsWith(ENCRYPTED_PREFIX)) {
    return value
  }
  const indexedDb = (globalThis as { indexedDB?: VaultIndexedDB }).indexedDB
  const key = await loadOrCreateKey(indexedDb, crypto)
  if (!key) {
    return ''
  }
  try {
    return await decryptValue(crypto, key, value)
  } catch {
    return ''
  }
}

export function isSecretValueEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}
