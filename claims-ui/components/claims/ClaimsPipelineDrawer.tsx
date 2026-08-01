"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  History,
  Info,
  LayoutGrid,
  ListTodo,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  User,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { LifecycleStatusPill, formatLifecycleAge, humanizeLifecycleValue, lifecycleStatusTone } from "@/components/operations/lifecycle-utils";
import { getClaimAudit, getClaimLifecycle } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AuditLogEntry, AuditTrailResponse, ClaimLifecycleStage, ClaimLifecycleSummary } from "@/lib/types";

interface ClaimsPipelineDrawerProps {
  claimRef: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENT_LABELS: Record<string, string> = {
  CLAIM_SUBMITTED: "Submitted",
  DOCUMENT_UPLOADED: "Document Received",
  OCR_COMPLETED: "Document Reading Complete",
  RULES_EVALUATED: "Rules Checked",
  AI_ANALYSIS_COMPLETED: "Coverage Review",
  SETTLEMENT_CALCULATED: "Settlement",
  CONFIDENCE_SCORED: "Confidence",
  HITL_ROUTED: "Manual Review",
  SETTLEMENT_APPROVED: "Approved",
  CLAIM_SETTLED: "Settled",
  CLAIM_DENIED: "Denied",
  PAYOUT_INITIATED: "Payout Started",
  PAYOUT_PROCESSING: "Payout Processing",
  PAYOUT_COMPLETED: "Payment Credited",
  PAYOUT_FAILED: "Payout Failed",
};

type PipelineView = "lifecycle" | "flow" | "bento" | "audit";
type DepartmentId = "Processing" | "Approval" | "Payment" | "Audit";
type EventType = "success" | "warning" | "user" | "info";

interface PipelineEvent {
  id: number;
  dept: DepartmentId;
  label: string;
  time: string;
  actor: string;
  service: string;
  details: string;
  type: EventType;
  entry: AuditLogEntry;
}

const DEPARTMENTS: Array<{
  id: DepartmentId;
  label: string;
  icon: typeof Activity;
  desc: string;
  shell: string;
  iconClass: string;
  dot: string;
}> = [
  {
    id: "Processing",
    label: "Processing",
    icon: Activity,
    desc: "Document intake",
    shell: "border-cyan-400/30 bg-cyan-400/10",
    iconClass: "text-cyan-300",
    dot: "bg-cyan-400",
  },
  {
    id: "Approval",
    label: "Review",
    icon: ShieldCheck,
    desc: "Coverage checks",
    shell: "border-amber-400/30 bg-amber-400/10",
    iconClass: "text-amber-300",
    dot: "bg-amber-400",
  },
  {
    id: "Payment",
    label: "Payment",
    icon: CreditCard,
    desc: "Settlement and payout",
    shell: "border-emerald-400/30 bg-emerald-400/10",
    iconClass: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  {
    id: "Audit",
    label: "Controls",
    icon: ShieldAlert,
    desc: "Compliance records",
    shell: "border-fuchsia-400/30 bg-fuchsia-400/10",
    iconClass: "text-fuchsia-300",
    dot: "bg-fuchsia-400",
  },
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(from?: string, to?: string): string {
  if (!from || !to) return "-";
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "-";
  if (diff < 1000) return "<1s";
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
}

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");
}

function departmentLabel(id: DepartmentId): string {
  return DEPARTMENTS.find((dept) => dept.id === id)?.label ?? id;
}

const FRIENDLY_STAGE_LABELS: Record<string, string> = {
  submitted: "Claim submitted",
  intake: "Intake review",
  ocr: "Document reading",
  validation: "Coverage check",
  adjudication: "Decision review",
  human_review: "Manual review",
  settlement: "Settlement",
  account: "Bank check",
  payout: "Payment",
  closure: "Closure",
  document_ingestion: "Document intake",
  intake_enrichment: "Intake review",
  rules_engine: "Rules check",
  ai_reasoning: "Coverage reasoning",
  hitl_routing: "Manual review routing",
  persistence: "Record saved",
};

function friendlyStageLabel(stage?: string | null, label?: string | null): string {
  const key = (stage ?? "").toLowerCase();
  if (key && FRIENDLY_STAGE_LABELS[key]) return FRIENDLY_STAGE_LABELS[key];
  if (!label) return "Claim step";
  return label
    .replace(/\bOCR\b/gi, "Document reading")
    .replace(/\bHITL\b/gi, "Manual review")
    .replace(/\bAI\b/gi, "Coverage")
    .replace(new RegExp("\\b" + "LL" + "M\\b", "gi"), "AI assistant");
}

function friendlyMetaLabel(stage?: string | null): string {
  const value = humanizeLifecycleValue(stage).replace(/\bAi\b/g, "Coverage").replace(/\bHitl\b/g, "Manual review");
  if (value === "Unknown" || value === "-") return "Tracked step";
  if (/Persistence/i.test(value)) return "Record saved";
  return value;
}

function friendlyTimingLabel(value?: string | null): string {
  if (!value || value === "-") return "Not started";
  if (/unknown/i.test(value)) return "Target not set";
  if (/sla/i.test(value)) return value.replace(/\bSLA\b/g, "Due time");
  return value;
}

function friendlyActionText(value?: string | null, fallback = "No action needed"): string {
  if (!value) return fallback;
  return value
    .replace(/\bupstream\b/gi, "previous step")
    .replace(/\blifecycle event\b/gi, "stage update")
    .replace(/\boperator\b/gi, "team")
    .replace(/\bHITL\b/gi, "manual review")
    .replace(/\bSLA\b/gi, "due time");
}

function eventDepartment(eventType: string, serviceName?: string): DepartmentId {
  const event = eventType.toUpperCase();
  const service = (serviceName ?? "").toUpperCase();
  if (/PAYOUT|PAYMENT|DISBURSEMENT|SETTLEMENT|GATEWAY/.test(event) || /PAYMENT|GATEWAY/.test(service)) return "Payment";
  if (/AUDIT|ACCOUNT|COMPLIANCE|VERIFIED|REJECTED/.test(event) || /COMPLIANCE/.test(service)) return "Audit";
  if (/RULES|AI|VALIDATION|MEMBER|POLICY|HITL|APPROVED|DENIED|CONFIDENCE/.test(event)) return "Approval";
  return "Processing";
}

function eventType(entry: AuditLogEntry, index: number): EventType {
  if (/FAILED|ERROR|DENIED|REJECTED/.test(entry.event_type)) return "warning";
  if (entry.actor_type === "USER") return "user";
  if (/PENDING|PROCESSING|ROUTED|MATCH|EVALUATED|CONFIDENCE/.test(entry.event_type)) return "info";
  if (index === 0) return "info";
  return "success";
}

function mapPipelineEvents(entries: AuditLogEntry[]): PipelineEvent[] {
  return entries.map((entry, index) => ({
    id: index + 1,
    dept: eventDepartment(entry.event_type, entry.service_name),
    label: eventLabel(entry.event_type),
    time: formatDateTime(entry.timestamp),
    actor: entry.actor_type || "SYSTEM",
    service: entry.service_name || "claim_pipeline",
    details: entry.description || JSON.stringify(entry.event_data ?? {}),
    type: eventType(entry, index),
    entry,
  }));
}

function typeStyles(type: EventType) {
  if (type === "success") {
    return { bg: "bg-emerald-400/10", text: "text-emerald-300", border: "border-emerald-400/25", icon: CheckCircle2 };
  }
  if (type === "warning") {
    return { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/25", icon: AlertCircle };
  }
  if (type === "user") {
    return { bg: "bg-fuchsia-400/10", text: "text-fuchsia-300", border: "border-fuchsia-400/25", icon: User };
  }
  return { bg: "bg-cyan-400/10", text: "text-cyan-300", border: "border-cyan-400/25", icon: Info };
}

function escapeCsvValue(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function exportPipeline(claimRef: string, audit: AuditTrailResponse | null, lifecycle: ClaimLifecycleSummary | null) {
  const headers = [
    "Claim Reference",
    "Source",
    "Sequence",
    "Stage",
    "Status",
    "Event Type",
    "Event Label",
    "Timestamp",
    "Actor Type",
    "Actor ID",
    "Service",
    "Description",
    "Age Seconds",
    "Blocker",
    "Next Action",
    "Event Data",
    "Entry Hash",
  ];
  const lifecycleStageRows = (lifecycle?.stages ?? []).map((stage, index) => [
    claimRef,
    "LIFECYCLE_STAGE",
    index + 1,
    stage.stage,
    stage.status,
    "STAGE_STATUS",
    stage.label,
    stage.updated_at ?? stage.completed_at ?? stage.started_at ?? "",
    "",
    "",
    "",
    stage.blocker ?? "",
    stage.next_action ?? "",
    JSON.stringify(stage.metadata ?? {}),
    "",
  ]);
  const lifecycleEventRows = (lifecycle?.events ?? []).map((event, index) => [
    claimRef,
    "LIFECYCLE_EVENT",
    index + 1,
    event.stage ?? "",
    event.status ?? "",
    event.event_type ?? "EVENT",
    event.label ?? "",
    event.timestamp ?? "",
    event.actor_type ?? "",
    event.actor_id ?? "",
    event.service_name ?? "",
    event.age_seconds ?? "",
    event.blocker ?? "",
    event.next_action ?? "",
    JSON.stringify(event.metadata ?? {}),
    "",
  ]);
  const auditRows = (audit?.entries ?? []).map((entry, index) => [
    claimRef,
    "AUDIT",
    index + 1,
    "",
    "",
    entry.event_type,
    eventLabel(entry.event_type),
    entry.timestamp,
    entry.actor_type,
    entry.actor_id ?? "",
    entry.service_name,
    entry.description,
    "",
    "",
    "",
    JSON.stringify(entry.event_data ?? {}),
    entry.entry_hash,
  ]);
  const csv = [headers, ...lifecycleStageRows, ...lifecycleEventRows, ...auditRows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `claim-journey-${claimRef}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function PipelineViewToggle({ view, setView }: { view: PipelineView; setView: (view: PipelineView) => void }) {
  const options: Array<{ id: PipelineView; label: string; icon: typeof ListTodo }> = [
    { id: "lifecycle", label: "Journey", icon: Activity },
    { id: "flow", label: "Steps", icon: ListTodo },
    { id: "bento", label: "Board", icon: LayoutGrid },
    { id: "audit", label: "Events", icon: History },
  ];

  return (
    <div className="flex overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/30 p-1 shadow-inner [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setView(option.id)}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-black transition-colors",
            view === option.id
              ? "bg-cyan-500 text-white shadow-lg shadow-cyan-950/20"
              : "text-white/42 hover:bg-white/[0.06] hover:text-white/72"
          )}
        >
          <option.icon className="h-3.5 w-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PipelineFlow({ events }: { events: PipelineEvent[] }) {
  return (
    <div className="space-y-10 py-2">
      {DEPARTMENTS.map((dept) => {
        const deptEvents = events.filter((event) => event.dept === dept.id);
        if (!deptEvents.length) return null;
        return (
          <section key={dept.id} className="relative">
            <div className="sticky top-0 z-10 mb-5 flex items-center gap-4 bg-[var(--bg-card)]/95 py-2 backdrop-blur-xl">
              <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border", dept.shell)}>
                <dept.icon className={cn("h-5 w-5", dept.iconClass)} />
              </div>
              <div>
                <h2 className="text-lg font-black text-text-primary">{dept.label}</h2>
                <p className="ui-eyebrow text-text-muted">{dept.desc}</p>
              </div>
            </div>

            <div className="ml-6 space-y-4 border-l-2 border-white/[0.08] pl-8">
              {deptEvents.map((event) => {
                const styles = typeStyles(event.type);
                const Icon = styles.icon;
                return (
                  <article key={event.id} className="group relative">
                    <div className="absolute -left-[42px] top-4 z-20 h-4 w-4 rounded-full border-2 border-white/20 bg-[#090b10] transition-colors group-hover:border-cyan-400" />
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4 shadow-xl transition-colors hover:border-white/[0.16]">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon className={cn("h-4 w-4 shrink-0", styles.text)} />
                          <h3 className="truncate text-sm font-black text-white">{event.label}</h3>
                        </div>
                        <span className="font-mono text-[10px] text-white/36">{event.time}</span>
                      </div>
                      <p className="rounded-xl border border-white/[0.05] bg-black/24 p-2 font-mono text-xs leading-relaxed text-white/52">
                        {event.details}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PipelineBento({ events }: { events: PipelineEvent[] }) {
  return (
    <div className="grid gap-5 py-2 lg:grid-cols-2">
      {DEPARTMENTS.map((dept) => {
        const deptEvents = events.filter((event) => event.dept === dept.id);
        if (!deptEvents.length) return null;
        return (
          <section key={dept.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035]">
            <div className={cn("h-1.5", dept.dot)} />
            <div className="p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <dept.icon className={cn("h-5 w-5", dept.iconClass)} />
                  <h3 className="text-lg font-black text-white">{dept.label}</h3>
                </div>
                <span className="rounded-full border border-white/[0.08] bg-black/24 px-2 py-1 text-[10px] font-bold text-white/45">
                  {deptEvents.length} Events
                </span>
              </div>

              <div className="space-y-3">
                {deptEvents.map((event) => {
                  const styles = typeStyles(event.type);
                  return (
                    <article key={event.id} className="rounded-xl border border-white/[0.07] bg-black/24 p-3 transition-colors hover:bg-black/36">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-black text-white/82">{event.label}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-black uppercase", styles.bg, styles.text)}>
                          {event.type}
                        </span>
                      </div>
                      <p className="truncate text-[10px] italic text-white/36">{event.details}</p>
                    </article>
                  );
                })}
              </div>
            </div>
            <div className="mt-auto border-t border-white/[0.06] bg-black/16 p-4">
              <div className="flex items-center justify-center gap-2 text-xs font-black text-white/42">
                View Event History <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PipelineAuditLedger({ events }: { events: PipelineEvent[] }) {
  return (
    <div className="py-2">
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left">
            <thead>
              <tr className="border-b border-white/[0.08] bg-black/30">
                {["ID", "Area", "Event & Owner", "Event Details", "Time"].map((head) => (
                  <th key={head} className="p-4 text-[10px] font-black uppercase tracking-[0.16em] text-white/32">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {events.map((event) => {
                const dept = DEPARTMENTS.find((item) => item.id === event.dept) ?? DEPARTMENTS[0];
                return (
                  <tr key={event.id} className="transition-colors hover:bg-cyan-400/[0.04]">
                    <td className="p-4 font-mono text-[10px] text-white/28">#{String(event.id).padStart(3, "0")}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-1.5 w-1.5 rounded-full", dept.dot)} />
                        <span className="text-xs font-black text-white/78">{departmentLabel(event.dept)}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-xs font-black text-white">{event.label}</p>
                      <p className="mt-1 text-[10px] text-white/38">{event.actor} / {event.service}</p>
                    </td>
                    <td className="p-4">
                      <div className="max-w-sm rounded-lg border border-white/[0.06] bg-black/28 p-2">
                        <p className="truncate font-mono text-[10px] text-white/48">{event.details}</p>
                      </div>
                    </td>
                    <td className="p-4 font-mono text-xs text-white/36">{event.time}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const EXPECTED_LIFECYCLE_STAGES: Array<{ stage: string; label: string; auditPattern: RegExp }> = [
  { stage: "submitted", label: "Submitted", auditPattern: /SUBMITTED|RECEIVED|UPLOADED/ },
  { stage: "intake", label: "Intake", auditPattern: /DOCUMENT|INTAKE|UPLOAD/ },
  { stage: "ocr", label: "Document reading", auditPattern: /OCR|EXTRACT/ },
  { stage: "validation", label: "Coverage check", auditPattern: /RULES|VALIDATION|POLICY|MEMBER|PROVIDER/ },
  { stage: "adjudication", label: "Decision review", auditPattern: /AI|REASONING|CONFIDENCE|ADJUDICATION/ },
  { stage: "human_review", label: "Manual review", auditPattern: /HITL|REVIEW|DECISION/ },
  { stage: "settlement", label: "Settlement", auditPattern: /SETTLEMENT|APPROVED|DENIED|CALCULATED/ },
  { stage: "account", label: "Account", auditPattern: /ACCOUNT|BANK|VERIFIED/ },
  { stage: "payout", label: "Payout", auditPattern: /PAYOUT|PAYMENT|DISBURSEMENT/ },
  { stage: "closure", label: "Closure", auditPattern: /CLOSED|SETTLED|COMPLETED/ },
];

function buildLifecycleStages(lifecycle: ClaimLifecycleSummary | null, auditEvents: PipelineEvent[]): ClaimLifecycleStage[] {
  if (lifecycle?.stages?.length) return lifecycle.stages;
  return EXPECTED_LIFECYCLE_STAGES.map((stage) => {
    const matchingEvents = auditEvents.filter((event) => stage.auditPattern.test(event.entry.event_type));
    const failed = matchingEvents.some((event) => /FAILED|ERROR|DENIED|REJECTED/.test(event.entry.event_type));
    const completed = matchingEvents.length > 0;
    return {
      stage: stage.stage,
      label: stage.label,
      status: failed ? "FAILED" : completed ? "COMPLETED" : "NOT_STARTED",
      age_seconds: null,
      duration_ms: null,
      blocker: failed ? matchingEvents[matchingEvents.length - 1]?.details ?? "Review needed" : null,
      next_action: completed ? null : "Waiting for stage update",
      events: matchingEvents.map((event) => ({
        id: String(event.id),
        stage: stage.stage,
        stage_label: stage.label,
        status: event.type === "warning" ? "FAILED" : "COMPLETED",
        event_type: event.entry.event_type,
        label: event.label,
        description: event.details,
        timestamp: event.entry.timestamp,
        actor_type: event.entry.actor_type,
        actor_id: event.entry.actor_id,
        service_name: event.entry.service_name,
        metadata: event.entry.event_data,
      })),
      metadata: {},
    };
  });
}

function PipelineLifecycleView({
  lifecycle,
  auditEvents,
}: {
  lifecycle: ClaimLifecycleSummary | null;
  auditEvents: PipelineEvent[];
}) {
  const stages = buildLifecycleStages(lifecycle, auditEvents);
  return (
    <div className="space-y-5 py-2">
      <div className="grid gap-3 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Current Stage</p>
          <p className="mt-2 text-lg font-black leading-tight text-white">
            {friendlyStageLabel(lifecycle?.current_stage, lifecycle?.current_stage_label ?? stages.find((stage) => stage.status !== "NOT_STARTED")?.label ?? "Event fallback")}
          </p>
          <p className="mt-1 text-xs text-white/38">{friendlyMetaLabel(lifecycle?.current_stage ?? "events")}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Age</p>
          <p className="mt-2 font-mono text-lg font-black text-white">{formatLifecycleAge(lifecycle?.age_seconds, lifecycle?.age_ms)}</p>
          <p className="mt-1 text-xs text-white/38">{lifecycle?.sla_due_at ? `Due ${formatDateTime(lifecycle.sla_due_at)}` : friendlyTimingLabel(lifecycle?.sla_status)}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Next Action</p>
          <p className={cn("mt-2 line-clamp-2 text-sm font-bold", lifecycle?.blocker ? "text-amber-200" : "text-white")}>
            {friendlyActionText(lifecycle?.blocker ?? lifecycle?.next_action, "Continue automated processing")}
          </p>
          <p className="mt-1 text-xs text-white/38">{lifecycle?.blocker ? friendlyActionText(lifecycle?.next_action, "Team action needed") : "Clear"}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
        <div className="border-b border-white/[0.07] bg-black/24 px-5 py-4">
          <p className="text-sm font-black text-white">Claim Journey</p>
          <p className="mt-1 text-xs text-white/36">
            Stage tracking is used first. Event history fills any missing steps so the claim remains traceable.
          </p>
        </div>
        <div className="divide-y divide-white/[0.055]">
          {stages.map((stage, index) => {
            const tone = lifecycleStatusTone(stage.status);
            return (
              <article key={`${stage.stage}-${index}`} className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(240px,0.9fr)_160px_130px_minmax(360px,1.1fr)] xl:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.dot)} />
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white">{friendlyStageLabel(stage.stage, stage.label)}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/28">{friendlyMetaLabel(stage.stage)}</p>
                  </div>
                </div>
                <LifecycleStatusPill status={stage.status} compact />
                <div className="font-mono text-xs font-semibold text-white/58">
                  {friendlyTimingLabel(formatLifecycleAge(stage.age_seconds, stage.duration_ms))}
                </div>
                <div className="min-w-0 text-xs">
                  <p className={cn("line-clamp-2 font-semibold", stage.blocker ? "text-amber-200" : "text-white/52")}>
                    {friendlyActionText(stage.blocker, "Clear")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-white/32">{friendlyActionText(stage.next_action, stage.status === "NOT_STARTED" ? "Waiting for previous step" : "No next action")}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ClaimsPipelineDrawer({ claimRef, open, onOpenChange }: ClaimsPipelineDrawerProps) {
  const [audit, setAudit] = useState<AuditTrailResponse | null>(null);
  const [lifecycle, setLifecycle] = useState<ClaimLifecycleSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [view, setView] = useState<PipelineView>("lifecycle");

  useEffect(() => {
    if (!open || !claimRef) {
      if (!open) {
        setTimeout(() => {
          setAudit(null);
          setLifecycle(null);
          setError(null);
          setView("lifecycle");
        }, 200);
      }
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    async function fetchPipelineData() {
      const [lifecycleResult, auditResult] = await Promise.allSettled([
        getClaimLifecycle(claimRef!),
        getClaimAudit(claimRef!),
      ]);
      if (!isMounted) return;

      const nextLifecycle = lifecycleResult.status === "fulfilled" ? lifecycleResult.value : null;
      const nextAudit = auditResult.status === "fulfilled" ? auditResult.value : null;
      setLifecycle(nextLifecycle);
      setAudit(nextAudit);
      setView(nextLifecycle ? "lifecycle" : "flow");

      if (!nextLifecycle && !nextAudit) {
        const detail = lifecycleResult.status === "rejected"
          ? lifecycleResult.reason
          : auditResult.status === "rejected"
            ? auditResult.reason
            : null;
        setError(detail instanceof Error ? detail : new Error("Failed to load claim journey"));
      }
      setIsLoading(false);
    }

    fetchPipelineData().catch((err) => {
      if (isMounted) {
        setError(err instanceof Error ? err : new Error("Failed to load claim journey"));
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [claimRef, open]);

  const entries = useMemo(() => audit?.entries ?? [], [audit?.entries]);
  const pipelineEvents = useMemo(() => mapPipelineEvents(entries), [entries]);
  const totalDuration = useMemo(() => {
    if (lifecycle?.age_seconds != null || lifecycle?.age_ms != null) {
      return formatLifecycleAge(lifecycle.age_seconds, lifecycle.age_ms);
    }
    if (entries.length < 2) return "-";
    return formatDuration(entries[0].timestamp, entries[entries.length - 1].timestamp);
  }, [entries, lifecycle?.age_ms, lifecycle?.age_seconds]);
  const currentStatus = lifecycle?.status ?? audit?.entries?.at(-1)?.event_type ?? "PENDING";
  const hasPipelineData = Boolean(lifecycle?.stages?.length || lifecycle?.events?.length || audit?.entries?.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-[calc(100vw-1rem)] !max-w-[1760px] sm:!max-w-[calc(100vw-2rem)] xl:w-[94vw]",
          "h-[min(94vh,960px)] !max-h-[min(94vh,960px)]",
          "overflow-hidden p-0",
        )}
        showCloseButton
      >
        <div className="flex h-full flex-col overflow-hidden">
        <DialogHeader className="border-b border-white/[0.08] px-4 py-4 sm:px-5 xl:px-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.75fr)_minmax(380px,1fr)_auto] xl:items-center">
            <div className="flex min-w-0 items-center gap-3 pr-8 xl:pr-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/18 bg-cyan-300/[0.08] text-cyan-200">
                <Zap className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <DialogTitle className="text-lg font-black tracking-tight text-white">
                  Claim Journey
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-semibold text-white/48">
                  {claimRef || "Select a claim"}{lifecycle?.current_stage_label ? ` · ${friendlyStageLabel(lifecycle.current_stage, lifecycle.current_stage_label)}` : ""}
                </DialogDescription>
              </div>
            </div>

            <div className="min-w-0">
              <PipelineViewToggle view={view} setView={setView} />
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <LifecycleStatusPill status={currentStatus} />
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 min-w-[74px]">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">Stages</p>
                <p className="text-sm font-black text-white">{lifecycle?.stages?.length ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 min-w-[74px]">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">Age</p>
                <p className="text-sm font-black text-white">{totalDuration}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 min-w-[74px]">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">Events</p>
                <p className="text-sm font-black text-white">{audit?.total_entries ?? entries.length}</p>
              </div>
              <button
                type="button"
                onClick={() => claimRef && exportPipeline(claimRef, audit, lifecycle)}
                disabled={!claimRef || !hasPipelineData}
                className="ui-button-primary inline-flex h-10 items-center gap-2 px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Export Journey
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-styled sm:px-5 xl:px-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/40">
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-cyan-500/50" />
              <p className="text-sm font-medium">Loading claim journey...</p>
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Failed to load claim journey.</p>
                <p className="mt-1 text-xs text-red-400/70">{error.message}</p>
              </div>
            </div>
          ) : hasPipelineData ? (
            <>
              {view === "lifecycle" && <PipelineLifecycleView lifecycle={lifecycle} auditEvents={pipelineEvents} />}
              {view === "flow" && (
                entries.length ? <PipelineFlow events={pipelineEvents} /> : <PipelineLifecycleView lifecycle={lifecycle} auditEvents={pipelineEvents} />
              )}
              {view === "bento" && (
                entries.length ? <PipelineBento events={pipelineEvents} /> : <PipelineLifecycleView lifecycle={lifecycle} auditEvents={pipelineEvents} />
              )}
              {view === "audit" && (
                entries.length ? <PipelineAuditLedger events={pipelineEvents} /> : (
                  <div className="py-12">
                    <EmptyState
                      icon={History}
                      title="Event History Not Available"
                      description="Claim stages are available, but no detailed events were returned for this claim."
                    />
                  </div>
                )
              )}
            </>
          ) : (
            <div className="py-12">
              <EmptyState
                icon={Activity}
                title="No Claim Journey Found"
                description="No stages or detailed events were found for this claim."
              />
            </div>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
