"use client";
import { STATUS_LABELS } from "@/lib/constants";
import type { ClaimStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ClaimStatusBadgeProps {
  status: ClaimStatus | string;
  className?: string;
}

// Semantic only (DESIGN_SYSTEM.md §1.2): success/warning/danger/info tokens,
// never decorative variety. PROCESSING uses --status-info, which is the same
// blue as --brand-primary — no second accent hue.
const STATUS_STYLES: Record<string, string> = {
  PROCESSING:    "bg-[rgba(37,99,235,0.10)] text-[var(--status-info)] border-[rgba(37,99,235,0.22)]",
  HITL_PENDING:  "bg-[rgba(217,119,6,0.10)] text-[var(--status-warning)] border-[rgba(217,119,6,0.22)]",
  PENDING:       "bg-[rgba(217,119,6,0.10)] text-[var(--status-warning)] border-[rgba(217,119,6,0.22)]",
  SETTLED:       "bg-[rgba(5,150,105,0.10)] text-[var(--status-success)] border-[rgba(5,150,105,0.22)]",
  HITL_APPROVED: "bg-[rgba(5,150,105,0.10)] text-[var(--status-success)] border-[rgba(5,150,105,0.22)]",
  DENIED:        "bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)] border-[rgba(220,38,38,0.22)]",
  HITL_DENIED:   "bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)] border-[rgba(220,38,38,0.22)]",
  CANCELLED:     "bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)] border-[rgba(220,38,38,0.22)]",
  ERROR:         "bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)] border-[rgba(220,38,38,0.22)]",
};

export function ClaimStatusBadge({ status, className }: ClaimStatusBadgeProps) {
  const colorClass = STATUS_STYLES[status] ?? "bg-[var(--bg-card-muted)] text-[var(--text-muted)] border-[var(--border-subtle)]";
  const isProcessing = status === "PROCESSING";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border rounded-full px-[10px] py-[3px] text-[0.65rem] font-bold uppercase tracking-[0.05em]",
        colorClass,
        className
      )}
    >
      {isProcessing && (
        <span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--status-info)] animate-pulse shrink-0" />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
