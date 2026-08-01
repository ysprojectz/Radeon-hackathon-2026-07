"use client";

import { AlertTriangle, CheckCircle2, Clock3, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaimLifecycleStatus, ClaimResponse } from "@/lib/types";

export function humanizeLifecycleValue(value?: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatLifecycleAge(seconds?: number | null, ms?: number | null): string {
  const totalSeconds = seconds ?? (ms != null ? Math.round(ms / 1000) : null);
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "-";
  if (totalSeconds < 60) return `${Math.max(1, Math.round(totalSeconds))}s`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)}m`;
  if (totalSeconds < 86400) return `${Math.round(totalSeconds / 3600)}h`;
  return `${Math.round(totalSeconds / 86400)}d`;
}

export function lifecycleStatusTone(status?: ClaimLifecycleStatus | string | null) {
  const value = (status ?? "").toUpperCase();
  if (/COMPLETE|SETTLED|PAID|APPROVED|DONE/.test(value)) {
    return {
      label: "Completed",
      icon: CheckCircle2,
      dot: "bg-[var(--status-success)]",
      text: "text-[var(--status-success)]",
      border: "border-[var(--status-success)]/20",
      bg: "bg-[var(--status-success)]/10",
    };
  }
  if (/FAIL|ERROR|DENIED|REJECTED/.test(value)) {
    return {
      label: "Failed",
      icon: XCircle,
      dot: "bg-[var(--status-danger)]",
      text: "text-[var(--status-danger)]",
      border: "border-[var(--status-danger)]/20",
      bg: "bg-[var(--status-danger)]/10",
    };
  }
  if (/BLOCK|STUCK|BREACH|SLA/.test(value)) {
    return {
      label: /BREACH|SLA/.test(value) ? "Due-time breach" : "Blocked",
      icon: AlertTriangle,
      dot: "bg-[var(--status-warning)]",
      text: "text-[var(--status-warning)]",
      border: "border-[var(--status-warning)]/20",
      bg: "bg-[var(--status-warning)]/10",
    };
  }
  if (/WAIT|PENDING|HITL/.test(value)) {
    return {
      label: "Waiting",
      icon: PauseCircle,
      dot: "bg-text-muted",
      text: "text-text-secondary",
      border: "border-[var(--border-subtle)]",
      bg: "bg-[var(--bg-card-muted)]",
    };
  }
  if (/SKIP|NOT_STARTED/.test(value)) {
    return {
      label: "Skipped",
      icon: MinusCircle,
      dot: "bg-text-muted",
      text: "text-text-muted",
      border: "border-[var(--border-subtle)]",
      bg: "bg-[var(--bg-card-muted)]",
    };
  }
  if (/PROCESS|PROGRESS|RUNNING|ACTIVE/.test(value)) {
    return {
      label: "In Progress",
      icon: Loader2,
      dot: "bg-brand-primary",
      text: "text-brand-primary",
      border: "border-brand-primary/20",
      bg: "bg-brand-primary/10",
    };
  }
  return {
    label: "Tracked",
    icon: Clock3,
    dot: "bg-brand-primary",
    text: "text-brand-primary",
    border: "border-brand-primary/20",
    bg: "bg-brand-primary/10",
  };
}

export function getClaimLifecycleSnapshot(claim: ClaimResponse) {
  const lifecycle = claim.lifecycle;
  const stages = claim.pipeline_stage_report?.stages ?? [];
  const currentStage = lifecycle?.current_stage_label
    ?? lifecycle?.current_stage
    ?? [...stages].reverse().find((stage) => stage.status && stage.status !== "NOT_STARTED")?.label
    ?? claim.status;
  const currentStatus = lifecycle?.status ?? claim.pipeline_stage_report?.status ?? claim.status;
  return {
    stage: humanizeLifecycleValue(currentStage),
    status: currentStatus,
    age: formatLifecycleAge(lifecycle?.age_seconds, lifecycle?.age_ms ?? claim.pipeline_stage_report?.total_duration_ms ?? claim.processing_time_ms),
    blocker: lifecycle?.blocker ?? null,
    nextAction: lifecycle?.next_action ?? null,
  };
}

export function LifecycleStatusPill({
  status,
  label,
  compact = false,
  className,
}: {
  status?: ClaimLifecycleStatus | string | null;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const tone = lifecycleStatusTone(status);
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-bold uppercase tracking-[0.1em]",
        tone.border,
        tone.bg,
        tone.text,
        compact ? "gap-1 px-2 py-0.5 text-[9px]" : "gap-1.5 px-2.5 py-1 text-[10px]",
        className
      )}
    >
      <Icon className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", status?.toString().match(/PROCESS|PROGRESS|RUNNING/i) && "animate-spin")} />
      {label ?? tone.label}
    </span>
  );
}
