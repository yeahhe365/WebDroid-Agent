// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasOpenOverlay, pushOverlayLayer, resetOverlayStackForTests } from './overlayStack'

afterEach(() => {
  resetOverlayStackForTests()
})

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
}

describe('overlayStack', () => {
  it('routes Escape to the top-most layer only', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const popOuter = pushOverlayLayer(outer)
    const popInner = pushOverlayLayer(inner)

    pressEscape()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    popInner()
    pressEscape()
    expect(outer).toHaveBeenCalledTimes(1)

    popOuter()
    expect(hasOpenOverlay()).toBe(false)
  })

  it('ignores Escape while a native select is open', () => {
    const handler = vi.fn()
    pushOverlayLayer(handler)
    const select = document.createElement('select')

    select.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))

    expect(handler).not.toHaveBeenCalled()
  })
})
