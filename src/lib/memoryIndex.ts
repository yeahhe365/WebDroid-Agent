/**
 * Lexical retrieval for the locally stored memory items.
 *
 * The prompt used to carry every remembered item, which grows without bound in
 * size and dilutes the model's attention. This module scores the stored items
 * against the current request and hands back only the relevant ones; when
 * nothing is relevant the caller keeps its recency-based fallback.
 *
 * Ported from the Kotlin `MemoryIndex` in Mika: same tokenizer, same BM25 shape
 * (k1 = 1.2, b = 0.75), same relevance gate. The two adaptations needed by a
 * plain-string API are documented where they happen.
 */

/** BM25 term-frequency saturation. */
export const BM25_K1 = 1.2

/** BM25 length normalisation. */
export const BM25_B = 0.75

/**
 * IDF is smoothed as if the corpus held at least this many items. A real store
 * holds a handful of items, and without the floor a term present everywhere
 * would still look maximally rare against a two-item corpus.
 */
export const MIN_CORPUS = 50

/**
 * A term that also appears in the query counts double, mirroring the reference,
 * where memory keywords (the curated "this item is about X" terms) count twice
 * against the item body. `selectMemoryItems` only receives plain strings, so
 * there are no separate keywords to weight: the match itself carries the boost.
 */
export const MATCHED_TERM_WEIGHT = 2

/** How many items a caller gets when it does not ask for a count. */
export const DEFAULT_MEMORY_LIMIT = 5

/** How much item text a caller gets when it does not ask for a budget. */
export const DEFAULT_MEMORY_MAX_CHARS = 2000

const HAN_CHARACTER = /^\p{Script=Han}$/u
const ASCII_WORD_CHARACTER = /^[A-Za-z0-9]$/

function isHanCharacter(character: string): boolean {
  return HAN_CHARACTER.test(character)
}

/** True for the single-character CJK terms that may score but must not gate. */
function isSingleCharacterHanTerm(term: string): boolean {
  return term.length === 1 && isHanCharacter(term)
}

/**
 * Lexical terms used for matching: CJK runs become overlapping bigrams (single character when the run is one char), ASCII words are lowercased.
 *
 * A CJK run is a maximal stretch of Han characters; `withUnigrams` also emits
 * every character of such a run, which is how a one-character query such as
 * 「辣」 reaches a longer run.
 */
export function memoryTerms(text: string, options: { withUnigrams?: boolean } = {}): string[] {
  const withUnigrams = options.withUnigrams === true
  const terms: string[] = []
  let run: string[] = []
  let word = ''

  const flushWord = (): void => {
    if (word) {
      terms.push(word.toLowerCase())
      word = ''
    }
  }
  const flushRun = (): void => {
    if (run.length === 1) {
      terms.push(run[0])
    } else if (run.length > 1) {
      for (let index = 0; index < run.length - 1; index += 1) {
        terms.push(run[index] + run[index + 1])
      }
      if (withUnigrams) {
        terms.push(...run)
      }
    }
    run = []
  }

  // Iterating by code point keeps astral Han characters intact; the reference
  // walks UTF-16 units, where they would split the run into lone surrogates.
  for (const character of text) {
    if (isHanCharacter(character)) {
      flushWord()
      run.push(character)
      continue
    }
    flushRun()
    if (ASCII_WORD_CHARACTER.test(character)) {
      word += character
      continue
    }
    flushWord()
  }
  flushRun()
  flushWord()

  return terms
}

type IndexedItem = {
  readonly termCounts: ReadonlyMap<string, number>
  readonly length: number
}

/**
 * Query terms in first-seen order, without duplicates.
 *
 * Items are indexed with unigrams as well as bigrams: the reference stores
 * curated keywords next to the body, and those keywords are where a
 * one-character query finds an item. With plain strings there are no keywords,
 * so the item's own characters take that role.
 */
function queryTerms(query: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const term of memoryTerms(query, { withUnigrams: true })) {
    if (seen.has(term)) {
      continue
    }
    seen.add(term)
    terms.push(term)
  }
  return terms
}

