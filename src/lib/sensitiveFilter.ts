/**
 * Gate between free-text memory and storage: an item that contains a credential
 * is refused, everything else is kept.
 *
 * Ported from Mika's Kotlin `SensitiveFilter`, whose doc comment makes the
 * judgement call explicit: a phone number, a home address, a birthday and
 * family terms are *allowed*, because they are the facts that make the
 * assistant useful. Secrets are different in kind -- an API key, an ID card
 * number, a bank card or a one-time code is not a memory, it is a liability.
 *
 * The order of the checks is part of the behaviour. The structured formats run
 * first so a well-formed secret is reported as what it actually is; the keyword
 * rule runs last because it is by far the loosest, and returning the first hit
 * keeps the answer the most specific one.
 */

export type SensitiveCategory = 'api_key' | 'id_number' | 'card_number' | 'password'

/** Shortest value the keyword rules accept as a secret: `abc4` counts, `abc` does not. */
export const MIN_SECRET_CHARS = 4
/** Payment cards run from 12 digits (a few private-label ranges) to 19 (ISO/IEC 7812). */
export const MIN_CARD_DIGITS = 12
export const MAX_CARD_DIGITS = 19
/** A Chinese ID number older than this is almost always a typed example rather than a real one. */
export const MIN_BIRTH_YEAR = 1900

/**
 * Zero-width characters are invisible in the UI but still separate a keyword
 * from its value, so a copy/paste off a web page can hide `验证\u200B码`. They
 * are stripped before any rule looks at the string.
 */
const ZERO_WIDTH = /[\u200B-\u200D\u00AD\u2060\uFEFF]/g
const WHITESPACE_RUN = /\s+/g

function stripInvisible(text: string): string {
  return text.replace(ZERO_WIDTH, '')
}

/**
 * Runs `accept` over every match and stops at the first one it likes.
 *
 * The scanner is cloned from `pattern` on each call on purpose: a module-level
 * regex carrying the `g` flag remembers `lastIndex`, so `pattern.test(text)`
 * would skip matches after the first one and make the filter's answer depend on
 * what it was called with before. Cloning keeps these functions pure.
 */
