"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, Home, Cpu } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#030303] p-6 text-center selection:bg-cyan-500 selection:text-black">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] bg-rose-500/10 rounded-full blur-[120px] animate-pulse" />
      </div>

      <div className="glass-card relative z-10 max-w-md w-full p-8 md:p-12 space-y-8 backdrop-blur-3xl border-white/[0.08]">
        {/* Animated Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-rose-500/20 blur-2xl rounded-full animate-pulse" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-400 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
              <AlertTriangle className="h-10 w-10" />
            </div>
            <div className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black border border-white/10 text-cyan-400 shadow-xl">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-3">
          <h1 className="text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
            Neural Interface <span className="text-rose-500">Failure</span>
          </h1>
          <p className="text-sm font-medium text-white/40 leading-relaxed">
            A critical exception occurred in the UI layer. The system state has been preserved, but the current view could not be rendered.
          </p>
        </div>

        {error.digest && (
          <div className="rounded-xl bg-black/40 border border-white/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/20 mb-1">Error Trace ID</p>
            <p className="font-mono text-[11px] text-rose-300/60 break-all">{error.digest}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Button
            onClick={reset}
            className="w-full h-12 bg-white text-black hover:bg-white/90 font-black uppercase tracking-[0.2em] text-xs transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Attempt Recovery
          </Button>

          <Link href="/" className="block">
            <Button
              variant="outline"
              className="w-full h-12 border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white font-black uppercase tracking-[0.2em] text-xs transition-all"
            >
              <Home className="mr-2 h-4 w-4" />
              Return to Nexus
            </Button>
          </Link>
        </div>

        {/* Technical Footer */}
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/10">
          ACOS AI Core • v1.0.4 • {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
