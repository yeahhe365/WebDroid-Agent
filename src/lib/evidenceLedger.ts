/**
 * The evidence ledger: everything the agent actually read during a run.
 *
 * A final answer is only as trustworthy as the material behind it, so the run
 * keeps a ledger of reads — screens, the foreground app, tool results, and what
 * the user typed — and the grounding check (see `grounding.ts`) is run against
 * *these* entries, never against the model's memory of them. One ledger, one
 * selection rule: the runtime checker and an offline replay of the same run see
 * the same evidence.
 *
 * Storage rules, ported from the Kotlin original
 * (`core/verify/EvidenceLedger.kt`):
 *
 * - each entry is normalised (NFKC, no zero-width characters, no trailing
 *   spaces on a line) and clipped to a budget that depends on where it came
 *   from: a screen or user utterance is generous, a tool result keeps its head
 *   and its tail because the interesting line is often the last one;
 * - an entry that is blank after normalisation is not recorded at all;
 * - the same text recorded again *replaces* the earlier entry, so the ledger
 *   keeps the newest id and the newest provenance (step, app) without growing;
 * - the total length is capped, and the oldest entries are dropped first. This
 *   is a memory safety valve; a normal run never reaches it.
 *
 * Selection ([selectForAnswer]) is deliberately generous in one direction only:
 * it decides what to *show*, never what counts as grounded. An entry that was
 * not read is not in the ledger, so no amount of selecting can prove it.
 */

import { truncateRetainedText } from './textRetention'

export type EvidenceKind = 'screen' | 'app' | 'tool_result' | 'user'

export type EvidenceEntry = {
  /** 1-based, increasing; the newest entry always has the highest id. */
  id: number
  kind: EvidenceKind
  /** Text as recorded: normalised and clipped to the kind's budget. */
  text: string
  /** Foreground app or site the read came from, when known. */
  app?: string
  /** Agent step the entry was read at. */
  step: number
}

/** Total characters kept across all entries. */
const DEFAULT_CAP_CHARS = 400_000

/** How many characters each kind may keep. */
const CLIP_CHARS: Record<EvidenceKind, number> = {
  screen: 6_000,
  app: 2_000,
  tool_result: 4_000,
  user: 2_000,
}

/** Marker between the head and the tail kept from a long tool result. */
const TOOL_RESULT_GAP = '\n…(middle truncated)…\n'

/** Entries returned by default from [EvidenceLedger.selectForAnswer]. */
const DEFAULT_SELECT_LIMIT = 12

/** The most recent entries always selected, whatever the answer mentions. */
const RECENT_FOR_ANSWER = 2

const ZERO_WIDTH = /\u200B|\u200C|\u200D|\uFEFF|\u2060/g
const TRAILING_SPACE = /[ \t]+$/gm
const THOUSANDS = /(\d),(?=\d{3}(?!\d))/g
const MAGNITUDE = /(\d+(?:\.\d+)?)\s*([万亿])/g
const QUOTED = /「([^」]*)」|『([^』]*)』|“([^”]*)”|"([^"]*)"|‘([^’]*)’/g
const NUMBERISH = /\d[\d,]*(?:\.\d+)?\s*[万亿]?/g
const IDENTIFIER = /[A-Za-z][A-Za-z0-9_.-]{2,}/g
const MATCH_NOISE = /[^\p{L}\p{N}.]/gu

/** Runs of spaces/tabs collapse to one space: line structure is kept, spacing is not. */
const SPACE_RUN = /[ \t]+/g

/**
 * Store form: one newline per line, no invisible characters, one space between
 * words, no ragged ends. Two reads of the same screen then look the same, which
 * is what makes the dedupe rule below reliable.
 */
function normaliseText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(TRAILING_SPACE, '')
    .replace(SPACE_RUN, ' ')
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

/**
 * Form used to decide whether an entry shares a value with the answer:
 * letters, digits and decimal points only, with thousands separators removed
 * and 万/亿 folded, so `1,561万` and `15610000` are the same value.
 */
function compactForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(THOUSANDS, '$1')
    .replace(MAGNITUDE, (_match, raw: string, unit: string) => scaleDecimal(raw, unit === '亿' ? 8 : 4))
    .replace(MATCH_NOISE, '')
}

/** Clip one entry to its own budget; tool results keep both ends. */
function clipForKind(kind: EvidenceKind, text: string): string {
  const cap = CLIP_CHARS[kind]
  if (text.length <= cap) {
    return text
  }
  if (kind !== 'tool_result') {
    return truncateRetainedText(text, cap)
  }
  const head = Math.floor((cap * 3) / 4)
  const tail = Math.max(0, cap - head - TOOL_RESULT_GAP.length)
  return `${text.slice(0, head)}${TOOL_RESULT_GAP}${text.slice(text.length - tail)}`
}

