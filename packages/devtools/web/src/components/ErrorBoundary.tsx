import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 全局错误边界——捕获渲染错误，显示错误信息而非白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[DevTools ErrorBoundary]', error.message)
    console.error('[DevTools ErrorBoundary stack]', info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full bg-surface p-8">
          <div className="bg-card border border-error/30 rounded-xl px-8 py-6 max-w-lg text-center shadow-sm">
            <p className="text-base font-semibold text-error mb-2">Something went wrong</p>
            <p className="text-xs text-text-secondary mb-4 font-mono bg-surface rounded-lg p-3 text-left break-all">
              {this.state.error.message}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
