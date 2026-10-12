import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/** If a page crashes while rendering, show a way out instead of a blank screen. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TailWatch dashboard error', error.name, info.componentStack?.split('\n')[1]?.trim());
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
        <div role="alert" className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">This page could not be shown</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Reload to try again. Your data is safe: nothing was changed.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
