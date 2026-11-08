import { Component, type ErrorInfo, type ReactNode } from 'react'
import { APP_COPY, resolveLocale, type AppCopy } from '../lib/appCopy'
import { loadSettings } from '../lib/settings'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  error: Error | null
}

/**
 * The boundary renders above every provider, so it cannot read the copy out of
 * context. Reading the stored language is best-effort on purpose: unreadable
 * storage is one of the crashes this boundary exists to catch, and the fallback
 * only touches `navigator`.
 */
function resolveBoundaryCopy(): AppCopy {
  try {
    return APP_COPY[resolveLocale(loadSettings().languageMode)]
  } catch {
    return APP_COPY[resolveLocale('system')]
  }
}

/**
 * Last-resort boundary: without it, any render-time throw (for example a
 * storage access failure on browsers that disable localStorage) blanks the page.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('WebDroid Agent crashed while rendering:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    const copy = resolveBoundaryCopy()

    return (
      <div className="app-crash" role="alert">
        <h1>WebDroid Agent</h1>
        <p>{copy.crashMessage}</p>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          {copy.crashReload}
        </button>
      </div>
    )
  }
}
