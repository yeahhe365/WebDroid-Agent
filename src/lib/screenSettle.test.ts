import { describe, expect, it } from 'vitest'
import { waitForSettle } from './screenSettle'

type Harness = ReturnType<typeof harness>

function harness(frames: Array<string | null>, options: { startAt?: number } = {}) {
  let clock = options.startAt ?? 0
  const sleeps: number[] = []
  let index = 0
  return {
    sleeps,
    get clock() {
      return clock
    },
    capture: async () => {
      const frame = frames[Math.min(index, frames.length - 1)]
      index += 1
      return frame ?? null
    },
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    },
  }
}

async function settle(harnessed: Harness, minDelayMs = 100, maxWaitMs = 1000) {
  return waitForSettle({
    capture: harnessed.capture,
    minDelayMs,
    maxWaitMs,
    pollMs: 250,
    now: harnessed.now,
    sleep: harnessed.sleep,
  })
}

describe('screen settle', () => {
  it('stops as soon as two reads agree', async () => {
    const harnessed = harness(['a', 'a'])
    const outcome = await settle(harnessed)

    expect(outcome.settled).toBe(true)
    expect(outcome.polls).toBe(1)
  })

  it('keeps polling while the screen is still changing', async () => {
    const harnessed = harness(['a', 'b', 'c', 'c'])
    const outcome = await settle(harnessed)

    expect(outcome.settled).toBe(true)
    expect(outcome.polls).toBe(3)
  })

  it('always waits the configured floor first', async () => {
    const harnessed = harness(['a', 'a'])
    await settle(harnessed)

    expect(harnessed.sleeps[0]).toBe(100)
  })

  it('gives up at the cap instead of polling forever', async () => {
    const frames = Array.from({ length: 40 }, (_, index) => `frame-${index}`)
    const harnessed = harness(frames)
    const outcome = await settle(harnessed)

    expect(outcome.settled).toBe(false)
    expect(outcome.waitedMs).toBeLessThanOrEqual(1000)
  })

  it('falls back to the fixed delay when capture is unavailable', async () => {
    const harnessed = harness([null])
    const outcome = await settle(harnessed)

    expect(outcome.settled).toBe(false)
    expect(outcome.polls).toBe(0)
    expect(harnessed.sleeps).toEqual([100])
  })

  it('treats a capture error as a failed settle, not a crash', async () => {
    const sleep = async () => undefined
    const outcome = await waitForSettle({
      capture: async () => {
        throw new Error('screencap failed')
      },
      minDelayMs: 0,
      maxWaitMs: 100,
      now: () => 0,
      sleep,
    })

    expect(outcome.settled).toBe(false)
  })

  it('does not poll when the budget is only the floor', async () => {
    const harnessed = harness(['a', 'a'])
    const outcome = await settle(harnessed, 200, 200)

    expect(outcome.polls).toBe(0)
    expect(harnessed.sleeps).toEqual([200])
  })
})
