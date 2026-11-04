import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/error-state'
import { WindowControls } from './WindowControls'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional renderer for the fallback UI. Receives the thrown error
   *  and a reset fn that clears the error state so the subtree can
   *  remount. Default is an `ErrorState` with a Reload action. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level React error boundary. Catches render-time exceptions in
 * the subtree and falls back to a consistent `ErrorState` instead of
 * an unmounted blank renderer. Errors are sent to main, which writes
 * them to its fatal-error log (`startup-error.log` in the app's data
 * folder); this comment used to say so while the code only logged to
 * the renderer's console.
 *
 * The fallback replaces the whole app, title bar included, and the
 * window has no frame of its own: it could be neither moved nor closed
 * with the mouse. It brings its own drag strip and caption buttons.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort structured log to the main process. Silent if the
    // bridge isn't available (e.g. during renderer-only tests).
    try {
      const detail = `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.trim()
      console.error('[ErrorBoundary]', detail)
      window.electronAPI?.reportError(detail)
    } catch {
      // swallow. We're already in the error path
    }
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="relative flex h-full w-full items-center justify-center bg-surface-workspace">
        <div className="app-drag absolute top-0 left-0 right-0 h-12" />
        <WindowControls />
        {/* Said for a person, not as the exception: the message itself
            ("Cannot read properties of null") is in the log. */}
        <ErrorState
          title="Something went wrong"
          detail="This view stopped on an error. Reload it to carry on; nothing on disk was changed. The details are in the app's error log."
          action={{ label: 'Reload view', onClick: this.reset }}
        />
      </div>
    )
  }
}
