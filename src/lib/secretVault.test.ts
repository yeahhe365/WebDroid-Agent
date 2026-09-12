import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  decryptSecretValue,
  encryptSecretValues,
  isSecretValueEncrypted,
  type VaultKeyRecord,
} from './secretVault'

const DB_NAME = 'webdroid-agent-vault'
const STORE_NAME = 'keys'
const KEY_ID = 'secret-encryption-key'

function readKeyRecord(): Promise<VaultKeyRecord | undefined> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, 1)
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    openRequest.onsuccess = () => {
      const database = openRequest.result
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const getRequest = transaction.objectStore(STORE_NAME).get(KEY_ID)
      getRequest.onsuccess = () => {
        const record = getRequest.result as VaultKeyRecord | undefined
        database.close()
        resolve(record)
      }
      getRequest.onerror = () => reject(getRequest.error)
    }
    openRequest.onerror = () => reject(openRequest.error)
  })
}

describe('secretVault', () => {
  it('round-trips a secret through encrypt → reload → decrypt', async () => {
    const records = [{ id: 'secret-1', value: 'hunter2' }]

    const encryptedIds = await encryptSecretValues(records)

    expect(encryptedIds).toEqual(['secret-1'])
    expect(isSecretValueEncrypted(records[0].value)).toBe(true)
    expect(records[0].value).not.toContain('hunter2')

    // A later call re-reads the persisted key; it must be the SAME key.
    expect(await decryptSecretValue(records[0].value)).toBe('hunter2')
  })

  it('reuses the persisted key across independent encrypt and decrypt calls', async () => {
    const first = [{ id: 'secret-a', value: 'alpha' }]
    const second = [{ id: 'secret-b', value: 'bravo' }]

    await encryptSecretValues(first)
    await encryptSecretValues(second)

    expect(await decryptSecretValue(first[0].value)).toBe('alpha')
    expect(await decryptSecretValue(second[0].value)).toBe('bravo')
  })

  it('persists a usable AES-GCM key record', async () => {
    const records = [{ id: 'secret-1', value: 'value' }]
    await encryptSecretValues(records)

    const record = await readKeyRecord()
    expect(record).toBeDefined()
    expect(record?.key && typeof record.key === 'object').toBe(true)
    expect(record?.key?.algorithm?.name).toBe('AES-GCM')
    expect(record?.key?.extractable).toBe(false)
  })

  it('passes plaintext values through unchanged', async () => {
    expect(await decryptSecretValue('not-encrypted')).toBe('not-encrypted')
  })

  it('returns an empty string when an encrypted value cannot be decrypted', async () => {
    expect(await decryptSecretValue('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('')
  })

  it('falls back gracefully when Web Crypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      const records = [{ id: 'secret-1', value: 'plain' }]
      expect(await encryptSecretValues(records)).toEqual([])
      expect(records[0].value).toBe('plain')
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
    }
  })
})
