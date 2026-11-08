import { describe, expect, it } from 'vitest'
import {
  BM25_B,
  BM25_K1,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_MEMORY_MAX_CHARS,
  MIN_CORPUS,
  memoryTerms,
  selectMemoryItems,
} from './memoryIndex'

describe('memoryTerms', () => {
  it('turns a CJK run into overlapping bigrams and keeps a one-character run whole', () => {
    expect(memoryTerms('麻辣烫')).toEqual(['麻辣', '辣烫'])
    expect(memoryTerms('辣')).toEqual(['辣'])
    expect(memoryTerms('火锅')).toEqual(['火锅'])
  })

  it('adds unigrams only on request and never duplicates a one-character run', () => {
    expect(memoryTerms('麻辣烫', { withUnigrams: true })).toEqual([
      '麻辣',
      '辣烫',
      '麻',
      '辣',
      '烫',
    ])
    expect(memoryTerms('辣', { withUnigrams: true })).toEqual(['辣'])
    expect(memoryTerms('麻辣烫', { withUnigrams: false })).toEqual(['麻辣', '辣烫'])
  })

  it('lowercases ASCII words and splits them on punctuation and underscores', () => {
    expect(memoryTerms('User prefers DARK-mode, snake_case 42')).toEqual([
      'user',
      'prefers',
      'dark',
      'mode',
      'snake',
      'case',
      '42',
    ])
  })

  it('ends the CJK run at a word boundary', () => {
    expect(memoryTerms('辣味 spicy 火锅')).toEqual(['辣味', 'spicy', '火锅'])
    expect(memoryTerms('')).toEqual([])
    expect(memoryTerms('，。！')).toEqual([])
  })

  it('never mutates its input', () => {
    const text = '喜欢麻辣口味'
    const terms = memoryTerms(text, { withUnigrams: true })

    expect(text).toBe('喜欢麻辣口味')
    expect(terms.length).toBeGreaterThan(0)
  })
})

