import { useEffect, useRef, type RefObject } from 'react'

const trapStack: symbol[] = []

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.closest('[inert]'),
  )
}

export type DialogFocusTrapOptions = {
  active: boolean
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Restore focus to the element that opened the dialog. Defaults to true. */
  restoreFocus?: boolean
}

/**
 * Focus management for modal surfaces: initial focus, Tab/Shift+Tab cycle,
 * focus containment and focus restoration on close.
 *
 * It deliberately does not handle Escape; pair it with useOverlayLayer so only
 * the top-most surface reacts to Escape.
 */
export function useDialogFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  restoreFocus = true,
}: DialogFocusTrapOptions) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) {
      return
    }

    const container = containerRef.current
    if (!container) {
      return
    }

    const trapId = Symbol('dialog-focus-trap')
    trapStack.push(trapId)

    const root: HTMLElement = container
    if (!root.hasAttribute('tabindex')) {
      root.setAttribute('tabindex', '-1')
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusInitial = () => {
      const target = initialFocusRef?.current ?? getFocusable(root)[0] ?? root
      target.focus({ preventScroll: true })
    }
    focusInitial()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || trapStack[trapStack.length - 1] !== trapId) {
        return
      }
      const elements = getFocusable(root)
      if (elements.length === 0) {
        event.preventDefault()
        root.focus({ preventScroll: true })
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      const activeElement = document.activeElement
      const index = activeElement instanceof HTMLElement ? elements.indexOf(activeElement) : -1

      event.preventDefault()
      if (event.shiftKey) {
        ;(index <= 0 ? last : elements[index - 1]).focus({ preventScroll: true })
        return
      }
      ;(index === -1 || index === elements.length - 1 ? first : elements[index + 1]).focus({
        preventScroll: true,
      })
    }

    function handleFocusIn(event: FocusEvent) {
      if (trapStack[trapStack.length - 1] !== trapId) {
        return
      }
      if (event.target instanceof Node && !root.contains(event.target)) {
        focusInitial()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn, true)

    return () => {
      const trapIndex = trapStack.lastIndexOf(trapId)
      if (trapIndex >= 0) {
        trapStack.splice(trapIndex, 1)
      }
      window.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      if (restoreFocus && previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true })
      }
      previousFocusRef.current = null
    }
  }, [active, containerRef, initialFocusRef, restoreFocus])
}