/**
 * Values the answer asserts, used to find the entries that could support it:
 * quoted passages, numbers (folded so `1,561万` matches `15610000`) and ASCII
 * identifiers such as package names or SKUs.
 */
function answerProbes(answer: string): string[] {
  const text = normaliseText(answer)
  const probes = new Set<string>()

  for (const match of text.matchAll(QUOTED)) {
    const raw = match.slice(1).find((group) => group !== undefined && group.length > 0)
    const compact = raw === undefined ? '' : compactForMatch(raw)
    if (compact.length >= 2) {
      probes.add(compact)
    }
  }

  for (const match of text.matchAll(NUMBERISH)) {
    const compact = compactForMatch(match[0])
    if (compact.length >= 2) {
      probes.add(compact)
    }
  }

  for (const match of text.matchAll(IDENTIFIER)) {
    const compact = compactForMatch(match[0])
    if (compact.length >= 3) {
      probes.add(compact)
    }
  }

  return [...probes]
}

export class EvidenceLedger {
  private readonly capChars: number
  private readonly items: EvidenceEntry[] = []
  private nextId = 1
  private totalChars = 0

  constructor(options: { capChars?: number } = {}) {
    this.capChars = Math.max(1, Math.floor(options.capChars ?? DEFAULT_CAP_CHARS))
  }

  /**
   * Record one read. Returns the stored entry (with its id), or `null` when the
   * text is blank after normalisation and there is nothing to keep.
   */
  add(entry: { kind: EvidenceKind; text: string; app?: string; step: number }): EvidenceEntry | null {
    const text = clipForKind(entry.kind, normaliseText(entry.text))
    if (text.length === 0) {
      return null
    }

    const app = entry.app === undefined ? undefined : entry.app.trim()
    const stored: EvidenceEntry =
      app === undefined || app.length === 0
        ? { id: this.nextId, kind: entry.kind, text, step: entry.step }
        : { id: this.nextId, kind: entry.kind, text, app, step: entry.step }
    this.nextId += 1

    // The same text read again replaces the earlier entry: the newest id and
    // the newest provenance win, and the ledger does not grow.
    const existing = this.items.findIndex((item) => item.text === text)
    if (existing >= 0) {
      this.totalChars -= this.items[existing].text.length
      this.items.splice(existing, 1)
    }

    this.items.push(stored)
    this.totalChars += text.length

    while (this.totalChars > this.capChars && this.items.length > 1) {
      const dropped = this.items.shift()
      if (dropped === undefined) {
        break
      }
      this.totalChars -= dropped.text.length
    }

    return { ...stored }
  }

  /** Entries in read order. A copy: callers cannot rewrite the ledger. */
  get entries(): readonly EvidenceEntry[] {
    return this.items.map((item) => ({ ...item }))
  }

  get isEmpty(): boolean {
    return this.items.length === 0
  }

  /**
   * Entries that could support `answer`: those sharing a value with it, plus
   * the most recent reads (later reads may contradict the answer, so they are
   * always in view). Returned in read order.
   *
   * `limit` caps how many are shown. When there are too many, entries that
   * share a value win over merely recent ones; within each group the newest
   * come first. Selection never decides what counts as grounded — it only
   * decides what gets looked at.
   */
  selectForAnswer(answer: string, options: { limit?: number } = {}): EvidenceEntry[] {
    const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_SELECT_LIMIT))
    if (limit === 0 || this.items.length === 0) {
      return []
    }

    const probes = answerProbes(answer)
    const compacted = this.items.map((item) => compactForMatch(item.text))
    const supporting = new Set<number>()
    if (probes.length > 0) {
      compacted.forEach((text, index) => {
        if (probes.some((probe) => text.includes(probe))) {
          supporting.add(index)
        }
      })
    }

    const chosen = new Set<number>(supporting)
    const recentStart = Math.max(0, this.items.length - RECENT_FOR_ANSWER)
    for (let index = recentStart; index < this.items.length; index += 1) {
      chosen.add(index)
    }

    const ranked = [...chosen]
      .sort((left, right) => {
        const leftRank = supporting.has(left) ? 1 : 0
        const rightRank = supporting.has(right) ? 1 : 0
        if (leftRank !== rightRank) {
          return rightRank - leftRank
        }
        return right - left
      })
      .slice(0, limit)

    return ranked.sort((left, right) => left - right).map((index) => ({ ...this.items[index] }))
  }
}
