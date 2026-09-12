import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

export const WORKSPACE_SPLIT_STORAGE_KEY = 'webdroid-workspace-split'

export type SplitPaneStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export type SplitPaneOptions = {
  /** Percentage of the container given to the first pane. */
  defaultSplit: number
  maxSplit?: number
  minSplit?: number
  /** Persistence backend; defaults to localStorage when it is reachable. */
  storage?: SplitPaneStorage | null
  /** Storage key; null disables persistence. */
  storageKey?: string | null
}

export type SplitPaneHandleProps = {
  'aria-label': string
  'aria-orientation': 'vertical'
  'aria-valuemax': number
  'aria-valuemin': number
  'aria-valuenow': number
  onDoubleClick: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  role: 'separator'
  tabIndex: number
}

const KEYBOARD_STEP_PERCENT = 2
const KEYBOARD_DELTAS: Record<string, number> = {
  ArrowDown: KEYBOARD_STEP_PERCENT,
  ArrowLeft: -KEYBOARD_STEP_PERCENT,
  ArrowRight: KEYBOARD_STEP_PERCENT,
  ArrowUp: -KEYBOARD_STEP_PERCENT,
}

function clampPercent(value: number, minSplit: number, maxSplit: number) {
  return Math.min(maxSplit, Math.max(minSplit, value))
}

/** localStorage access can throw (private mode, disabled storage); degrade to memory. */
function defaultSplitStorage(): SplitPaneStorage | null {
  try {
    const storage = globalThis.localStorage
    if (!storage) {
      return null
    }
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    }
  } catch {
    return null
  }
}

function readStoredSplit(
  storage: SplitPaneStorage | null,
  storageKey: string | null,
  minSplit: number,
  maxSplit: number,
) {
  if (!storage || !storageKey) {
    return null
  }
  try {
    const stored = storage.getItem(storageKey)
    if (stored === null || stored.trim() === '') {
      return null
    }
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? clampPercent(parsed, minSplit, maxSplit) : null
  } catch {
    return null
  }
}

/**
 * Drives a two-pane split layout: a persisted percentage for the first pane,
 * pointer dragging from the divider, and keyboard resizing.
 * `isCustom` stays false until the user resizes, so CSS keeps its own
 * per-state defaults until then.
 */
export function useSplitPane({
  defaultSplit,
  maxSplit = 75,
  minSplit = 25,
  storage,
  storageKey = null,
}: SplitPaneOptions) {
  const resolvedStorage = useMemo(
    () => (storage === undefined ? defaultSplitStorage() : storage),
    [storage],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [isCustom, setIsCustom] = useState(
    () => readStoredSplit(resolvedStorage, storageKey, minSplit, maxSplit) !== null,
  )
  const [splitPercent, setSplitPercent] = useState(
    () =>
      readStoredSplit(resolvedStorage, storageKey, minSplit, maxSplit) ??
      clampPercent(defaultSplit, minSplit, maxSplit),
  )

  useEffect(() => () => dragCleanupRef.current?.(), [])

  useEffect(() => {
    if (!isCustom || !resolvedStorage || !storageKey) {
      return
    }
    try {
      resolvedStorage.setItem(storageKey, String(Math.round(splitPercent)))
    } catch {
      // Persistence is best effort; resizing keeps working in memory.
    }
  }, [isCustom, resolvedStorage, splitPercent, storageKey])

  const applySplit = useCallback(
    (value: number) => {
      setIsCustom(true)
      setSplitPercent(clampPercent(value, minSplit, maxSplit))
    },
    [maxSplit, minSplit],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const container = containerRef.current
      if (!container) {
        return
      }
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }

      dragCleanupRef.current?.()
      event.preventDefault?.()
      event.currentTarget?.setPointerCapture?.(event.pointerId)

      function handlePointerMove(moveEvent: PointerEvent) {
        applySplit(((moveEvent.clientX - rect.left) / rect.width) * 100)
      }

      function stopDragging() {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', stopDragging)
        dragCleanupRef.current = null
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', stopDragging)
      dragCleanupRef.current = stopDragging
    },
    [applySplit],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const delta = KEYBOARD_DELTAS[event.key]
      if (delta === undefined) {
        return
      }
      event.preventDefault()
      applySplit(splitPercent + delta)
    },
    [applySplit, splitPercent],
  )

  const handleProps: SplitPaneHandleProps = {
    'aria-label': 'Resize panes',
    'aria-orientation': 'vertical',
    'aria-valuemax': maxSplit,
    'aria-valuemin': minSplit,
    'aria-valuenow': Math.round(splitPercent),
    onDoubleClick: () => {
      setIsCustom(false)
      setSplitPercent(clampPercent(defaultSplit, minSplit, maxSplit))
    },
    onKeyDown,
    onPointerDown,
    role: 'separator',
    tabIndex: 0,
  }

  return { containerRef, handleProps, isCustom, splitPercent }
}
