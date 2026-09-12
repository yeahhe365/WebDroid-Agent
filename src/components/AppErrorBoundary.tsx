import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  error: Error | null
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

    return (
      <div className="app-crash" role="alert">
        <h1>WebDroid Agent</h1>
        <p>Something went wrong while starting the app. Reloading usually fixes it.</p>
        <p>应用启动时出错了，刷新页面通常可以恢复。</p>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload / 重新加载
        </button>
      </div>
    )
  }
}
