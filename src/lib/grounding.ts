/**
 * Code-only grounding check: every fact in an answer must have been seen.
 *
 * The model reads screens and tool output; the answer it produces must not
 * assert anything nobody ever read. This module is the part of that promise a
 * machine can keep on its own. It does not judge *whether* a value belongs to
 * the thing the answer is talking about (that needs a model); it only asks
 * whether every quoted passage, every unit-bearing number and every date in the
 * answer can be found, literally, somewhere in the evidence.
 *
 * The deliberate limits of the subset, so nobody mistakes it for more:
 *
 * - Both sides are normalised the same way first (NFKC, zero-width characters,
 *   markdown emphasis and backticks, citation markers such as `[1]`/`【2】`,
 *   thousands separators, 万/亿 magnitudes, punctuation runs, whitespace), so
 *   layout differences are not treated as lies — and `1,234`, `1234` and
 *   `1.2 千`-scale spellings compare as the same value.
 * - Comparison is per line. An answer line is never joined with the next one,
 *   and a quote split by `…` must have all of its pieces on the *same* evidence
 *   line; otherwise a claim could be assembled out of unrelated lines.
 * - A number only counts when it appears as a whole token: `7541` is not
 *   grounded by `G7541`, and digits inside an ASCII identifier are not treated
 *   as a numeric value at all.
 * - 1–2 digit integers without a unit are counts, ranks or list numbers and are
 *   never checked. Ordinals (`第3条`, `Top 5`, `#2`, `1.` at line start) are not
 *   values either.
 * - A quote shorter than four characters, or a quote that is a single letter
 *   standing in for a number the answer itself wrote (`「今日 +N」`), carries no
 *   checkable text and is skipped.
 * - Nothing here knows arithmetic, relative dates (`明天`) or the user's
 *   question. It can only report what it could not find; it never turns an
 *   unreadable number into a pass.
 *
 * No model calls, no I/O, no dependencies outside the repo.
 */

export type GroundingViolationKind = 'quote' | 'number' | 'date'

export type GroundingViolation = {
  kind: GroundingViolationKind
  /** The value as the answer wrote it (normalised). */
  value: string
  reason: string
}

export type GroundingResult = {
  ok: boolean
  violations: GroundingViolation[]
  /** Distinct values that were checked (quotes, numbers and dates together). */
  checkedValues: number
}

const DEFAULT_MAX_VIOLATIONS = 12

/** Below this many letters/digits a quote is too short to be a claim (`「是」`). */
const MIN_QUOTE_CHARS = 4

