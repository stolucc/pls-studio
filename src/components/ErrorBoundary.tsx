// Error boundaries: a part of the window that fails to render (the diagram,
// the Inspector, the results) shows a short note with a way to reload, and
// the rest of the app stays usable; the top-level one catches everything
// else. The error itself goes to the console, not onto the page.

import { Component, type ReactNode } from 'react';

interface Props {
  /** What failed, for the message ("the diagram"); without it, the whole app. */
  area?: string;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`PLS Studio: ${this.props.area ?? 'the app'} could not be shown.`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { area } = this.props;
    return (
      <div className={area ? 'crash' : 'crash crash-app'} role="alert">
        <p>
          {area
            ? `Something went wrong showing ${area}.`
            : 'Something went wrong, and PLS Studio cannot continue.'}{' '}
          Reload the page to continue.
        </p>
        <button className="btn sm primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
