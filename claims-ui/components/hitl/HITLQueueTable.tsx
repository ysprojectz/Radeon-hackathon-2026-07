"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfidenceScore } from "@/components/shared/ConfidenceScore";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SLACountdown } from "@/components/hitl/SLACountdown";
import { HITL_TRIGGER_LABELS, HITL_TRIGGER_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CheckSquare, AlertOctagon, Bot, Clock, Eye, GitBranch, WifiOff } from "lucide-react";
import type { HITLQueueItem } from "@/lib/types";

interface HITLQueueTableProps {
  items?: HITLQueueItem[];
  isLoading: boolean;
  /** SWR error — distinguishes API failure from a genuinely empty queue */
  error?: Error;
  onReview: (item: HITLQueueItem) => void;
  selectedClaimRefs?: Set<string>;
  allSelected?: boolean;
  someSelected?: boolean;
  activeClaimReference?: string | null;
  onToggleSelect?: (claimReference: string) => void;
  onToggleSelectAll?: () => void;
}

function assignmentTone(status?: string) {
  const normalized = (status ?? "").toUpperCase();
  if (["COMPLETED", "ROUTED", "AUTO_SETTLED"].includes(normalized)) {
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-700";
  }
  if (["FAILED", "BLOCKED"].includes(normalized)) {
    return "border-red-300/25 bg-red-400/10 text-red-700";
  }
  if (normalized === "SKIPPED") {
    return "border-white/10 bg-white/[0.035] text-white/38";
  }
  return "border-[rgba(37,99,235,0.18)] bg-[rgba(37,99,235,0.08)] text-brand-primary";
}

function AgentAssignmentStrip({ item }: { item: HITLQueueItem }) {
  const assignments = item.agent_assignments ?? item.agent_lane_assignments ?? [];
  const visible = assignments.slice(0, 4);
  if (!visible.length) {
    return (
      <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-white/36">
        <Bot className="h-3 w-3 shrink-0" />
        {item.assigned_to || "Unassigned"}
      </div>
    );
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">
        <GitBranch className="h-3 w-3" />
        Agents
      </span>
      {visible.map((assignment) => (
        <span
          key={`${item.claim_reference}-${assignment.agent_id}`}
          title={assignment.task ?? assignment.role ?? assignment.label}
          className={cn(
            "inline-flex max-w-[112px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-bold",
            assignmentTone(assignment.status)
          )}
        >
          <span className="truncate">{assignment.label}</span>
        </span>
      ))}
      {assignments.length > visible.length && (
        <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[10px] font-bold text-white/40">
          +{assignments.length - visible.length}
        </span>
      )}
    </div>
  );
}

