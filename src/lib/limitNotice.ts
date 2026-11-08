/**
 * "You have used up today's attempts" notices.
 *
 * These are invisible to the agent loop as errors: the tap succeeds, the screen
 * just says the account has hit a quota, so a model that keeps tapping burns
 * every remaining step. Only text that appears AFTER an action counts (a help
 * page that mentions the limit is not a limit), and only short lines count (a
 * long policy paragraph is not a toast).
 */
export const LIMIT_NOTICE_MAX_CHARS = 120

/** Compared after whitespace removal and lowercasing, so both scripts match. */
export const LIMIT_NOTICE_WORDS = [
  '次数已用完',
  '次数用完',
  '机会已用完',
  '额度已用完',
  '已达上限',
  '已达到上限',
  '达到上限',
  '超过上限',
  '超出上限',
  '明天再来',
  '明日再来',
  '明天再试',
  '明日再试',
  '操作过于频繁',
  '操作太频繁',
  '操作频繁',
  '请求过于频繁',
  '访问过于频繁',
  'limitreached',
  'reachedthelimit',
  'reachedyourlimit',
  'reachedthedailylimit',
  'reachedyourdailylimit',
  'dailylimit',
  'tryagaintomorrow',
  'comebacktomorrow',
  'toomanyrequests',
  'doingthattoooften',
] as const

/** 「已达到沟通上限」 — a few characters may sit between the verb and 上限. */
const REACHED_UPPER_BOUND = /(已达|达到|超过|超出)[^，,。.!！?？]{0,6}上限/
/** "You've reached today's limit" — the English list cannot cover every wording. */
const REACHED_EN = /(reached|reach|hit|usedup|outof)[^，,。.!！?？]{0,20}(limit|quota)/

function compact(text: string) {
  return text.replace(/\s+/g, '').toLowerCase()
}

export function isLimitNoticeText(text: string) {
  const compacted = compact(text)
  if (!compacted || compacted.length > LIMIT_NOTICE_MAX_CHARS) {
    return false
  }
  return (
    LIMIT_NOTICE_WORDS.some((word) => compacted.includes(word)) ||
    REACHED_UPPER_BOUND.test(compacted) ||
    REACHED_EN.test(compacted)
  )
}

/**
 * The first limit notice that was not on screen before the action.
 *
 * `before` may be null when the previous screen could not be read; then every
 * current line is eligible, which is the only safe reading — refusing to
 * report a notice is worse than reporting one that was already visible.
 */
export function findLimitNotice(
  before: readonly string[] | null,
  after: readonly string[],
): string | null {
  const seen = new Set((before ?? []).map(compact))
  for (const text of after) {
    const compacted = compact(text)
    if (!compacted || seen.has(compacted)) {
      continue
    }
    if (isLimitNoticeText(text)) {
      return text.trim()
    }
  }
  return null
}
