import { Component } from 'react';

// Catches render/runtime errors in any screen so the whole app never goes blank.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Screen error:', error, info);
  }
  componentDidUpdate(prev) {
    // Reset the error when navigating to a different screen.
    if (prev.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="entry" style={{ padding: 32 }}>
          <div className="entry-sec" style={{ color: 'var(--accent)' }}>⚠ Something went wrong on this screen</div>
          <p className="muted" style={{ margin: '8px 0' }}>
            {String(this.state.error && this.state.error.message || this.state.error)}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn" onClick={() => { window.location.hash = ''; window.location.href = '/'; }}>Go to Dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