export function HITLQueueTable({
  items,
  isLoading,
  error,
  onReview,
  selectedClaimRefs,
  allSelected = false,
  someSelected = false,
  activeClaimReference,
  onToggleSelect,
  onToggleSelectAll,
}: HITLQueueTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // API error — show a meaningful message rather than "queue is empty"
  if (error) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Unable to load queue"
        description="Could not reach the service. Check that the backend is running."
      />
    );
  }

  if (!items?.length) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="Queue is empty"
        description="All claims have been reviewed. Great work!"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="hidden lg:grid grid-cols-12 gap-4 rounded-xl border border-slate-900/[0.08] bg-slate-900/[0.03] px-4 py-3 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-text-secondary">
        <div className="col-span-2 flex items-center gap-2">
          {onToggleSelectAll && (
            <input
              type="checkbox"
              checked={allSelected}
              aria-checked={allSelected ? "true" : someSelected ? "mixed" : "false"}
              aria-label={allSelected ? "Clear selected review claims" : "Select all visible review claims"}
              onChange={onToggleSelectAll}
              className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[var(--brand-primary)]"
            />
          )}
          Claim Reference
        </div>
        <div className="col-span-2">Patient</div>
        <div className="col-span-1 text-center">Billed</div>
        <div className="col-span-1 text-center">Recommended</div>
        <div className="col-span-1 text-center">Pending Days</div>
        <div className="col-span-1 text-center">Confidence</div>
        <div className="col-span-1 text-center">Due Time</div>
        <div className="col-span-2">Trigger</div>
        <div className="col-span-1 text-center">Actions</div>
      </div>

      {items.map((item) => {
        const isRegViolation = item.trigger_reason === "REGULATORY_VIOLATION";
        const isHighValue = item.trigger_reason === "HIGH_VALUE";
        const conf = parseFloat(item.ai_confidence) * 100;
        const pendingDays = item.pending_days_since ?? 0;
        const isSelected = selectedClaimRefs?.has(item.claim_reference) ?? false;
        const isActive = activeClaimReference === item.claim_reference;
        const priorityTone =
          item.priority === 1
            ? "border-red-400/25 bg-red-400/10 text-red-700"
            : item.priority === 2
            ? "border-amber-400/25 bg-amber-400/10 text-amber-700"
            : "border-white/10 bg-white/[0.04] text-white/45";

        const slaMs = item.sla_deadline ? new Date(item.sla_deadline).getTime() - Date.now() : null;
        const isSlaUrgent = slaMs !== null && slaMs > 0 && slaMs < 60 * 60 * 1000;

        return (
          <div
            key={item.id}
            className={cn(
              "rounded-xl border border-white/[0.055] bg-white/[0.022] p-4 space-y-2 transition-all hover:border-[rgba(37,99,235,0.16)] hover:bg-[rgba(37,99,235,0.035)] hover:translate-x-[2px]",
              isActive && "ring-2 ring-[var(--brand-primary)]/40 shadow-md",
              isSelected && "border-[rgba(37,99,235,0.30)] bg-[rgba(37,99,235,0.06)]",
              isSlaUrgent
                ? "animate-pulse border-red-500/40 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.15)]"
                : isRegViolation
                ? "dark:border-red-500/20 border-red-200 dark:bg-red-500/5 bg-red-50/50 border-l-2 border-l-red-500/40"
                : isHighValue
                ? "dark:border-orange-500/20 border-orange-200 dark:bg-orange-500/5 bg-orange-50/50 border-l-2 border-l-amber-500/40"
                : "border-l-2 border-l-transparent"
            )}
          >
            {/* Row content using grid layout */}
            <div className="grid grid-cols-3 lg:grid-cols-12 gap-2 lg:gap-4 items-center">
              {/* Claim Reference */}
              <div className="col-span-3 lg:col-span-2 flex items-center gap-2">
                {onToggleSelect && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    aria-label={`Select ${item.claim_reference}`}
                    onChange={() => onToggleSelect(item.claim_reference)}
                    className="h-4 w-4 shrink-0 rounded border-white/20 bg-white/5 accent-[var(--brand-primary)]"
                  />
                )}
                {isRegViolation && (
                  <AlertOctagon className="h-4 w-4 text-red-600 shrink-0 hidden lg:block" />
                )}
                <Link
                  href={`/claims/${item.claim_reference}`}
                  className="font-mono text-sm font-bold text-primary hover:underline truncate"
                >
                  {item.claim_reference}
                </Link>
              </div>

              {/* Patient Name */}
              <div className="col-span-3 lg:col-span-2 text-sm text-foreground truncate">
                {item.patient_name}
              </div>

              {/* Billed Amount */}
              <div className="hidden lg:block lg:col-span-1 text-center">
                <CurrencyAmount
                  amount={item.total_billed}
                  currency={item.currency ?? "AED"}
                  className="text-sm font-medium"
                />
              </div>

              {/* Recommended settlement */}
              <div className="hidden lg:block lg:col-span-1 text-center">
                <CurrencyAmount
                  amount={item.ai_settlement_amount}
                  currency={item.currency ?? "AED"}
                  className="text-sm font-medium"
                />
              </div>

              {/* Pending Days Since - Task 11 */}
              <div className="col-span-1 lg:col-span-1 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums", priorityTone)}>
                    P{item.priority}
                  </span>
                  <span className="text-[9px] text-white/25">{pendingDays}d</span>
                </div>
              </div>

              {/* Confidence */}
              <div className="col-span-1 lg:col-span-1 flex justify-center">
                <ConfidenceScore score={conf} size="sm" />
              </div>

              {/* Due time */}
              <div className="col-span-1 lg:col-span-1 flex justify-center">
                <SLACountdown slaDeadline={item.sla_deadline} />
              </div>

              {/* Trigger Reason */}
              <div className="col-span-3 lg:col-span-2">
                <Badge
                  className={cn(
                    "text-xs w-full justify-center lg:justify-start",
                    HITL_TRIGGER_COLORS[item.trigger_reason] ??
                      "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/40"
                  )}
                >
                  {HITL_TRIGGER_LABELS[item.trigger_reason] ?? item.trigger_reason}
                </Badge>
                <p className="text-[10px] text-muted-foreground text-center lg:text-left mt-1">
                  {item.claim_type} · {item.market_region}
                </p>
                {item.hitl_priority_reason && (
                  <p className="mt-1 text-[10px] leading-4 text-white/35">
                    {item.hitl_priority_reason}
                  </p>
                )}
                <AgentAssignmentStrip item={item} />
              </div>

              {/* Actions */}
              <div className="col-span-3 lg:col-span-1 flex items-center justify-center">
                <Button
                  size="sm"
                  onClick={() => onReview(item)}
                  className="shrink-0 gap-1 px-2.5 py-1.5 h-8 text-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Review
                </Button>
              </div>
            </div>

            {/* Mobile view details (shown on smaller screens) */}
            <div className="lg:hidden flex items-center gap-4 text-sm flex-wrap pt-2 border-t border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Billed:</span>
                <CurrencyAmount
                  amount={item.total_billed}
                  currency={item.currency ?? "AED"}
                  className="font-medium"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Recommended:</span>
                <CurrencyAmount
                  amount={item.ai_settlement_amount}
                  currency={item.currency ?? "AED"}
                  className="font-medium"
                />
              </div>
              <div className="flex items-center gap-1 text-xs ml-auto">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <SLACountdown slaDeadline={item.sla_deadline} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
