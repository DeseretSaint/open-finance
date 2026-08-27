"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasWindow } from "@/lib/browser-env";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * App-shell error boundary: without it, a render error in any screen crashes
 * the whole (app) segment to a blank page. This catches it and shows a calm
 * recovery card with a reload action instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]"
      >
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden="true" />
        <h2 className="mt-3 text-base font-semibold text-text">Something went wrong</h2>
        <p className="mt-1 text-sm text-text-muted">
          This screen hit an unexpected error. Your data is safe — reload to pick up where you left off.
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            if (hasWindow()) window.location.reload();
          }}
        >
          Reload
        </Button>
      </div>
    );
  }
}
