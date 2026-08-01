"use client";

import {
  Activity,
  AlertCircle,
  Calculator,
  CheckCircle2,
  FileCheck2,
  Gauge,
  MinusCircle,
  ScrollText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProcessingCompleteness, ComponentStatus, ConfidenceCap } from "@/lib/types";

interface CompletenessStatusPanelProps {
  completeness: ProcessingCompleteness;
  calculated_confidence?: string;
  safe_confidence?: string;
  confidence_cap?: ConfidenceCap;
  className?: string;
}

const STATUS_CONFIG: Record<ComponentStatus, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  label: string;
}> = {
  COMPLETED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: "text-emerald-300",
    bgColor: "border-emerald-400/20 bg-emerald-400/10",
    label: "Done",
  },
  SKIPPED: {
    icon: <MinusCircle className="h-3 w-3" />,
    color: "text-amber-300",
    bgColor: "border-amber-400/20 bg-amber-400/10",
    label: "Skipped",
  },
  FAILED: {
    icon: <XCircle className="h-3 w-3" />,
    color: "text-red-300",
    bgColor: "border-red-400/20 bg-red-400/10",
    label: "Failed",
  },
  NOT_STARTED: {
    icon: <AlertCircle className="h-3 w-3" />,
    color: "text-white/38",
    bgColor: "border-white/[0.08] bg-white/[0.04]",
    label: "Pending",
  },
};

function ReadinessStepCard({
  status,
  label,
  detail,
  icon,
}: {
  status: ComponentStatus;
  label: string;
  detail: string;
  icon: React.ReactNode;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20 text-white/52">
          {icon}
        </span>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          config.color,
          config.bgColor
        )}>
          {config.icon}
          {config.label}
        </span>
      </div>
      <p className="text-sm font-bold text-white/82">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-white/36">{detail}</p>
    </div>
  );
}

export function CompletenessStatusPanel({
  completeness,
  calculated_confidence,
  safe_confidence,
  confidence_cap,
  className,
}: CompletenessStatusPanelProps) {
  const { components, completion_percentage, all_completed, any_failed, failure_reasons } = completeness;
  const calculatedValue = calculated_confidence == null ? null : Number(calculated_confidence);
  const safeValue = safe_confidence == null ? null : Number(safe_confidence);
  const hasConfidence = calculatedValue != null && safeValue != null
    && Number.isFinite(calculatedValue)
    && Number.isFinite(safeValue);
  const derivedCoverageLimit = components.ai_reasoning.status === "SKIPPED" && confidence_cap == null
    ? 80
    : null;
  const confidenceNote = (() => {
    if (!hasConfidence) return null;
    if (confidence_cap) {
      if (confidence_cap.applied && confidence_cap.before != null && confidence_cap.limit != null) {
        const reason = confidence_cap.reason === "COMPONENT_FAILURE"
          ? "a required check failed"
          : confidence_cap.reason === "AI_REASONING_SKIPPED"
            ? "coverage review was skipped"
            : "readiness rules";
        return `Final score capped from ${confidence_cap.before.toFixed(1)}% to ${confidence_cap.after.toFixed(1)}% because ${reason}.`;
      }
      if (!confidence_cap.applied && confidence_cap.reason === "AI_REASONING_SKIPPED" && confidence_cap.limit != null) {
        return `Coverage review was skipped; ${confidence_cap.limit.toFixed(0)}% remains the maximum.`;
      }
      if (!confidence_cap.applied && confidence_cap.reason === "COMPONENT_FAILURE" && confidence_cap.limit != null) {
        return `A required check failed; ${confidence_cap.limit.toFixed(0)}% remains the maximum.`;
      }
    }
    if (derivedCoverageLimit != null && calculatedValue === safeValue && safeValue <= derivedCoverageLimit) {
      return `Coverage review was skipped; ${derivedCoverageLimit}% remains the maximum.`;
    }
    if (calculatedValue !== safeValue) {
      return `Final score was adjusted from ${calculatedValue.toFixed(1)}% to ${safeValue.toFixed(1)}%.`;
    }
    return null;
  })();

  const completedCount = Object.values(components).filter((component) => component.status === "COMPLETED").length;
  const overallColor = all_completed
    ? "text-emerald-300"
    : any_failed
      ? "text-red-300"
      : "text-amber-300";
  const progressColor = all_completed
    ? "bg-emerald-300"
    : any_failed
      ? "bg-red-300"
      : "bg-amber-300";

  return (
    <div className={cn("glass-card rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="ui-eyebrow text-white/30">Readiness</p>
            <h3 className="text-sm font-bold text-white">Processing Readiness</h3>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-white/62">
            {completedCount}/4 checks
          </span>
          <span className={cn("font-mono text-xs font-bold", overallColor)}>
            {completion_percentage}% complete
          </span>
        </div>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cn("h-full rounded-full transition-all", progressColor)} style={{ width: `${Math.max(0, Math.min(100, completion_percentage))}%` }} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReadinessStepCard
          status={components.rules_engine.status}
          label="Rules"
          detail={components.rules_engine.error || "Eligibility and policy rules"}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <ReadinessStepCard
          status={components.ai_reasoning.status}
          label="Coverage Review"
          detail={components.ai_reasoning.error || "Assisted coverage check"}
          icon={<Gauge className="h-4 w-4" />}
        />
        <ReadinessStepCard
          status={components.policy_citations.status}
          label="Policy References"
          detail={components.policy_citations.error || "Relevant policy clauses"}
          icon={<ScrollText className="h-4 w-4" />}
        />
        <ReadinessStepCard
          status={components.settlement_calculation.status}
          label="Settlement"
          detail={components.settlement_calculation.error || "Payable calculation"}
          icon={<Calculator className="h-4 w-4" />}
        />
      </div>

      {(hasConfidence || confidenceNote || failure_reasons.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          {hasConfidence && (
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/35">
                <FileCheck2 className="h-3.5 w-3.5" />
                Score
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Score label="Calculated" value={calculatedValue.toFixed(1)} />
                <Score label="Final" value={safeValue.toFixed(1)} highlight={safeValue >= 80} />
              </div>
            </div>
          )}

          <div className={cn(
            "rounded-xl border p-3",
            failure_reasons.length > 0
              ? "border-red-400/20 bg-red-400/[0.08]"
              : "border-white/[0.07] bg-white/[0.035]"
          )}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
              Notes
            </p>
            {failure_reasons.length > 0 ? (
              <ul className="space-y-1">
                {failure_reasons.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-red-200/82">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs leading-relaxed text-white/48">
                {confidenceNote || "All available readiness signals are aligned for settlement review."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Score({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2">
      <p className="ui-eyebrow mb-1 text-white/28">{label}</p>
      <p className={cn("font-mono text-sm font-bold", highlight ? "text-emerald-300" : "text-white/74")}>
        {value}%
      </p>
    </div>
  );
}
