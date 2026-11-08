import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiClientError } from './openAiErrors'
import { withModelRequestTimeout } from './modelRequestTimeout'

afterEach(() => {
  vi.useRealTimers()
})

function waitForAbort(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}

describe('withModelRequestTimeout', () => {
  it('aborts a hung request and reports it as a model error', async () => {
    vi.useFakeTimers()

    const request = withModelRequestTimeout((signal) => waitForAbort(signal), {
      timeoutMs: 1000,
      label: 'OpenAI request',
    })
    const assertion = expect(request).rejects.toThrow(
      'OpenAI request timed out after 1000ms.',
    )

    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('propagates a user abort without turning it into a timeout', async () => {
    const controller = new AbortController()
    const request = withModelRequestTimeout((signal) => waitForAbort(signal), {
      signal: controller.signal,
      timeoutMs: 60_000,
    })

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await expect(request).rejects.not.toBeInstanceOf(OpenAiClientError)
  })

  it('returns the run result and clears the timer', async () => {
    await expect(
      withModelRequestTimeout(async () => 'ok', { timeoutMs: 10 }),
    ).resolves.toBe('ok')
  })
})
