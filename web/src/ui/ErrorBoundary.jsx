import { Component } from 'react'
import { log } from '../lib/log.js'

/**
 * Generic error boundary. `fallback` is a render function ({ error, reset }) => node.
 * `resetKeys`: when any value changes the boundary clears (e.g. node id or mode), so navigating away recovers.
 */
export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    log.error('[boundary]', this.props.name ?? 'unnamed', error?.message, info?.componentStack?.split('\n')[1]?.trim())
    this.props.onError?.(error, info)
  }

  componentDidUpdate(prev) {
    if (this.state.error && this.props.resetKeys && prev.resetKeys?.some((v, i) => !Object.is(v, this.props.resetKeys[i]))) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset })
    return this.props.children
  }
}
