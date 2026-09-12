import { describe, expect, it } from 'vitest'
import { DeviceBackendError } from './deviceTypes'
import { retryDeviceOperation, withTimeout } from './deviceRetry'

describe('withTimeout', () => {
  it('resolves when the operation settles in time', async () => {
    await expect(withTimeout(async () => 'ok', 50, 'test')).resolves.toBe('ok')
  })

  it('rejects with a DeviceBackendError when the operation never settles', async () => {
    await expect(withTimeout(() => new Promise<never>(() => {}), 10, 'screenshot')).rejects.toThrow(
      /screenshot timed out after 10ms/,
    )
  })

  it('propagates the underlying failure unchanged', async () => {
    const error = new Error('boom')
    await expect(
      withTimeout(async () => {
        throw error
      }, 50, 'test'),
    ).rejects.toBe(error)
  })
})

describe('retryDeviceOperation timeouts', () => {
  it('retries a hung attempt instead of blocking forever', async () => {
    let attempts = 0
    const result = await retryDeviceOperation(
      () => {
        attempts += 1
        return attempts < 3 ? new Promise<never>(() => {}) : Promise.resolve('ok')
      },
      { label: 'screen tree', timeoutMs: 10, retryDelaysMs: [0], wait: async () => {} },
    )

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('fails with a DeviceBackendError that mentions the timeout', async () => {
    await expect(
      retryDeviceOperation(() => new Promise<never>(() => {}), {
        label: 'device state',
        timeoutMs: 5,
        maxAttempts: 2,
        retryDelaysMs: [0],
        wait: async () => {},
      }),
    ).rejects.toThrow(DeviceBackendError)
  })

  it('leaves retry behaviour unchanged when the timeout is disabled', async () => {
    let attempts = 0
    const result = await retryDeviceOperation(
      async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('flaky')
        }
        return 'ok'
      },
      { label: 'screenshot', timeoutMs: 0, retryDelaysMs: [0], wait: async () => {} },
    )

    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })
})