function hasAcceptedMatch(
  text: string,
  pattern: RegExp,
  accept: (match: string) => boolean,
): boolean {
  const scanner = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`)
  let found = scanner.exec(text)

  while (found !== null) {
    if (found[0].length > 0 && accept(found[0])) {
      return true
    }
    // A zero-length match cannot move the scanner forward by itself.
    if (found[0].length === 0) {
      scanner.lastIndex += 1
    }
    found = scanner.exec(text)
  }

  return false
}

// ---------- api_key ----------

/**
 * Key formats that are recognisable on sight. They are worth matching exactly
 * rather than by "looks random", because a false negative here stores a live
 * credential and a false positive here throws away a harmless note.
 */
const API_KEY_PATTERNS: readonly RegExp[] = [
  // OpenAI-style keys: `sk-` followed by a long body.
  /\bsk-[A-Za-z0-9_-]{16,}/,
  // GitHub: classic tokens share a prefix, fine-grained ones spell it out.
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  // AWS access key IDs: fixed prefix, then 16 uppercase alphanumerics.
  /\bAKIA[0-9A-Z]{16}\b/,
  // Slack bot/user/app tokens.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  // `Authorization: Bearer <token>`.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  // JWT: three base64url segments, always starting with the `{"a…` header.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  // Generic assignment -- `api_key = …`, `token: …`, `secret=…`. The 16-char
  // floor is what keeps prose like "token: expired" out of the result.
  /\b(?:api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_-]{16,}/i,
]

function hasApiKey(text: string): boolean {
  return API_KEY_PATTERNS.some((pattern) => hasAcceptedMatch(text, pattern, () => true))
}

// ---------- id_number ----------

/**
 * Second-generation resident ID: 17 digits plus a check digit. The lookarounds
 * keep it from matching a slice of a longer digit run (a card number, a
 * tracking number).
 */
const ID_NUMBER = /(?<!\d)[1-9]\d{16}[\dXx](?![\dA-Za-z])/
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CHECK_CHARS = '10X98765432'

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** Digits 7-14 encode the birth date; a number with 1899 or February 30 in it was made up. */
function hasRealBirthDate(id: string): boolean {
  const year = Number(id.slice(6, 10))
  const month = Number(id.slice(10, 12))
  const day = Number(id.slice(12, 14))

  if (year < MIN_BIRTH_YEAR || month < 1 || month > 12 || day < 1) {
    return false
  }
  return day <= daysInMonth(year, month)
}

/** ISO 7064 MOD 11-2: the 18th character is a checksum over the first 17. */
function hasValidIdChecksum(id: string): boolean {
  let sum = 0
  for (let index = 0; index < ID_WEIGHTS.length; index += 1) {
    sum += (id.charCodeAt(index) - 48) * ID_WEIGHTS[index]
  }
  return id.charAt(17).toUpperCase() === ID_CHECK_CHARS.charAt(sum % 11)
}

/**
 * Checking the checksum means an arbitrary 18-digit number is not reported as
 * an ID just because it is 18 digits long -- a timestamp plus a counter is not
 * someone's identity.
 */
function isValidIdNumber(candidate: string): boolean {
  return hasRealBirthDate(candidate) && hasValidIdChecksum(candidate)
}

// ---------- card_number ----------

/**
 * A card is often written in groups, so a single space or hyphen may sit
 * between digits. The lookarounds keep the run from being a slice of a longer
 * number (which is how a 19-digit card would otherwise be read as 18).
 */
const CARD_LIKE = /(?<!\d)\d(?:[ -]?\d){11,18}(?!\d)/

/** Luhn: double every second digit from the right, subtract 9 when it overflows, sum must be a multiple of 10. */
function luhnValid(digits: string): boolean {
  if (digits.length < MIN_CARD_DIGITS || digits.length > MAX_CARD_DIGITS) {
    return false
  }

  let sum = 0
  for (let offset = 0; offset < digits.length; offset += 1) {
    let value = digits.charCodeAt(digits.length - 1 - offset) - 48
    if (offset % 2 === 1) {
      value *= 2
      if (value > 9) {
        value -= 9
      }
    }
    sum += value
  }

  return sum % 10 === 0
}

function hasCardNumber(text: string): boolean {
  return hasAcceptedMatch(text, CARD_LIKE, (match) => luhnValid(match.replace(/[^0-9]/g, '')))
}

// ---------- password ----------

/**
 * Words that introduce a secret. The Chinese ones need no boundary; the
 * English ones do, or `passwordless` and `passcodes` would both match.
 */
const PASSWORD_KEYWORDS =
  '支付密码|密码|口令|验证码|校验码|动态码|安全码|安全问题|' +
  '(?<![A-Za-z])(?:password|passcode|passwd|cvv|cvc|one-time code|verification code|security code|security question)(?![A-Za-z])'

/**
 * What may sit between the keyword and its value: punctuation, a copula, at
 * most a handful of characters. Anything longer means the value belongs to the
 * rest of the sentence instead -- that is what keeps "会上报了 3 个问题" out.
 * `码` is in the set because "PIN码是4829" is how the noun is written in
 * Chinese: dropping those notes would leak the code the word was asking for.
 */
const GAP = '[\\s:：=,，是为叫码]{0,4}(?:(?:is|was|are)\\s+)?'

/** `123456 是我的密码`: the value first, the keyword after it, which Chinese writes just as often. */
const OWNER = '\\s*(?:就是|是|为)(?:我的|我|用户的)?\\s*'

const PASSWORD_RULES: readonly RegExp[] = [
  new RegExp(`${PASSWORD_KEYWORDS}${GAP}[A-Za-z0-9]{${MIN_SECRET_CHARS},}`, 'i'),
  new RegExp(`(?<![A-Za-z0-9])[A-Za-z0-9]{${MIN_SECRET_CHARS},}${OWNER}${PASSWORD_KEYWORDS}`, 'i'),
]

/**
 * `pin` and `otp` are three ordinary letters buried inside "pinned", "hotpot"
 * and "pinot", so on their own they prove nothing: they only count when a 4+
 * digit code follows them.
 */
const SHORT_CODE_RULES: readonly RegExp[] = [
  new RegExp(`(?<![A-Za-z])(?:pin|otp)(?![A-Za-z])${GAP}[0-9]{${MIN_SECRET_CHARS},}`, 'i'),
]

const KEYWORD_RULES: readonly RegExp[] = [...PASSWORD_RULES, ...SHORT_CODE_RULES]

function hasKeywordSecret(text: string): boolean {
  return KEYWORD_RULES.some((rule) => hasAcceptedMatch(text, rule, () => true))
}

// ---------- entry points ----------

/**
 * Category of the secret found in `text`, or null when the text is safe to
 * store.
 *
 * NFKC first, so full-width digits and letters (`１２３`, `ＡＫＩＡ`) are seen
 * for what they are instead of slipping past ASCII-only patterns.
 */
export function sensitiveCategory(text: string): SensitiveCategory | null {
  const normalised = stripInvisible(text.normalize('NFKC'))
  // `验证码 1 2 3 4` is one code; the spacing is how people dictate it, not a
  // separator between four unrelated numbers, so the keyword rules also see a
  // whitespace-free copy.
  const compact = normalised.replace(WHITESPACE_RUN, '')

  if (hasApiKey(normalised)) {
    return 'api_key'
  }
  if (hasAcceptedMatch(normalised, ID_NUMBER, isValidIdNumber)) {
    return 'id_number'
  }
  if (hasCardNumber(normalised)) {
    return 'card_number'
  }
  if (hasKeywordSecret(normalised) || hasKeywordSecret(compact)) {
    return 'password'
  }

  return null
}

export function containsSensitiveData(text: string): boolean {
  return sensitiveCategory(text) !== null
}