/** Zero-width joiners and BOMs: invisible, so they must not split a match. */
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\uFEFF|\u2060/g
/** Citation markers are pointers, not content: `[1]`, `[^2]`, `【3】`, `@e46`. */
const CITATION = /\[\^?\d{1,3}\]|【\d{1,3}】|@[ev]\d+(?!\d)/g
/** Emphasis and code markers are layout. A single `*` may be a multiplication sign, so it stays. */
const MARKUP = /\*\*|__|~~|`/g
/** `1,234` → `1234`; a comma that is not a thousands separator (1,5) is left alone. */
const THOUSANDS = /(\d),(?=\d{3}(?!\d))/g
/** `5.3万` → `53000`. Only 万/亿: 千 is ambiguous with 千米/千克 and list numbers. */
const MAGNITUDE = /(\d+(?:\.\d+)?)\s*([万亿])/g
/** `！！！` → `！`, `……` → `…`: a run of one punctuation mark is one mark. */
const PUNCTUATION_RUN = /([^\p{L}\p{N}\s])\1+/gu
const WHITESPACE_RUN = /\s+/g

type ScalePower = number

/**
 * Normalise one line for comparison. Applied to the answer and the evidence
 * identically, so neither side gets an advantage out of formatting.
 */
function canonicalise(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(CITATION, ' ')
    .replace(MARKUP, '')
    .replace(THOUSANDS, '$1')
    .replace(MAGNITUDE, (_match, raw: string, unit: string) =>
      scaleDecimal(raw, (unit === '亿' ? 8 : 4) as ScalePower),
    )
    .replace(PUNCTUATION_RUN, '$1')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
}

/** `5.3` × 10^4 → `53000`, in decimal text so no float error creeps in. */
function scaleDecimal(value: string, power: number): string {
  const [rawInteger = '0', rawFraction = ''] = value.split('.')
  const digits = `${rawInteger}${rawFraction}`.replace(/^0+(?=\d)/, '')
  const pointFromRight = rawFraction.length - power
  if (pointFromRight <= 0) {
    return `${digits}${'0'.repeat(-pointFromRight)}`
  }
  const cut = digits.length - pointFromRight
  const integer = (cut > 0 ? digits.slice(0, cut) : '').replace(/^0+(?=\d)/, '') || '0'
  const fraction = digits.slice(Math.max(0, cut)).replace(/0+$/, '')
  return fraction.length > 0 ? `${integer}.${fraction}` : integer
}

/** `1234.50` → `1234.5`, `007` → `7`: the same number spelled the same way. */
function canonicalDecimal(value: string): string {
  const [rawInteger = '0', rawFraction = ''] = value.split('.')
  const integer = rawInteger.replace(/^0+(?=\d)/, '')
  const fraction = rawFraction.replace(/0+$/, '')
  return fraction.length > 0 ? `${integer}.${fraction}` : integer
}

const MATCH_DECIMAL = /\d+(?:\.\d+)+/g
const MATCH_NOISE = /[^\p{L}\p{N}.]/gu

/**
 * Text form used for "is this passage literally there": letters, digits and
 * decimal points, with decimals normalised so `19.9` and `19.90` agree.
 */
function matchForm(value: string): string {
  return canonicalise(value)
    .replace(MATCH_DECIMAL, (decimal: string) => canonicalDecimal(decimal))
    .replace(MATCH_NOISE, '')
}

/* ------------------------------------------------------------------ quotes */

const QUOTED = /「([^」]*)」|『([^』]*)』|“([^”]*)”|"([^"]*)"|‘([^’]*)’/g

function countLettersAndDigits(value: string): number {
  return value.replace(/[^\p{L}\p{N}]/gu, '').length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A quote whose only letters stand in for a number the answer wrote elsewhere
 * (`「今日 +N」` for `今日 +2,271`): it quotes the answer's own spelling, not the
 * screen, so it is not evidence-checkable text.
 */
function isPlaceholderQuote(quote: string, plainBody: string): boolean {
  if (quote.replace(/[^A-Za-z]/g, '').length !== 1) {
    return false
  }
  const pattern = quote
    .trim()
    .split(/\s+/)
    .map((word) => word.split(/[A-Za-z]/).map(escapeRegExp).join('\\d+(?:\\.\\d+)?'))
    .join('\\s*')
  return pattern.length > 0 && new RegExp(pattern).test(plainBody)
}

/** Quoted passages on one line, in the answer's own spelling. */
function quotedPassages(line: string): string[] {
  const passages: string[] = []
  for (const match of line.matchAll(QUOTED)) {
    const raw = match.slice(1).find((group) => group !== undefined && group.length > 0)
    const passage = raw?.trim() ?? ''
    if (countLettersAndDigits(passage) < MIN_QUOTE_CHARS) {
      continue
    }
    passages.push(passage)
  }
  return passages
}

/* ----------------------------------------------------------------- numbers */

/** `(?<!\d)` and `(?<!\d\.)` keep `1.5` from also yielding `5`. */
const NUMBER = /(?<!\d)(?<!\d\.)\d+(?:\.\d+)*(?!\d)/g
const CURRENCY_BEFORE = /[¥$€£]\s*$/
/**
 * A unit right after the number makes it a quantity even when it is short.
 * Counting words (条, 个, 次) are deliberately absent: those are the answer
 * counting things, not a value read off a screen.
 */
const UNIT_AFTER =
  /^\s*(?:%|‰|美元|欧元|日元|港元|英镑|元|块|角|℃|°|度|折|星|公里|千米|厘米|毫米|米|公斤|千克|斤|克|吨|小时|分钟|毫秒|秒|岁|英寸|寸|倍|GB|MB|KB|TB|kg|km|cm|mm|mAh|Hz|ms|[A-Za-z])/u

/**
 * Is the number at `[start, end)` a whole word? `G7541` and `a3f899c` are ids:
 * the digits inside them are not numbers the answer may quote as a quantity.
 * A latin suffix (`128GB`) is a unit and is allowed; another digit after it is
 * not.
 */
function isWholeToken(line: string, start: number, end: number): boolean {
  const before = line[start - 1]
  if (before !== undefined && /[0-9A-Za-z]/.test(before)) {
    return false
  }
  let index = end
  while (index < line.length && /[A-Za-z]/.test(line[index])) {
    index += 1
  }
  const after = line[index]
  return index === end || after === undefined || !/[0-9]/.test(after)
}

/**
 * Numbers in `line` that are values worth checking: decimals, integers of three
 * or more digits, and any number carrying a unit, currency or percent sign.
 */
function numberValues(line: string): string[] {
  const values: string[] = []
  for (const match of line.matchAll(NUMBER)) {
    const start = match.index
    const end = start + match[0].length
    if (!isWholeToken(line, start, end)) {
      continue
    }
    const raw = match[0]
    const after = line.slice(end, end + 8)
    const before = line.slice(Math.max(0, start - 2), start)
    const decimal = raw.includes('.')
    const longInteger = raw.split('.')[0].replace(/^0+(?=\d)/, '').length >= 3
    const unit = UNIT_AFTER.test(after) || CURRENCY_BEFORE.test(before)
    if (decimal || longInteger || unit) {
      values.push(canonicalDecimal(raw))
    }
  }
  return values
}

/**
 * Ordinals are not values: `第3条`, `前5名`, `Top 5`, `No.5`, `#2`, and the
 * `1.` / `2、` list marker in front of a line. Removing them before looking for
 * numbers is what keeps a rank from being read as a quantity.
 */
