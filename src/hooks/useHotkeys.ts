import { useEffect, useRef } from 'react'

export type Hotkey = {
  /** Allow the shortcut to fire while a text field has focus. */
  allowInTextInput?: boolean
  handler: (event: KeyboardEvent) => void
  /** Event key name, matched case-insensitively (e.g. 'k', 'Escape'). */
  key: string
  /** Match Cmd on macOS and Ctrl elsewhere. */
  metaOrCtrl?: boolean
  /** Require Shift to be held. Bare keys never match while Shift is held. */
  shift?: boolean
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

function matchesHotkey(hotkey: Hotkey, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) {
    return false
  }

  if (hotkey.metaOrCtrl) {
    if (!event.metaKey && !event.ctrlKey) {
      return false
    }
  } else if (event.metaKey || event.ctrlKey || event.altKey) {
    return false
  }

  return Boolean(hotkey.shift) === event.shiftKey
}

/**
 * Registers global keyboard shortcuts on window.
 * Bare keys are ignored while a text field has focus so typing stays safe;
 * modifier shortcuts keep working there.
 */
export function useHotkeys(hotkeys: readonly Hotkey[]): void {
  const hotkeysRef = useRef(hotkeys)

  useEffect(() => {
    hotkeysRef.current = hotkeys
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const inTextInput = isTextEntryTarget(event.target)

      for (const hotkey of hotkeysRef.current) {
        if (!matchesHotkey(hotkey, event)) {
          continue
        }
        if (inTextInput && !hotkey.metaOrCtrl && !hotkey.allowInTextInput) {
          continue
        }
        event.preventDefault()
        hotkey.handler(event)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
