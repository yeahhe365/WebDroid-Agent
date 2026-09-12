// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useSplitPane, type SplitPaneStorage } from './useSplitPane'

const STORAGE_KEY = 'webdroid-test-split'

function memoryStorage(initialValue: string | null = null): SplitPaneStorage {
  let value = initialValue
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next
    }),
  }
}

function stubContainer(width = 1000) {
  const container = document.createElement('div')
  container.getBoundingClientRect = () =>
    ({ bottom: 800, height: 800, left: 0, right: width, top: 0, width, x: 0, y: 0 }) as DOMRect
  document.body.append(container)
  return container
}

function pointerDown(clientX: number) {
  return { clientX, currentTarget: null, pointerId: 1 } as unknown as ReactPointerEvent<HTMLElement>
}

function keyDown(key: string) {
  return { key, preventDefault: () => {} } as unknown as React.KeyboardEvent<HTMLElement>
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('useSplitPane', () => {
  it('uses the default split until the user resizes', () => {
    const { result } = renderHook(() =>
      useSplitPane({ defaultSplit: 52, storage: memoryStorage(), storageKey: STORAGE_KEY }),
    )

    expect(result.current.splitPercent).toBe(52)
    expect(result.current.isCustom).toBe(false)
  })

  it('drags the divider to resize the panes', () => {
    const container = stubContainer(1000)
    const { result } = renderHook(() =>
      useSplitPane({ defaultSplit: 52, storage: memoryStorage(), storageKey: STORAGE_KEY }),
    )
    result.current.containerRef.current = container

    act(() => {
      result.current.handleProps.onPointerDown(pointerDown(520))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700 }))
    })

    expect(result.current.splitPercent).toBe(70)
    expect(result.current.isCustom).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
  })

  it('clamps the split to the allowed range', () => {
    const container = stubContainer(1000)
    const { result } = renderHook(() =>
      useSplitPane({
        defaultSplit: 52,
        maxSplit: 75,
        minSplit: 25,
        storage: memoryStorage(),
        storageKey: STORAGE_KEY,
      }),
    )
    result.current.containerRef.current = container

    act(() => {
      result.current.handleProps.onPointerDown(pointerDown(500))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5000 }))
    })
    expect(result.current.splitPercent).toBe(75)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: -500 }))
    })
    expect(result.current.splitPercent).toBe(25)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
  })

  it('resizes with the arrow keys', () => {
    const { result } = renderHook(() =>
      useSplitPane({ defaultSplit: 52, storage: memoryStorage(), storageKey: STORAGE_KEY }),
    )

    act(() => {
      result.current.handleProps.onKeyDown(keyDown('ArrowRight'))
    })
    expect(result.current.splitPercent).toBeGreaterThan(52)

    const widened = result.current.splitPercent
    act(() => {
      result.current.handleProps.onKeyDown(keyDown('ArrowLeft'))
    })
    expect(result.current.splitPercent).toBeLessThan(widened)
  })

  it('restores a stored split and persists new values', () => {
    const storage = memoryStorage('61')
    const container = stubContainer(1000)
    const { result } = renderHook(() =>
      useSplitPane({ defaultSplit: 52, storage, storageKey: STORAGE_KEY }),
    )

    expect(result.current.splitPercent).toBe(61)
    expect(result.current.isCustom).toBe(true)

    result.current.containerRef.current = container
    act(() => {
      result.current.handleProps.onPointerDown(pointerDown(610))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })

    expect(storage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, '40')
  })

  it('ignores unusable stored values', () => {
    const { result } = renderHook(() =>
      useSplitPane({
        defaultSplit: 52,
        maxSplit: 75,
        minSplit: 25,
        storage: memoryStorage('nonsense'),
        storageKey: STORAGE_KEY,
      }),
    )

    expect(result.current.splitPercent).toBe(52)
    expect(result.current.isCustom).toBe(false)
  })

  it('clamps stored values that fall outside the range', () => {
    const { result } = renderHook(() =>
      useSplitPane({
        defaultSplit: 52,
        maxSplit: 75,
        minSplit: 25,
        storage: memoryStorage('5'),
        storageKey: STORAGE_KEY,
      }),
    )

    expect(result.current.splitPercent).toBe(25)
  })
})
