"use client";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  ListChecks,
  ShieldAlert,
  TimerReset,
} from "lucide-react";
import type { DashboardKPIs, PipelineStages } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";
import type { CSSProperties, ElementType } from "react";

type StageMeta = {
  key: keyof PipelineStages;
  label: string;
  intent: string;
  color: string;
  href: string;
};

type StageWithCount = StageMeta & { count: number };

const STAGE_META: StageMeta[] = [
  { key: "ingestion",   label: "Intake",        intent: "new arrivals",      color: "#5eead4", href: "/claims?status=RECEIVED" },
  { key: "processing",  label: "Processing",    intent: "engine workload",   color: "#fb923c", href: "/claims?status=PROCESSING" },
  { key: "risk_review", label: "Manual Review", intent: "human queue",       color: "#a78bfa", href: "/hitl" },
  { key: "settled",     label: "Closed",        intent: "completed claims",  color: "#38bdf8", href: "/claims?status=SETTLED" },
  { key: "denied",      label: "Exceptions",    intent: "blocked or denied", color: "#fca5a5", href: "/claims?status=DENIED" },
];

interface Props {
  stages?: PipelineStages;
  kpis?: DashboardKPIs;
  isLoading: boolean;
}

function formatNumber(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "0";
  return Number(value).toLocaleString();
}

function clampPercent(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.min(100, Math.max(0, Number(value)));
}

