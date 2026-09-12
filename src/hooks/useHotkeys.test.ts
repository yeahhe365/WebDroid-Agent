// @vitest-environment jsdom

import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHotkeys } from './useHotkeys'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function renderWithInput(value = '') {
  const input = document.createElement('textarea')
  input.value = value
  document.body.append(input)
  input.focus()
  return input
}

describe('useHotkeys', () => {
  it('fires a modifier shortcut for both Ctrl and Meta', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys([{ handler, key: 'k', metaOrCtrl: true }]))

    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('ignores bare-key shortcuts while a text field has focus', () => {
    const handler = vi.fn()
    const input = renderWithInput()
    renderHook(() => useHotkeys([{ handler, key: 'Escape' }]))

    // Keydown bubbles from the focused textarea up to the window listener.
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(handler).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('still fires modifier shortcuts while a text field has focus', () => {
    const handler = vi.fn()
    const input = renderWithInput()
    renderHook(() => useHotkeys([{ handler, key: 'j', metaOrCtrl: true }]))

    fireEvent.keyDown(input, { ctrlKey: true, key: 'j' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('matches keys case-insensitively and honours the shift requirement', () => {
    const plain = vi.fn()
    const shifted = vi.fn()
    renderHook(() =>
      useHotkeys([
        { handler: plain, key: 'b' },
        { handler: shifted, key: 'B', shift: true },
      ]),
    )

    fireEvent.keyDown(window, { key: 'B' })
    fireEvent.keyDown(window, { key: 'b', shiftKey: true })

    expect(plain).toHaveBeenCalledTimes(1)
    expect(shifted).toHaveBeenCalledTimes(1)
  })

  it('prevents the browser default for a matched shortcut', () => {
    const handler = vi.fn()
    renderHook(() => useHotkeys([{ handler, key: 'k', metaOrCtrl: true }]))

    const event = new KeyboardEvent('keydown', { cancelable: true, ctrlKey: true, key: 'k' })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('uses the latest handlers without re-registering the listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ handler }) => useHotkeys([{ handler, key: 'j', metaOrCtrl: true }]),
      { initialProps: { handler: first } },
    )

    rerender({ handler: second })
    fireEvent.keyDown(window, { ctrlKey: true, key: 'j' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
