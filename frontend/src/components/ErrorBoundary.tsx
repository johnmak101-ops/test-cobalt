import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}
interface State {
  hasError: boolean
}

/** Catches render errors anywhere below it and shows a fallback instead of unmounting the whole tree
 *  (a single uncaught render exception would otherwise white-screen the entire app). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4 text-center">
            <p className="text-lg font-semibold text-text-primary">Something went wrong</p>
            <p className="text-sm text-text-muted">An unexpected error occurred. Try reloading the page.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Reload
            </button>
          </div>
        )
      )
    }
    return this.props.children
  }
}
