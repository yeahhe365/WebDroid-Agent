// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBodyOverflow } from './useBodyOverflow'

beforeEach(() => {
  document.body.style.overflow = 'auto'
  document.body.style.overscrollBehavior = 'auto'
})

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  document.body.style.overscrollBehavior = ''
})

describe('useBodyOverflow', () => {
  it('locks scrolling and scroll chaining while the lock is active', () => {
    const { rerender } = renderHook(({ lock }) => useBodyOverflow(lock), {
      initialProps: { lock: false },
    })

    expect(document.body.style.overflow).toBe('auto')

    rerender({ lock: true })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.overscrollBehavior).toBe('contain')

    rerender({ lock: false })
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.overscrollBehavior).toBe('auto')
  })

  it('keeps the lock until every consumer releases it', () => {
    const first = renderHook(({ lock }) => useBodyOverflow(lock), {
      initialProps: { lock: true },
    })
    const second = renderHook(({ lock }) => useBodyOverflow(lock), {
      initialProps: { lock: true },
    })

    expect(document.body.style.overflow).toBe('hidden')

    first.rerender({ lock: false })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.overscrollBehavior).toBe('contain')

    second.rerender({ lock: false })
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.overscrollBehavior).toBe('auto')
  })
})
