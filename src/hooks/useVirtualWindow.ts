import { useCallback, useMemo, useState, type UIEvent } from 'react'

const DEFAULT_ESTIMATE = 140
const DEFAULT_OVERSCAN = 6

export type VirtualWindow = {
  endIndex: number
  offsetTop: number
  onScroll: (event: UIEvent<HTMLElement>) => void
  startIndex: number
  totalHeight: number
}

/**
 * Lightweight fixed-estimate windowing for long chat streams.
 * Variable-height cards still work; overscan covers measurement error.
 */
export function useVirtualWindow(
  itemCount: number,
  options?: {
    estimateHeight?: number
    overscan?: number
  },
): VirtualWindow {
  const estimateHeight = options?.estimateHeight ?? DEFAULT_ESTIMATE
  const overscan = options?.overscan ?? DEFAULT_OVERSCAN
  const [range, setRange] = useState({ scrollTop: 0, viewportHeight: 600 })

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget
    setRange((current) => {
      if (
        current.scrollTop === target.scrollTop &&
        current.viewportHeight === target.clientHeight
      ) {
        return current
      }
      return {
        scrollTop: target.scrollTop,
        viewportHeight: target.clientHeight || 600,
      }
    })
  }, [])

  return useMemo(() => {
    const totalHeight = itemCount * estimateHeight
    if (itemCount === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        offsetTop: 0,
        totalHeight: 0,
        onScroll,
      }
    }

    const rawStart = Math.floor(range.scrollTop / estimateHeight) - overscan
    const startIndex = Math.max(0, rawStart)
    const visibleCount = Math.ceil(range.viewportHeight / estimateHeight) + overscan * 2
    const endIndex = Math.min(itemCount, startIndex + visibleCount)
    const offsetTop = startIndex * estimateHeight

    return {
      startIndex,
      endIndex,
      offsetTop,
      totalHeight,
      onScroll,
    }
  }, [estimateHeight, itemCount, onScroll, overscan, range.scrollTop, range.viewportHeight])
}
