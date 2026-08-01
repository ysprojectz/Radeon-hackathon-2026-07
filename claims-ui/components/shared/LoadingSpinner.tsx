"use client";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  message?: string;
  className?: string;
}

export function LoadingSpinner({ message, className }: LoadingSpinnerProps) {
  return (
    <div className={cn("glass-card flex flex-col items-center justify-center gap-3 py-12", className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
      {message && (
        <p className="text-sm text-white/42">{message}</p>
      )}
    </div>
  );
}
