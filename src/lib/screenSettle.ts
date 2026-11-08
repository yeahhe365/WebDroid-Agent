/**
 * Waiting for the screen to stop moving, instead of always sleeping for the
 * configured settle delay.
 *
 * A fixed 1000 ms wait is simultaneously too long for a static list (every
 * action pays a second) and too short for a page that takes two seconds to
 * render, where the next step reads a half-drawn screen and acts on stale
 * coordinates. This polls a cheap token for the current picture and stops as
 * soon as two consecutive reads match, bounded by the configured budget.
 */
export type SettleOutcome = {
  settled: boolean
  polls: number
  waitedMs: number
}

export type SettleOptions = {
  /** A token that changes when the picture changes; null when capture is unavailable. */
  capture: () => Promise<string | null>
  /** Smallest total wait, so a fast read cannot skip the app's own animation start. */
  minDelayMs: number
  /** Hard cap on the extra polling. */
  maxWaitMs: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const DEFAULT_SETTLE_POLL_MS = 250
/** Keeps a clock that does not advance (a fake timer in tests) from looping. */
const MAX_POLLS = 24

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForSettle({
  capture,
  minDelayMs,
  maxWaitMs,
  pollMs = DEFAULT_SETTLE_POLL_MS,
  now = () => Date.now(),
  sleep = defaultSleep,
}: SettleOptions): Promise<SettleOutcome> {
  const startedAt = now()
  const floor = Math.max(0, minDelayMs)
  const cap = Math.max(floor, maxWaitMs)
  if (floor > 0) {
    await sleep(floor)
  }

  let baseline: string | null
  try {
    baseline = await capture()
  } catch {
    baseline = null
  }
  if (baseline === null) {
    // No picture to compare: keep the old fixed-delay behaviour rather than
    // pretending the screen settled.
    return { settled: false, polls: 0, waitedMs: now() - startedAt }
  }

  let polls = 0
  let previous = baseline
  // Check the remaining budget before sleeping, so the cap is not overshot by
  // one whole poll interval.
  while (polls < MAX_POLLS && now() - startedAt + pollMs <= cap) {
    await sleep(pollMs)
    polls += 1
    let current: string | null
    try {
      current = await capture()
    } catch {
      current = null
    }
    if (current === null) {
      return { settled: false, polls, waitedMs: now() - startedAt }
    }
    if (current === previous) {
      return { settled: true, polls, waitedMs: now() - startedAt }
    }
    previous = current
  }

  return { settled: false, polls, waitedMs: now() - startedAt }
}
