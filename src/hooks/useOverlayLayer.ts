import { useEffect, useRef } from 'react'
import { pushOverlayLayer } from '../lib/overlayStack'

/**
 * Registers a top-most Escape handler while `active` is true.
 * The callback is kept in a ref so inline props do not re-register the layer.
 */
export function useOverlayLayer(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape)

  useEffect(() => {
    handlerRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) {
      return
    }
    return pushOverlayLayer(() => handlerRef.current())
  }, [active])
}
