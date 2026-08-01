"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.fallback) {
        return this.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-3xl border border-white/5 bg-white/[0.02] p-8 text-center backdrop-blur-xl">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-400 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
            <AlertTriangle size={32} />
          </div>
          <h2 className="mb-2 text-xl font-bold text-white">Component failed to load</h2>
          <p className="mb-8 max-w-md text-sm text-white/40">
            A critical error occurred while rendering this section. Our telemetry has been notified.
            {this.state.error && (
              <span className="mt-4 block rounded-lg bg-black/40 p-3 font-mono text-[10px] text-rose-300/60">
                {this.state.error.message}
              </span>
            )}
          </p>
          <Button
            onClick={this.handleReset}
            variant="outline"
            className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
      );
    }

    return this.children;
  }

  // Helper to access fallback from instance (since getDerivedStateFromError is static)
  private get fallback() {
    return this.props.fallback;
  }

  private get children() {
    return this.props.children;
  }
}