function formatPercent(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "0%";
  const pct = clampPercent(value);
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function formatDuration(ms?: number | null) {
  if (!Number.isFinite(ms ?? NaN) || Number(ms) <= 0) return "0.0s";
  const seconds = Number(ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function stageCount(stages: PipelineStages | undefined, key: keyof PipelineStages) {
  return stages?.[key] ?? 0;
}

function topDenialReason(kpis?: DashboardKPIs) {
  const first = kpis?.top_denial_reasons?.[0];
  if (!first) return "No dominant denial reason";
  return `${first.reason} (${first.count})`;
}

function getBottleneck(stages?: PipelineStages) {
  const workStages = STAGE_META.filter((stage) => stage.key !== "settled");
  return workStages.reduce<StageWithCount>(
    (current, stage) => {
      const count = stageCount(stages, stage.key);
      return count > current.count ? { ...stage, count } : current;
    },
    { ...workStages[0], count: stageCount(stages, workStages[0].key) }
  );
}

function getActionPlan(kpis?: DashboardKPIs, stages?: PipelineStages) {
  const pendingReview = kpis?.pending_hitl_count ?? stageCount(stages, "risk_review");
  const overdueReview = kpis?.overdue_hitl_count ?? 0;
  const avgMs = kpis?.avg_processing_ms ?? kpis?.avg_processing_time_ms ?? 0;
  const autoRate = clampPercent(kpis?.auto_adjudication_rate);
  const denied = stageCount(stages, "denied");
  const ingestion = stageCount(stages, "ingestion");

  if (overdueReview > 0) {
    return {
      tone: "risk",
      title: "Clear overdue manual reviews",
      body: `${overdueReview} overdue item${overdueReview === 1 ? "" : "s"} can breach turnaround commitments.`,
      href: "/hitl",
      cta: "Open Review Queue",
    };
  }
  if (pendingReview > 0) {
    return {
      tone: "attention",
      title: "Reduce manual review pressure",
      body: `${pendingReview} claim${pendingReview === 1 ? "" : "s"} need reviewer decision before closure.`,
      href: "/hitl",
      cta: "Review Queue",
    };
  }
  if (avgMs > 3000) {
    return {
      tone: "attention",
      title: "Investigate processing delay",
      body: `Average processing is ${formatDuration(avgMs)}. Check service health before more intake.`,
      href: "/admin#operations-support",
      cta: "Service Health",
    };
  }
  if (autoRate > 0 && autoRate < 80) {
    return {
      tone: "attention",
      title: "Tune rules and policy coverage",
      body: `Automation yield is ${formatPercent(autoRate)}. Review frequent exception reasons.`,
      href: "/admin#policies",
      cta: "Policy Controls",
    };
  }
  if (denied > 0) {
    return {
      tone: "observe",
      title: "Audit blocked decisions",
      body: `${denied} blocked or denied claim${denied === 1 ? "" : "s"} should be sampled for policy consistency.`,
      href: "/reports",
      cta: "Open Reports",
    };
  }
  if (ingestion > 0) {
    return {
      tone: "observe",
      title: "Watch intake freshness",
      body: `${ingestion} claim${ingestion === 1 ? "" : "s"} just entered the system. No queue pressure yet.`,
      href: "/operations/lifecycle",
      cta: "Claim Journey",
    };
  }
  return {
    tone: "healthy",
    title: "No operational blocker detected",
    body: "Queue, delay, and exception signals are currently within normal range.",
    href: "/operations/lifecycle",
    cta: "Monitor Journey",
  };
}

function SignalCard({
  icon: Icon,
  label,
  value,
  helper,
  color,
  urgent,
  loading,
}: {
  icon: ElementType;
  label: string;
  value: string;
  helper: string;
  color: string;
  urgent?: boolean;
  loading: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.15rem] border border-white/[0.08] bg-white/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
            {label}
          </p>
          {loading ? (
            <div className="mt-3 h-7 w-20 animate-pulse rounded-lg bg-white/10" />
          ) : (
            <p className="mt-2 text-2xl font-black leading-none text-white tabular-nums">
              {value}
            </p>
          )}
        </div>
        <span
          className={cn(
            "rounded-xl border p-2",
            urgent ? "border-amber-300/25 bg-amber-300/10" : "border-white/10 bg-white/[0.04]"
          )}
          style={{ color }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 min-h-[2rem] text-[10px] font-medium leading-4 text-white/38">
        {helper}
      </p>
    </div>
  );
}

export function PipelineFlow({ stages, kpis, isLoading }: Props) {
  const safeStages: PipelineStages = stages ?? {
    ingestion: 0,
    processing: 0,
    risk_review: 0,
    settled: 0,
    denied: 0,
  };
  const total = Object.values(safeStages).reduce((a, b) => a + b, 0);
  const workInFlight = safeStages.ingestion + safeStages.processing + safeStages.risk_review;
  const bottleneck = getBottleneck(safeStages);
  const pendingReview = kpis?.pending_hitl_count ?? safeStages.risk_review;
  const overdueReview = kpis?.overdue_hitl_count ?? 0;
  const avgMs = kpis?.avg_processing_ms ?? kpis?.avg_processing_time_ms ?? 0;
  const autoRate = clampPercent(kpis?.auto_adjudication_rate);
  const denialRate = clampPercent(kpis?.denial_rate);
  const action = getActionPlan(kpis, safeStages);
  const actionToneClass =
    action.tone === "risk"
      ? "border-red-300/20 bg-red-300/[0.07] text-red-100"
      : action.tone === "attention"
      ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-100"
      : action.tone === "healthy"
      ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100"
      : "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-100";

  return (
    <Card variant="dashboard" className="h-auto min-h-[260px]">
      <CardAccent className="bg-gradient-to-r from-cyan-300/0 via-cyan-300/55 to-fuchsia-300/0" />
      <CardGlow className="-bottom-10 -right-10 bg-cyan-300/[0.18]" />
      <CardGlow className="-top-16 left-16 bg-fuchsia-300/[0.12]" />

      <div className="relative p-5 sm:p-6">
        <div className="dashboard-panel-header mb-5">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35 leading-none">
              Pipeline Control Signals
            </p>
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/25 tabular-nums">
            {isLoading ? "..." : `${formatNumber(total)} claims in scope`}
          </span>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <SignalCard
                icon={Activity}
                label="Bottleneck"
                value={isLoading ? "" : bottleneck.label}
                helper={isLoading ? "Finding active pressure point" : `${formatNumber(bottleneck.count)} ${bottleneck.intent}`}
                color={bottleneck.color}
                urgent={bottleneck.count > 0 && bottleneck.key !== "settled"}
                loading={isLoading}
              />
              <SignalCard
                icon={ListChecks}
                label="Review Pressure"
                value={isLoading ? "" : formatNumber(pendingReview)}
                helper={overdueReview > 0 ? `${overdueReview} overdue decision${overdueReview === 1 ? "" : "s"}` : "manual queue waiting for action"}
                color="#fbbf24"
                urgent={pendingReview > 0}
                loading={isLoading}
              />
              <SignalCard
                icon={Gauge}
                label="Automation Yield"
                value={isLoading ? "" : formatPercent(autoRate)}
                helper={`average closure time ${formatDuration(avgMs)}`}
                color="#22d3ee"
                urgent={!isLoading && autoRate > 0 && autoRate < 80}
                loading={isLoading}
              />
              <SignalCard
                icon={ShieldAlert}
                label="Exception Trend"
                value={isLoading ? "" : formatPercent(denialRate)}
                helper={topDenialReason(kpis)}
                color="#fb7185"
                urgent={(safeStages.denied ?? 0) > 0}
                loading={isLoading}
              />
            </div>

            <div className="rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.018)),rgba(9,10,13,0.82)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                    Workload Shape
                  </p>
                  <p className="mt-1 text-xs font-medium text-white/42">
                    Shows where work is accumulating, instead of repeating headline totals.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                  {formatNumber(workInFlight)} active
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.045] p-1">
                <div className="flex h-4 overflow-hidden rounded-full">
                  {STAGE_META.map((stage) => {
                    const count = safeStages[stage.key] ?? 0;
                    const width = total > 0 ? Math.max(count > 0 ? 3 : 0, (count / total) * 100) : 0;
                    return (
                      <Link
                        key={stage.key}
                        href={stage.href}
                        className="group relative transition-[filter] duration-200 hover:brightness-125"
                        style={{
                          width: `${width}%`,
                          background: `linear-gradient(90deg, ${stage.color}, ${stage.color}aa)`,
                        } as CSSProperties}
                        title={`${stage.label}: ${count}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {STAGE_META.map((stage) => {
                  const count = safeStages[stage.key] ?? 0;
                  return (
                    <Link
                      key={stage.key}
                      href={stage.href}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                    >
                      <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/42">
                        <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
                        {stage.label}
                      </span>
                      <span className="mt-1 block text-xs font-bold text-white/72 tabular-nums">
                        {formatNumber(count)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={cn("flex min-h-full flex-col rounded-[1.35rem] border p-4", actionToneClass)}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] opacity-55">
                  Recommended Next Action
                </p>
                <h3 className="mt-2 text-xl font-black leading-tight text-white">
                  {isLoading ? "Reading control signals" : action.title}
                </h3>
              </div>
              <span className="rounded-2xl border border-white/10 bg-black/20 p-2.5 text-white/70">
                {action.tone === "risk" ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : action.tone === "healthy" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <TimerReset className="h-5 w-5" />
                )}
              </span>
            </div>

            <p className="mt-3 text-sm font-medium leading-6 text-white/62">
              {isLoading ? "Preparing a live recommendation from queue, delay, and exception signals." : action.body}
            </p>

            <div className="mt-5 grid gap-2">
              {[
                {
                  label: "Queue health",
                  value: overdueReview > 0 ? `${overdueReview} overdue` : pendingReview > 0 ? `${pendingReview} waiting` : "clear",
                  icon: Clock3,
                },
                {
                  label: "Decision quality",
                  value: `${formatPercent(denialRate)} denial rate`,
                  icon: ShieldAlert,
                },
                {
                  label: "Processing speed",
                  value: formatDuration(avgMs),
                  icon: Gauge,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2">
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/42">
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </span>
                    <span className="text-xs font-bold text-white/76">{item.value}</span>
                  </div>
                );
              })}
            </div>

            <Link
              href={action.href}
              className="mt-auto inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] px-4 text-xs font-black uppercase tracking-[0.16em] text-white transition-colors hover:border-white/20 hover:bg-white/[0.11]"
            >
              {action.cta}
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
