import { describe, expect, it, vi } from 'vitest'
import { loadMemoryItems, rememberMemoryItem, saveMemoryItems, type MemoryStorage } from './memory'

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const values = { ...initial }
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value
    }),
  }
}

describe('memory persistence', () => {
  it('loads no memory from empty or invalid storage', () => {
    expect(loadMemoryItems(memoryStorage())).toEqual([])
    expect(loadMemoryItems(memoryStorage({ 'webdroid-agent-memory': 'not json' }))).toEqual([])
  })

  it('normalizes saved memory items', () => {
    const storage = memoryStorage()

    saveMemoryItems([' Gmail account ', '', 'Gmail account', ' SMS code is 123456 '], storage)

    expect(storage.setItem).toHaveBeenCalledWith(
      'webdroid-agent-memory',
      JSON.stringify(['Gmail account', 'SMS code is 123456']),
    )
  })

  it('moves repeated memories to the newest position', () => {
    expect(rememberMemoryItem(['first', 'second'], ' first ')).toEqual(['second', 'first'])
  })

  it('keeps the newest bounded memory items', () => {
    const items = Array.from({ length: 60 }, (_, index) => `memory ${index}`)

    const remembered = rememberMemoryItem(items, 'latest')

    expect(remembered).toHaveLength(48)
    expect(remembered[0]).toBe('memory 13')
    expect(remembered.at(-1)).toBe('latest')
  })
})


describe('memory storage failures', () => {
  it('returns no items when reading storage throws', () => {
    const storage: MemoryStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
    }
    expect(loadMemoryItems(storage)).toEqual([])
  })

  it('reports a refused write instead of throwing', () => {
    const storage: MemoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveMemoryItems(['note'], storage)).toBe(false)
  })
})