function indexItem(item: string): IndexedItem {
  const termCounts = new Map<string, number>()
  let length = 0
  for (const term of memoryTerms(item, { withUnigrams: true })) {
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1)
    length += 1
  }
  return { termCounts, length }
}

/**
 * Relevance gate, mirroring the reference.
 *
 * - two *distinct* query terms matched is enough on its own;
 * - exactly one matched term only counts when it is rare (this is the only item
 *   that has it) and it really is a term of this item;
 * - a query that is itself a single term may match on that one rare term, which
 *   is how 「辣」 reaches an item about 辣;
 * - single-character CJK terms never build up the two-distinct-term count, so a
 *   bigram query cannot become "relevant" out of single characters alone.
 */
function isRelevant(
  document: IndexedItem,
  matchedTerms: readonly string[],
  queryTermCount: number,
  documentFrequency: ReadonlyMap<string, number>,
): boolean {
  const isRareOwnTerm = (term: string): boolean =>
    documentFrequency.get(term) === 1 && document.termCounts.has(term)

  const distinctive = matchedTerms.filter((term) => !isSingleCharacterHanTerm(term))
  if (distinctive.length >= 2) {
    return true
  }
  if (distinctive.length === 1) {
    return isRareOwnTerm(distinctive[0])
  }
  if (matchedTerms.length === 1 && queryTermCount === 1) {
    return isRareOwnTerm(matchedTerms[0])
  }
  return false
}

/**
 * Memory items relevant to `query`, best first. Items are returned verbatim, never rewritten.
 * An unrelated query returns an empty array, so callers can fall back to recency.
 */
export function selectMemoryItems(
  items: readonly string[],
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): string[] {
  const limit = options.limit ?? DEFAULT_MEMORY_LIMIT
  const maxChars = options.maxChars ?? DEFAULT_MEMORY_MAX_CHARS
  if (items.length === 0 || limit <= 0) {
    return []
  }

  const terms = queryTerms(query)
  if (terms.length === 0) {
    return []
  }

  const documents = items.map(indexItem)
  const corpusSize = Math.max(items.length, MIN_CORPUS)
  const totalLength = documents.reduce((sum, document) => sum + document.length, 0)
  const averageLength = Math.max(totalLength / documents.length, 1)
  const documentFrequency = new Map<string, number>()
  const inverseDocumentFrequency = new Map<string, number>()
  for (const term of terms) {
    const frequency = documents.reduce(
      (count, document) => count + (document.termCounts.has(term) ? 1 : 0),
      0,
    )
    documentFrequency.set(term, frequency)
    inverseDocumentFrequency.set(term, Math.log(1 + (corpusSize - frequency + 0.5) / (frequency + 0.5)))
  }

  const scored: { index: number; score: number }[] = []
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index]
    const matched = terms.filter((term) => document.termCounts.has(term))
    if (matched.length === 0 || !isRelevant(document, matched, terms.length, documentFrequency)) {
      continue
    }

    const normalization = BM25_K1 * (1 - BM25_B + (BM25_B * document.length) / averageLength)
    let score = 0
    for (const term of matched) {
      const termFrequency = (document.termCounts.get(term) ?? 0) * MATCHED_TERM_WEIGHT
      const idf = inverseDocumentFrequency.get(term) ?? 0
      score += (idf * termFrequency * (BM25_K1 + 1)) / (termFrequency + normalization)
    }
    scored.push({ index, score })
  }

  // Score descending, then original index: the result never depends on sort
  // stability, so the same input always yields the same prompt.
  scored.sort((left, right) => right.score - left.score || left.index - right.index)

  const selected: string[] = []
  let usedChars = 0
  for (const { index } of scored) {
    if (selected.length >= limit) {
      break
    }
    const item = items[index]
    // The single best item is always allowed, even when it alone blows the budget.
    if (selected.length > 0 && usedChars + item.length > maxChars) {
      break
    }
    selected.push(item)
    usedChars += item.length
  }

  return selected
}
