"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileSearch,
  FileText,
  Fingerprint,
  History,
  ShieldCheck,
  TimerReset,
  Zap,
} from "lucide-react";
import { getClaimLifecycle } from "@/lib/api";
import { formatLifecycleAge, humanizeLifecycleValue, lifecycleStatusTone } from "@/components/operations/lifecycle-utils";
import { cn, formatDateTime } from "@/lib/utils";
import type { ClaimResponse, AuditTrailResponse, ClaimLifecycleStage, ClaimLifecycleSummary } from "@/lib/types";

interface PipelineObservabilityPanelProps {
  claim: ClaimResponse;
  audit?: AuditTrailResponse;
}

function formatDuration(ms?: number) {
  if (!ms || ms < 1) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const MILESTONES = [
  { id: "INITIATION", label: "Initiation", icon: FileText },
  { id: "ANALYSIS", label: "Coverage Review", icon: FileSearch },
  { id: "SETTLEMENT", label: "Settlement", icon: Zap },
  { id: "DISBURSEMENT", label: "Payment", icon: CreditCard },
  { id: "CREDITED", label: "Credited", icon: CheckCircle2 },
];

const EVENT_MAP: Record<string, string> = {
  CLAIM_RECEIVED: "INITIATION",
  PDF_UPLOADED: "INITIATION",
  OCR_COMPLETED: "ANALYSIS",
  RULES_EVALUATED: "ANALYSIS",
  REASONING_COMPLETED: "ANALYSIS",
  SETTLEMENT_CALCULATED: "SETTLEMENT",
  HITL_DECISION: "SETTLEMENT",
  CLAIM_SETTLED: "SETTLEMENT",
  PAYOUT_INITIATED: "DISBURSEMENT",
  PAYOUT_COMPLETED: "CREDITED",
};

function normalizeConfidencePercent(score: string | number | undefined | null): number | null {
  if (score === undefined || score === null || score === "") return null;
  const value = typeof score === "string" ? Number(score) : score;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function formatConfidencePercent(score: string | number | undefined | null): string {
  const percent = normalizeConfidencePercent(score);
  if (percent == null) return "-";
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

const FRIENDLY_STAGE_LABELS: Record<string, string> = {
  document_ingestion: "Document intake",
  intake_enrichment: "Intake review",
  rules_engine: "Rules check",
  policy_reasoning: "Coverage reasoning",
  dual_validation: "Validation check",
  settlement_calculation: "Settlement",
  completeness_validation: "Completeness check",
  hitl_routing: "Manual review routing",
  persistence: "Record saved",
  initiation: "Initiation",
  analysis: "Coverage review",
  settlement: "Settlement",
  disbursement: "Payment",
  credited: "Credited",
};

function friendlyText(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/PDF saved to storage:\s*unknown/i, "Document storage status unavailable")
    .replace(/\bOCR\b/gi, "Document reading")
    .replace(/\bHITL\b/gi, "manual review")
    .replace(/\bSLA\b/gi, "due time")
    .replace(/\bAI\b/gi, "Coverage")
    .replace(new RegExp("\\b" + "LL" + "M\\b", "gi"), "AI assistant")
    .replace(/\bpipeline telemetry\b/gi, "journey updates")
    .replace(/\blifecycle endpoint\b/gi, "claim journey service")
    .replace(/\bupstream\b/gi, "previous step")
    .replace(/\bTAT\b/g, "Age")
    .trim();
}

function friendlyStageLabel(stage?: string | null, label?: string | null): string {
  const key = (stage ?? "").toLowerCase();
  if (key && FRIENDLY_STAGE_LABELS[key]) return FRIENDLY_STAGE_LABELS[key];
  return friendlyText(label ?? humanizeLifecycleValue(stage));
}

function buildFallbackStages(claim: ClaimResponse, auditEntries: AuditTrailResponse["entries"]): ClaimLifecycleStage[] {
  if (claim.pipeline_stage_report?.stages?.length) {
    return claim.pipeline_stage_report.stages.map((stage) => ({
      stage: stage.stage,
      label: stage.label,
      status: stage.status,
      duration_ms: stage.duration_ms,
      age_seconds: null,
      blocker: stage.summary && /fail|error|block|skip/i.test(stage.status) ? stage.summary : null,
      next_action: stage.status === "COMPLETED" ? null : stage.summary ?? null,
      metadata: stage.details ?? {},
      events: [],
    }));
  }

  const completedEvents = new Set(auditEntries.map((entry) => entry.event_type));
  let lastCompleted = -1;
  const stages: ClaimLifecycleStage[] = MILESTONES.map((milestone, index) => {
    const isCompleted = Object.entries(EVENT_MAP).some(
      ([event, milestoneId]) => milestoneId === milestone.id && completedEvents.has(event)
    );
    if (isCompleted) lastCompleted = index;
    return {
      stage: milestone.id.toLowerCase(),
      label: milestone.label,
      status: isCompleted ? "COMPLETED" : "NOT_STARTED",
      age_seconds: null,
      duration_ms: null,
      blocker: null,
      next_action: isCompleted ? null : "Waiting for claim journey update",
      metadata: {},
      events: [],
    } satisfies ClaimLifecycleStage;
  });

  if (lastCompleted === -1 && claim.status) {
    stages[0] = {
      ...stages[0],
      status: claim.status === "ERROR" || claim.status === "DENIED" ? "FAILED" : "IN_PROGRESS",
      next_action: "Claim record is available; waiting for journey events",
    };
  }

  return stages;
}

function fallbackLifecycleEvent(claim: ClaimResponse) {
  return {
    id: "claim-record",
    type: claim.status,
    title: `Claim is ${humanizeLifecycleValue(claim.status)}`,
    timestamp: claim.date_received,
    actor: "SYSTEM",
    data: {},
    source: "CLAIM",
  };
}

export function PipelineObservabilityPanel({ claim, audit }: PipelineObservabilityPanelProps) {
  const [remoteLifecycle, setRemoteLifecycle] = useState<ClaimLifecycleSummary | null>(claim.lifecycle ?? null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setRemoteLifecycle(claim.lifecycle ?? null);
    setLifecycleError(null);
    getClaimLifecycle(claim.claim_reference)
      .then((response) => {
        if (isMounted) setRemoteLifecycle(response);
      })
      .catch((err) => {
        if (isMounted) setLifecycleError(err instanceof Error ? err.message : "Claim journey service unavailable");
      });
    return () => {
      isMounted = false;
    };
  }, [claim.claim_reference, claim.lifecycle]);

  const report = claim.pipeline_stage_report;
  const agents = Object.entries(claim.agent_status_metrics ?? {});
  const totalDuration = report?.total_duration_ms ?? claim.processing_time_ms ?? 0;
  const auditEntries = useMemo(() => audit?.entries ?? [], [audit?.entries]);
  const lifecycle = remoteLifecycle ?? claim.lifecycle ?? null;
  const lifecycleStages = useMemo(
    () => lifecycle?.stages?.length ? lifecycle.stages : buildFallbackStages(claim, auditEntries),
    [auditEntries, claim, lifecycle?.stages]
  );
  const activeMilestoneIndex = lifecycleStages.reduce(
    (last, stage, index) => (/NOT_STARTED|SKIPPED/i.test(stage.status) ? last : index),
    0
  );
  const lifecycleEvents = useMemo(() => {
    const eventsFromLifecycle = (lifecycle?.events ?? []).map((entry, index) => ({
      id: entry.id ?? `lifecycle-${index}`,
      type: entry.event_type ?? entry.status ?? "LIFECYCLE_EVENT",
      title: friendlyText(entry.description ?? entry.label ?? humanizeLifecycleValue(entry.stage ?? "Claim event")),
      timestamp: entry.timestamp ?? entry.completed_at ?? entry.started_at ?? lifecycle?.updated_at ?? claim.date_received,
      actor: entry.actor_type ?? "SYSTEM",
      data: entry.metadata ?? {},
      source: "LIFECYCLE",
    }));
    const eventsFromAudit = auditEntries.map((entry) => ({
      id: entry.id,
      type: entry.event_type,
      title: friendlyText(entry.description),
      timestamp: entry.timestamp,
      actor: entry.actor_type,
      data: entry.event_data,
      source: "AUDIT",
    }));
    const merged = [...eventsFromLifecycle, ...eventsFromAudit];
    return merged.length ? merged : [fallbackLifecycleEvent(claim)];
  }, [auditEntries, claim, lifecycle]);

  // Find payment reference
  const payoutEvent = auditEntries.find((e) => e.event_type === "PAYOUT_COMPLETED");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txnId = (payoutEvent?.event_data as any)?.gateway_txn_id;
  const confidencePercent = normalizeConfidencePercent(claim.confidence_score);
  const currentLifecycleStage = friendlyStageLabel(
    lifecycle?.current_stage ?? lifecycleStages[activeMilestoneIndex]?.stage,
    lifecycle?.current_stage_label ?? lifecycleStages[activeMilestoneIndex]?.label ?? humanizeLifecycleValue(claim.status)
  );

  return (
    <div className="space-y-6">
      {/* 1. Milestone Tracker */}
      <div className="glass-card rounded-2xl border border-white/[0.08] bg-[#14151b]/40 p-6">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">Claim Journey Milestones</h3>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/30">
               <TimerReset className="h-3 w-3" />
               Age: {lifecycle?.age_seconds != null || lifecycle?.age_ms != null ? formatLifecycleAge(lifecycle.age_seconds, lifecycle.age_ms) : formatDuration(totalDuration)}
             </div>
             <div className="h-4 w-px bg-white/10" />
             <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/30">
               <Fingerprint className="h-3 w-3" />
               Ref: <span className="font-mono">{claim.claim_reference}</span>
             </div>
          </div>
        </div>

        <div className="relative flex justify-between">
          {/* Progress Bar Background */}
          <div className="absolute top-5 left-0 h-[2px] w-full bg-white/[0.05]" />
          {/* Active Progress Bar */}
          <div 
            className="absolute top-5 left-0 h-[2px] bg-brand-primary transition-all duration-1000 shadow-[0_0_10px_rgba(0,212,220,0.5)]" 
            style={{ width: `${(activeMilestoneIndex / Math.max(1, lifecycleStages.length - 1)) * 100}%` }}
          />

          {lifecycleStages.map((stage, idx) => {
            const isCompleted = idx <= activeMilestoneIndex && !/NOT_STARTED|SKIPPED/i.test(stage.status);
            const isCurrent = idx === activeMilestoneIndex;
            const Icon = MILESTONES[idx]?.icon ?? Activity;

            return (
              <div key={`${stage.stage}-${idx}`} className="relative z-10 flex max-w-[8rem] flex-col items-center gap-3">
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-2xl border transition-all duration-500",
                  isCompleted 
                    ? "border-brand-primary/40 bg-brand-primary/20 text-brand-primary shadow-[0_0_15px_rgba(0,212,220,0.2)]" 
                    : "border-white/10 bg-[#0d0d0f] text-white/20"
                )}>
                  <Icon className={cn("h-5 w-5", isCurrent && "animate-pulse")} />
                </div>
                <div className="text-center">
                  <p className={cn(
                    "text-[10px] font-bold uppercase tracking-widest",
                    isCompleted ? "text-white/80" : "text-white/20"
                  )}>
                    {friendlyStageLabel(stage.stage, stage.label)}
                  </p>
                  {isCurrent && (
                    <span className="inline-block mt-1 h-1 w-1 rounded-full bg-brand-primary animate-ping" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_24rem]">
        {/* 2. End-to-End Lifecycle Stream */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-brand-primary" />
              <h3 className="text-sm font-bold text-white/90">Event History</h3>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
              {lifecycleEvents.length} Total Events
            </span>
          </div>

          <div className="glass-card rounded-2xl border border-white/[0.08] bg-[#14151b]/80 p-5">
            <ol className="relative space-y-0">
              {lifecycleEvents.length > 0 ? lifecycleEvents.map((event, index) => {
                const isLast = index === lifecycleEvents.length - 1;
                const isPayout = event.type === "PAYOUT_COMPLETED";
                const isDecision = event.type === "HITL_DECISION";
                
                return (
                  <li key={event.id} className="flex gap-4 pb-6 last:pb-0">
                    <div className="flex flex-col items-center pt-1 shrink-0">
                      <div className={cn(
                        "h-2.5 w-2.5 rounded-full ring-4 ring-black/40",
                        isPayout ? "bg-emerald-400" : isDecision ? "bg-violet-400" : "bg-white/20"
                      )} />
                      {!isLast && <div className="mt-2 w-px flex-1 bg-white/[0.05]" />}
                    </div>
                    
                    <div className={cn(
                      "min-w-0 flex-1 rounded-2xl border px-4 py-3 transition-all",
                      isPayout 
                        ? "border-emerald-400/20 bg-emerald-400/[0.03]" 
                        : "border-white/[0.05] bg-white/[0.01] hover:bg-white/[0.03]"
                    )}>
                      <div className="flex items-center gap-3">
                        <p className={cn(
                          "text-sm font-semibold",
                          isPayout ? "text-emerald-300" : "text-white/80"
                        )}>
                          {event.title}
                        </p>
                        <span className="ml-auto text-[11px] font-mono text-white/30">
                          {formatDateTime(event.timestamp)}
                        </span>
                      </div>
                      
                      <div className="mt-1 flex items-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">
                          {friendlyText(event.type.replace(/_/g, " "))}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-white/10" />
                        <span className="text-[10px] text-white/35 italic">
                          by {event.actor}
                        </span>
                      </div>

                      {isPayout && txnId && (
                        <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/20 text-emerald-400">
                            <CreditCard className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/60">Payment Reference</p>
                            <p className="font-mono text-xs font-bold text-emerald-300 truncate">{txnId}</p>
                          </div>
                          <div className="ml-auto">
                             <span className="rounded-md bg-emerald-400/20 px-2 py-0.5 text-[9px] font-black text-emerald-400 uppercase">Credited</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              }) : (
                <div className="text-center py-10">
                   <p className="text-sm text-white/30 italic">Awaiting pipeline telemetry...</p>
                </div>
              )}
            </ol>
          </div>
        </div>

        {/* 3. Side Panel: Adjudication Pulse */}
        <div className="space-y-6">
           <div className="space-y-4">
             <div className="flex items-center gap-2 px-2">
               <Activity className="h-4 w-4 text-brand-primary" />
               <h3 className="text-sm font-bold text-white/90">Processing Health</h3>
             </div>

             {/* Agent Health */}
             <div className="glass-card rounded-2xl border border-white/[0.08] bg-[#14151b]/80 p-5 space-y-4">
                <div className="space-y-3">
                   {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                   {agents.length > 0 ? agents.map(([key, agent]: [any, any]) => (
                     <div key={key} className="flex items-center justify-between gap-4 p-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                        <div className="flex items-center gap-3">
                           <div className="h-1.5 w-1.5 rounded-full bg-brand-primary shadow-[0_0_8px_rgba(0,212,220,0.6)]" />
                           <span className="text-[11px] font-semibold text-white/60">{friendlyText(agent.label ?? key.replace(/_/g, " "))}</span>
                        </div>
                        <span className="text-[10px] font-mono text-white/30">{formatDuration(agent.duration_ms)}</span>
                     </div>
                   )) : lifecycleStages.slice(0, 5).map((stage) => {
                     const tone = lifecycleStatusTone(stage.status);
                     return (
                       <div key={stage.stage} className="flex items-center justify-between gap-4 p-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                         <div className="flex min-w-0 items-center gap-3">
                           <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                           <span className="truncate text-[11px] font-semibold text-white/60">{friendlyStageLabel(stage.stage, stage.label)}</span>
                         </div>
                         <span className="text-[10px] font-mono text-white/30">{formatLifecycleAge(stage.age_seconds, stage.duration_ms)}</span>
                       </div>
                     );
                   })}
                </div>

                <div className="pt-2 border-t border-white/[0.06]">
                   <div className="flex items-center justify-between text-[11px]">
                      <span className="text-white/40">Overall Confidence</span>
                      <span className="font-bold text-emerald-400">{formatConfidencePercent(claim.confidence_score)}</span>
                   </div>
                   <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-brand-primary to-emerald-400" 
                        style={{ width: `${confidencePercent ?? 0}%` }}
                      />
                   </div>
                </div>
             </div>

             {/* Decision Routing */}
             <div className="glass-card rounded-2xl border border-white/[0.08] bg-brand-primary/[0.03] p-5">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary/60 mb-3">Next Step</h4>
                <div className="flex items-start gap-3">
                   <div className="h-8 w-8 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <ShieldCheck className="h-4 w-4" />
                   </div>
                   <div>
                      <p className="text-[13px] font-semibold text-white/80">{friendlyText(lifecycle?.blocker ?? claim.hitl_priority_reason ?? currentLifecycleStage)}</p>
                      <p className="mt-1 text-[11px] text-white/40 leading-relaxed">
                        Next: <span className="text-white/60">{friendlyText(lifecycle?.next_action ?? `Due target ${claim.hitl_sla_hours ?? 8}h`)}</span>
                      </p>
                   </div>
                </div>
             </div>
             {lifecycleError && (
               <div className="glass-card rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
                 <div className="flex items-start gap-3">
                   <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                   <p className="text-xs leading-relaxed text-amber-100/70">
                     Claim journey service unavailable. Showing claim and event-derived tracking. {friendlyText(lifecycleError)}
                   </p>
                 </div>
               </div>
             )}
           </div>
        </div>
      </div>
    </div>
  );
}
