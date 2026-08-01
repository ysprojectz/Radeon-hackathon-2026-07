"use client";
import { cn } from "@/lib/utils";
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from "@/lib/constants";

interface ConfidenceScoreProps {
  score: number | string; // 0-1 or 0-100
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ConfidenceScore({
  score,
  showLabel = true,
  size = "md",
  className,
}: ConfidenceScoreProps) {
  // Normalise to 0-100; guard against NaN (e.g. empty string or non-numeric input)
  let pct = typeof score === "string" ? parseFloat(score) : score;
  if (!isFinite(pct) || isNaN(pct)) pct = 0;
  if (pct <= 1) pct = pct * 100;

  const isHigh = pct >= CONFIDENCE_HIGH;
  const isMedium = pct >= CONFIDENCE_MEDIUM;

  const textColor = isHigh
    ? "dark:text-emerald-400 text-green-600"
    : isMedium
    ? "dark:text-amber-400 text-yellow-600"
    : "dark:text-red-400 text-red-600";

  const dotFill = isHigh
    ? "dark:bg-emerald-400 bg-green-600"
    : isMedium
    ? "dark:bg-amber-400 bg-yellow-600"
    : "dark:bg-red-400 bg-red-600";

  const dotCount = size === "sm" ? 4 : 5;
  const filled = Math.round((pct / 100) * dotCount);

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Confidence score: ${pct.toFixed(1)} percent`}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: dotCount }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "rounded-full",
              size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
              i < filled ? dotFill : "dark:bg-white/10 bg-slate-200"
            )}
          />
        ))}
      </span>
      {showLabel && (
        <span className={cn("font-mono text-xs font-medium", textColor)} aria-hidden="true">
          {pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}