describe('selectMemoryItems', () => {
  it('finds a CJK item by bigram and by single character', () => {
    const items = ['用户喜欢麻辣口味', '周五下午三点开会']

    expect(selectMemoryItems(items, '麻辣')).toEqual(['用户喜欢麻辣口味'])
    // 「辣」 is not a bigram of that item; the unigram path still reaches it.
    expect(selectMemoryItems(items, '辣')).toEqual(['用户喜欢麻辣口味'])
    expect(selectMemoryItems(items, '开会')).toEqual(['周五下午三点开会'])
  })

  it('matches English items case-insensitively', () => {
    const items = ['User prefers DARK mode', 'menu says fresh bread']

    expect(selectMemoryItems(items, 'dark mode')).toEqual(['User prefers DARK mode'])
    // Matched on the lowered term, returned with its original casing.
    expect(selectMemoryItems(items, 'DARK')).toEqual(['User prefers DARK mode'])
    expect(selectMemoryItems(items, 'bread menu')).toEqual(['menu says fresh bread'])
  })

  it('returns nothing for an unrelated query', () => {
    const items = ['User prefers DARK mode', 'menu says fresh bread']

    expect(selectMemoryItems(items, 'quantum chromodynamics')).toEqual([])
    expect(selectMemoryItems(items, 'bicycle repair')).toEqual([])
  })

  it('ranks an item matching two query terms above one matching a single term', () => {
    // The gate keeps a one-term item only when its term is rare, so the
    // one-term item needs a third, distinctive query word to stay eligible.
    const items = ['canary deploy checklist', 'zulu phrasebook']

    expect(selectMemoryItems(items, 'canary deploy zulu')).toEqual([
      'canary deploy checklist',
      'zulu phrasebook',
    ])
  })

  it('accepts a single rare term as relevant', () => {
    const items = ['the zygote stage is short', 'lunch menu is pasta']

    expect(selectMemoryItems(items, 'zygote')).toEqual(['the zygote stage is short'])
  })

  it('rejects a lone common term that several items share', () => {
    const items = ['deploy notes', 'deploy freeze window']

    expect(selectMemoryItems(items, 'deploy')).toEqual([])
  })

  it('does not let a shared single-character term gate a result', () => {
    const items = ['麻辣烫', '辣味零食']

    expect(selectMemoryItems(items, '辣')).toEqual([])
  })

  it('scores a one-item and a two-item store', () => {
    expect(selectMemoryItems(['canary deploy notes'], 'canary deploy')).toEqual([
      'canary deploy notes',
    ])
    expect(selectMemoryItems(['canary deploy notes', 'pasta recipe'], 'canary')).toEqual([
      'canary deploy notes',
    ])
  })

  it('honours the limit and defaults to five items', () => {
    const items = Array.from({ length: 8 }, (_, index) => `canary deploy note ${index}`)

    expect(selectMemoryItems(items, 'canary deploy')).toHaveLength(DEFAULT_MEMORY_LIMIT)
    expect(selectMemoryItems(items, 'canary deploy')[0]).toBe('canary deploy note 0')
    expect(selectMemoryItems(items, 'canary deploy', { limit: 2 })).toEqual([
      'canary deploy note 0',
      'canary deploy note 1',
    ])
    expect(selectMemoryItems(items, 'canary deploy', { limit: 0 })).toEqual([])
  })

  it('stops once the character budget would be exceeded', () => {
    const items = ['canary deploy aaa', 'canary deploy bbb']

    expect(selectMemoryItems(items, 'canary deploy', { maxChars: 17 })).toEqual([
      'canary deploy aaa',
    ])
    expect(selectMemoryItems(items, 'canary deploy')).toEqual(items)
  })

  it('always keeps the single best item, even past the budget', () => {
    const items = ['canary deploy aaa', 'canary deploy bbb']

    expect(selectMemoryItems(items, 'canary deploy', { maxChars: 1 })).toEqual([
      'canary deploy aaa',
    ])
    expect(DEFAULT_MEMORY_MAX_CHARS).toBe(2000)
  })

  it('stops at a too-large item instead of skipping it for a smaller one', () => {
    const filler = `canary deploy ${'y'.repeat(100)}`
    const items = ['canary deploy', filler, 'canary deploy again']

    expect(selectMemoryItems(items, 'canary deploy', { maxChars: 40 })).toEqual(['canary deploy'])
  })

  it('breaks score ties by original index', () => {
    const items = ['canary deploy alpha', 'canary deploy bravo']

    expect(selectMemoryItems(items, 'canary deploy')).toEqual([
      'canary deploy alpha',
      'canary deploy bravo',
    ])
    // Same order on every call, so the prompt stays stable across runs.
    expect(selectMemoryItems(items, 'canary deploy')).toEqual(
      selectMemoryItems(items, 'canary deploy'),
    )
  })

  it('returns nothing for an empty item list', () => {
    expect(selectMemoryItems([], 'canary deploy')).toEqual([])
    expect(selectMemoryItems([], '')).toEqual([])
  })

  it('returns nothing for an empty or blank query, so callers fall back to recency', () => {
    const items = ['canary deploy notes', 'pasta recipe']

    // No lexical signal: the caller keeps its recency order instead.
    expect(selectMemoryItems(items, '')).toEqual([])
    expect(selectMemoryItems(items, '   ')).toEqual([])
    expect(selectMemoryItems(items, '，。！')).toEqual([])
  })

  it('returns long items verbatim without truncating or mutating them', () => {
    const longItem = `canary deploy ${'step '.repeat(300)}`.trimEnd()
    const items = [longItem]
    const before = [...items]

    const selected = selectMemoryItems(items, 'canary deploy')

    expect(longItem.length).toBeGreaterThan(1200)
    expect(selected).toHaveLength(1)
    expect(selected[0]).toBe(longItem)
    expect(selected[0]).toHaveLength(longItem.length)
    expect(items).toEqual(before)
  })

  it('does not mutate the items array when nothing matches', () => {
    const items = ['canary deploy notes', 'pasta recipe']
    const before = [...items]

    expect(selectMemoryItems(items, 'zygote')).toEqual([])
    expect(items).toEqual(before)
  })

  it('exposes the reference BM25 constants', () => {
    expect(BM25_K1).toBe(1.2)
    expect(BM25_B).toBe(0.75)
    expect(MIN_CORPUS).toBe(50)
    expect(DEFAULT_MEMORY_LIMIT).toBe(5)
  })
})
