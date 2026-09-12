import { useEffect } from 'react'

/**
 * Manages document.body scroll locking as a shared stack.
 * Consumers (fullscreen preview, lightbox, modal dialogs) can lock
 * independently; body styles are only restored when the last lock is
 * released, no matter which component released it first.
 */
type BodyScrollLockState = {
  count: number
  overflow: string
  overscrollBehavior: string
}

const lockState: BodyScrollLockState = { count: 0, overflow: '', overscrollBehavior: '' }

export function useBodyOverflow(lock: boolean) {
  useEffect(() => {
    if (!lock) {
      return
    }

    if (lockState.count === 0) {
      lockState.overflow = document.body.style.overflow
      lockState.overscrollBehavior = document.body.style.overscrollBehavior
    }

    lockState.count += 1
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'contain'

    return () => {
      lockState.count -= 1
      if (lockState.count <= 0) {
        lockState.count = 0
        document.body.style.overflow = lockState.overflow
        document.body.style.overscrollBehavior = lockState.overscrollBehavior
      }
    }
  }, [lock])
}
