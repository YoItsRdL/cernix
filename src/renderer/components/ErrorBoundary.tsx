import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/error-state'

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
 * an unmounted blank renderer. Errors are also sent to the main
 * process via `sys:log` so they land in the developer terminal
 * alongside other diagnostics.
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
      const detail = `${error.message}\n${info.componentStack ?? ''}`.trim()
      console.error('[ErrorBoundary]', detail)
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
      <div className="flex h-full w-full items-center justify-center bg-surface-workspace">
        <ErrorState
          title="Something went wrong"
          detail={error.message}
          action={{ label: 'Reload view', onClick: this.reset }}
        />
      </div>
    )
  }
}
