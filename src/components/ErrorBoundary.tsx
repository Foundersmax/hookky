import { Component, type ReactNode } from "react";

/** Keeps a crash in one area of the studio from blanking the rest. */
export class ErrorBoundary extends Component<{ area: string; className?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`Rookker: the ${this.props.area} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`crash ${this.props.className ?? ""}`} role="alert">
        <h4>The {this.props.area} hit a problem</h4>
        <p className="muted">Your project is safe. Reload this panel to carry on; undo (⌘Z) if a recent edit caused it.</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Reload this panel
        </button>
        <details className="tiny">
          <summary>Details</summary>
          <code>{this.state.error.message}</code>
        </details>
      </div>
    );
  }
}
