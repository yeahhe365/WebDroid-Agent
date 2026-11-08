// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from './useToasts'

describe('useToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('replaces an identical toast instead of stacking duplicates', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.pushToast({ tone: 'warn', title: 'Permission denied' })
      result.current.pushToast({ tone: 'warn', title: 'Permission denied' })
      result.current.pushToast({ tone: 'warn', title: 'Permission denied' })
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe('Permission denied')
  })

  it('keeps toasts that differ by title or detail', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.pushToast({ tone: 'warn', title: 'Import failed' })
      result.current.pushToast({ tone: 'warn', title: 'Import failed', detail: 'row 3' })
      result.current.pushToast({ tone: 'warn', title: 'Export failed' })
    })

    expect(result.current.toasts).toHaveLength(3)
  })

  it('dismisses a toast and clears its timer', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.pushToast({ tone: 'info', title: 'Saved' })
    })
    const id = result.current.toasts[0].id

    act(() => {
      result.current.dismissToast(id)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('expires a toast after its duration', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.pushToast({ tone: 'info', title: 'Saved', durationMs: 1000 })
    })
    expect(result.current.toasts).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('never renders more than four toasts at once', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      for (let index = 0; index < 6; index += 1) {
        result.current.pushToast({ tone: 'info', title: `Message ${index}` })
      }
    })

    expect(result.current.toasts).toHaveLength(4)
    expect(result.current.toasts.at(-1)?.title).toBe('Message 5')
  })
})
