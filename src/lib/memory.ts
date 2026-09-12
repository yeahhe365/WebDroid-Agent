import { truncateRetainedText } from './textRetention'

export type MemoryStorage = Pick<Storage, 'getItem' | 'setItem'>

const MEMORY_KEY = 'webdroid-agent-memory'
const MAX_MEMORY_ITEMS = 48
const MEMORY_ITEM_MAX_LENGTH = 1200

export function loadMemoryItems(storage: MemoryStorage = localStorage): string[] {
  let raw: string | null
  try {
    raw = storage.getItem(MEMORY_KEY)
  } catch {
    // Storage can throw (private mode / disabled storage); boot with no items.
    return []
  }
  if (!raw) {
    return []
  }

  try {
    return normalizeMemoryItems(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Returns false when the browser refused the write (quota / disabled storage). */
export function saveMemoryItems(
  memoryItems: readonly string[],
  storage: MemoryStorage = localStorage,
): boolean {
  try {
    storage.setItem(MEMORY_KEY, JSON.stringify(normalizeMemoryItems(memoryItems)))
    return true
  } catch {
    return false
  }
}

export function rememberMemoryItem(
  currentItems: readonly string[],
  information: string,
): string[] {
  const content = normalizeMemoryItem(information)
  if (!content) {
    return normalizeMemoryItems(currentItems)
  }

  return normalizeMemoryItems([
    ...currentItems.filter((item) => normalizeMemoryItem(item) !== content),
    content,
  ])
}

function normalizeMemoryItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const items: string[] = []
  for (const item of value) {
    const normalized = normalizeMemoryItem(item)
    if (!normalized || items.includes(normalized)) {
      continue
    }
    items.push(normalized)
  }

  return items.slice(-MAX_MEMORY_ITEMS)
}

function normalizeMemoryItem(value: unknown) {
  return typeof value === 'string'
    ? truncateRetainedText(value.trim(), MEMORY_ITEM_MAX_LENGTH)
    : ''
}
