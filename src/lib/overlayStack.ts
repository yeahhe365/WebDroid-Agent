/**
 * A tiny stack for modal-like surfaces.
 *
 * Every dialog/drawer that owns Escape pushes a layer while it is open. The
 * global capture listener routes Escape to the top layer only, so a screenshot
 * lightbox inside the phone preview no longer closes the whole app or stops an
 * agent run, and an installed-apps dialog no longer closes its parent drawer.
 */
type OverlayLayer = {
  id: number
  onEscape: () => void
}

const layers: OverlayLayer[] = []
let nextLayerId = 1
let listenerInstalled = false

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || layers.length === 0) {
    return
  }

  // Let a native select popup and IME composition consume Escape first.
  const target = event.target
  if (target instanceof HTMLElement) {
    if (target.tagName === 'SELECT' || event.isComposing) {
      return
    }
  }

  const top = layers[layers.length - 1]
  event.preventDefault()
  event.stopImmediatePropagation()
  top.onEscape()
}

function ensureListener() {
  if (listenerInstalled || typeof window === 'undefined') {
    return
  }
  listenerInstalled = true
  // Capture phase: this runs before App-level shortcuts (Cmd/Ctrl+K/B/J) and
  // before any legacy bubble-phase Escape handlers.
  window.addEventListener('keydown', handleEscape, true)
}

export function pushOverlayLayer(onEscape: () => void): () => void {
  ensureListener()
  const layer: OverlayLayer = { id: nextLayerId, onEscape }
  nextLayerId += 1
  layers.push(layer)

  return () => {
    const index = layers.findIndex((entry) => entry.id === layer.id)
    if (index >= 0) {
      layers.splice(index, 1)
    }
  }
}

export function hasOpenOverlay(): boolean {
  return layers.length > 0
}

/** Test helper: drop layers left behind by an interrupted render. */
export function resetOverlayStackForTests() {
  layers.length = 0
}