const ORDINAL =
  /第\s*\d+\s*(?=[条个集页项张篇步名位行章节轮次题])|前\s*\d+\s*(?=[个条名位项篇张])|(?:[Tt][Oo][Pp]|[Nn][Oo]\.)\s*\d+|#\s*\d+|(?:^|\s)\d{1,3}\s*[.、)）](?!\d)/g

/* ------------------------------------------------------------------- dates */

/**
 * Dates and times. A `.` separator is only accepted as year.month.day, so
 * `1561.5` stays a number instead of pretending to be a date.
 */
const DATE =
  /(?<!\d)(?:\d{4}\s*[-/年]\s*\d{1,2}(?:\s*[-/月]\s*\d{1,2}\s*[日号]?)?|\d{4}\.\d{1,2}\.\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/g

const DIGITS = /\d+/g

/** `2026-11-08` → `['2026', '11', '8']`, leading zeros dropped. */
function digitComponents(value: string): string[] {
  return [...value.matchAll(DIGITS)].map((match) => match[0].replace(/^0+(?=\d)/, ''))
}

/** `2026-11-08` may also be matched by `11月8日` on screen: the year is optional. */
function dateVariants(date: string): string[][] {
  const components = digitComponents(date)
  const variants: string[][] = [components]
  if (components.length === 3 && components[0].length === 4) {
    variants.push(components.slice(1))
  }
  return variants
}

function containsWindow(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) {
    return false
  }
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((part, offset) => haystack[index + offset] === part)) {
      return true
    }
  }
  return false
}

/* ------------------------------------------------------------------- check */

/**
 * Check `answer` against the text the agent actually saw.
 *
 * `evidence` is a list of raw reads (a screen dump, a tool result); it is split
 * on newlines so that "per line" means what it says.
 */
export function checkGrounding(
  answer: string,
  evidence: readonly string[],
  options: { maxViolations?: number } = {},
): GroundingResult {
  const maxViolations = Math.max(0, Math.floor(options.maxViolations ?? DEFAULT_MAX_VIOLATIONS))

  // Everything the agent read, one line at a time.
  const evidenceLines = evidence
    .flatMap((entry) => entry.split(/\r?\n/))
    .map(canonicalise)
    .filter((line) => line.length > 0)

  const evidenceNumbers = new Set<string>()
  const evidenceDigitLists: string[][] = []
  const evidenceMatchForms: string[] = []
  for (const line of evidenceLines) {
    const withoutDates = line.replace(DATE, ' ')
    const withoutOrdinals = withoutDates.replace(ORDINAL, ' ')
    for (const value of numberValues(withoutOrdinals)) {
      evidenceNumbers.add(value)
    }
    evidenceDigitLists.push(digitComponents(line))
    evidenceMatchForms.push(matchForm(line))
  }

  const checked = new Set<string>()
  const violations: GroundingViolation[] = []

  const record = (kind: GroundingViolationKind, value: string, found: boolean, reason: string) => {
    const key = `${kind}:${kind === 'quote' ? matchForm(value) : value}`
    if (checked.has(key)) {
      return
    }
    checked.add(key)
    if (!found) {
      violations.push({ kind, value, reason })
    }
  }

  const answerLines = answer.split(/\r?\n/)
  const plainBody = answerLines.map((line) => canonicalise(line.replace(QUOTED, ' '))).join('\n')

  for (const rawLine of answerLines) {
    for (const quote of quotedPassages(rawLine)) {
      if (isPlaceholderQuote(quote, plainBody)) {
        continue
      }
      // `…` elides the middle: every piece must sit on the same evidence line,
      // so an ellipsis cannot splice two unrelated reads into one claim.
      const pieces = quote
        .split(/…+|\.{3,}/)
        .map((piece) => matchForm(piece))
        .filter((piece) => piece.length > 0)
      const found =
        pieces.length > 0 &&
        evidenceMatchForms.some((form) => pieces.every((piece) => form.includes(piece)))
      record('quote', quote, found, `quote ${quote} does not appear in any single evidence line`)
    }

    const line = canonicalise(rawLine)
    if (line.length === 0) {
      continue
    }

    for (const match of line.matchAll(DATE)) {
      const date = match[0].trim()
      const found = dateVariants(date).some((variant) =>
        evidenceDigitLists.some((digits) => containsWindow(digits, variant)),
      )
      record('date', date, found, `date ${date} does not appear in any evidence line`)
    }

    for (const value of numberValues(line.replace(DATE, ' ').replace(ORDINAL, ' '))) {
      record(
        'number',
        value,
        evidenceNumbers.has(value),
        `number ${value} does not appear as a whole token in any evidence line`,
      )
    }
  }

  return {
    ok: violations.length === 0,
    violations: violations.slice(0, maxViolations),
    checkedValues: checked.size,
  }
}
