import { lazy, type ComponentType } from 'react'

const RETRY_FLAG = 'webdroid-lazy-chunk-retry'

/**
 * Deploying a new build invalidates old hashed chunks. An open tab that lazily
 * loads Settings or Markdown then hits a failed import and, without this,
 * unmounts the whole app through the top-level error boundary.
 *
 * On the first failure we reload once (which fetches the new index/chunks). If
 * it still fails, the error is re-thrown to the normal boundary.
 */
// The factory is generic over each component's props; `any` keeps the wrapper
// transparent instead of forcing every caller through a cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry(factory: () => Promise<{ default: ComponentType<any> }>) {
  return lazy(async () => {
    try {
      const module = await factory()
      try {
        sessionStorage.removeItem(RETRY_FLAG)
      } catch {
        // Session storage may be unavailable; retry still works per page load.
      }
      return module
    } catch (error) {
      let alreadyRetried = false
      try {
        alreadyRetried = sessionStorage.getItem(RETRY_FLAG) === '1'
        if (!alreadyRetried) {
          sessionStorage.setItem(RETRY_FLAG, '1')
        }
      } catch {
        // Ignore storage failures and fall through to the error boundary.
      }

      if (!alreadyRetried && typeof window !== 'undefined') {
        window.location.reload()
        // Keep Suspense pending while the reload happens.
        return new Promise<never>(() => undefined)
      }
      throw error
    }
  })
}
