"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Activity,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  Workflow,
} from "lucide-react";
import { ClaimsPipelineDrawer } from "@/components/claims/ClaimsPipelineDrawer";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getOperationsLifecycle } from "@/lib/api";
import { MARKET_LABELS } from "@/lib/constants";
import { cn, formatDateTime } from "@/lib/utils";
import type { ClaimLifecycleSummary, OperationsLifecycleParams, OperationsLifecycleStageSummary } from "@/lib/types";
import {
  formatLifecycleAge,
  humanizeLifecycleValue,
  lifecycleStatusTone,
  LifecycleStatusPill,
} from "./lifecycle-utils";

const PAGE_SIZE = 25;
type FocusFilter = "ALL" | "STUCK" | "DUE";

function ratio(value: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function metricLabel(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function StageCard({
  stage,
  active,
  onSelect,
}: {
  stage: OperationsLifecycleStageSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const problemCount = stage.failed + stage.blocked + stage.stuck + stage.sla_breached;
  const completed = ratio(stage.completed, stage.total);
  const inProgress = ratio(stage.in_progress, stage.total);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group min-w-0 rounded-2xl border p-4 text-left transition",
        active
          ? "border-brand-primary/35 bg-brand-primary/10 shadow-[0_0_20px_rgba(37,99,235,0.12)]"
          : "border-[var(--border-subtle)] bg-[var(--acos-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--acos-surface-strong)]"
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-text-primary">{stage.label}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">
            {metricLabel(stage.total)} claim{stage.total === 1 ? "" : "s"}
          </p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", problemCount > 0 ? "border-[var(--status-warning)]/25 bg-[var(--status-warning)]/10 text-[var(--status-warning)]" : "border-[var(--status-success)]/20 bg-[var(--status-success)]/10 text-[var(--status-success)]")}>
          {problemCount > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </div>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-[var(--acos-surface-strong)]">
        <div className="flex h-full">
          <span className="h-full bg-[var(--status-success)]/70" style={{ width: `${completed}%` }} />
          <span className="h-full bg-brand-primary/70" style={{ width: `${inProgress}%` }} />
          <span className="h-full bg-[var(--status-warning)]/70" style={{ width: `${ratio(problemCount, stage.total)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ["Open", stage.in_progress],
          ["Done", stage.completed],
          ["Block", stage.blocked + stage.stuck],
          ["Due", stage.sla_breached],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-2 py-2">
            <p className="text-[10px] font-black text-text-primary">{value}</p>
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-text-muted">{label}</p>
          </div>
        ))}
      </div>
    </button>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof Activity;
  tone?: "cyan" | "amber" | "red" | "emerald";
}) {
  const classes = {
    cyan: "border-brand-primary/20 bg-brand-primary/10 text-brand-primary",
    amber: "border-[var(--status-warning)]/20 bg-[var(--status-warning)]/10 text-[var(--status-warning)]",
    red: "border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 text-[var(--status-danger)]",
    emerald: "border-[var(--status-success)]/20 bg-[var(--status-success)]/10 text-[var(--status-success)]",
  };
  return (
    <div className="glass-card min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">{label}</p>
          <p className="mt-2 text-2xl font-black text-text-primary">{metricLabel(value)}</p>
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", classes[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-muted">{hint}</p>
    </div>
  );
}

function LifecycleClaimRow({
  claim,
  onViewPipeline,
}: {
  claim: ClaimLifecycleSummary;
  onViewPipeline: (reference: string) => void;
}) {
  const tone = lifecycleStatusTone(claim.status);
  return (
    <tr className="border-b border-[var(--border-subtle)] transition hover:bg-brand-primary/[0.035]">
      <td className="px-4 py-3">
        <Link href={`/claims/${claim.claim_reference}`} className="font-mono text-xs font-bold text-brand-primary hover:underline">
          {claim.claim_reference}
        </Link>
        <p className="mt-1 truncate text-xs text-text-muted">{claim.patient_name || "Unknown patient"}</p>
      </td>
      <td className="hidden px-4 py-3 text-xs text-text-secondary md:table-cell">
        <p className="font-semibold text-text-primary">{claim.market_region || "-"}</p>
        <p className="mt-1">{claim.claim_type ? humanizeLifecycleValue(claim.claim_type) : "-"}</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-text-primary">{claim.current_stage_label}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">{humanizeLifecycleValue(claim.current_stage)}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <LifecycleStatusPill status={claim.status} compact />
      </td>
      <td className="hidden px-4 py-3 text-xs text-text-secondary lg:table-cell">
        <p className="font-mono font-semibold text-text-primary">{formatLifecycleAge(claim.age_seconds, claim.age_ms)}</p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {claim.sla_due_at ? `Due ${formatDateTime(claim.sla_due_at)}` : claim.sla_status ? humanizeLifecycleValue(claim.sla_status).replace(/\bSla\b/g, "Due time") : "Due time unknown"}
        </p>
      </td>
      <td className="hidden max-w-[260px] px-4 py-3 text-xs xl:table-cell">
        <p className={cn("truncate font-semibold", claim.blocker ? "text-[var(--status-warning)]" : "text-text-muted")}>
          {claim.blocker || "No blocker reported"}
        </p>
        <p className="mt-1 truncate text-text-muted">{claim.next_action || "Continue claim journey"}</p>
      </td>
      <td className="hidden px-4 py-3 text-right font-mono text-xs text-text-primary lg:table-cell">
        <CurrencyAmount amount={claim.total_settlement ?? claim.total_billed ?? 0} currency={claim.currency ?? "USD"} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onViewPipeline(claim.claim_reference)}
            className="rounded-lg p-2 text-text-muted transition hover:bg-brand-primary/10 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            title="Open journey"
            aria-label={`Open journey for ${claim.claim_reference}`}
          >
            <Workflow className="h-4 w-4" />
          </button>
          <Link href={`/claims/${claim.claim_reference}`} className="rounded-lg p-2 text-text-muted transition hover:bg-[var(--acos-surface-strong)] hover:text-text-primary" title="Claim detail">
            <Eye className="h-4 w-4" />
          </Link>
          <Link href={`/hitl?claim=${encodeURIComponent(claim.claim_reference)}`} className="rounded-lg p-2 text-text-muted transition hover:bg-[var(--status-warning)]/10 hover:text-[var(--status-warning)]" title="Manual review">
            <ShieldAlert className="h-4 w-4" />
          </Link>
          <Link href={`/accounts?claim=${encodeURIComponent(claim.claim_reference)}`} className="rounded-lg p-2 text-text-muted transition hover:bg-[var(--status-success)]/10 hover:text-[var(--status-success)]" title="Accounts">
            <Banknote className="h-4 w-4" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

export function LifecycleCockpit() {
  const [stage, setStage] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [market, setMarket] = useState("ALL");
  const [focus, setFocus] = useState<FocusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pipelineClaim, setPipelineClaim] = useState<string | null>(null);

  const params = useMemo<OperationsLifecycleParams>(() => ({
    stage: stage === "ALL" ? undefined : stage,
    status: status === "ALL" ? undefined : status,
    market_region: market === "ALL" ? undefined : market,
    search: search.trim() || undefined,
    only_stuck: focus === "STUCK" || undefined,
    only_sla_breached: focus === "DUE" || undefined,
    page,
    page_size: PAGE_SIZE,
  }), [focus, market, page, search, stage, status]);

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    ["operations-lifecycle", params],
    () => getOperationsLifecycle(params),
    { keepPreviousData: true, revalidateOnFocus: false }
  );

  const stageOptions = data?.stage_summary ?? [];
  const totalRows = data?.total ?? data?.total_claims ?? data?.claims.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  function resetToFirstPage(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Tracked Claims" value={data?.total_claims ?? 0} hint="Claims with journey visibility in the operations stream." icon={Activity} tone="cyan" />
        <SummaryTile label="Blocked" value={data?.blocked_count ?? 0} hint="Claims reporting a blocker, manual wait, or dependency hold." icon={AlertTriangle} tone="amber" />
        <SummaryTile label="Stuck" value={data?.stuck_count ?? 0} hint="Claims older than the active stage threshold." icon={Clock3} tone="red" />
        <SummaryTile label="Due-Time Breach" value={data?.sla_breached_count ?? 0} hint="Claims that crossed a claim journey or stage due time." icon={ShieldAlert} tone="red" />
      </section>

      <section className="dashboard-panel overflow-visible">
        <div className="dashboard-panel-accent bg-gradient-to-r from-brand-primary/0 via-brand-primary/40 to-transparent" />
        <div className="relative space-y-5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="dashboard-panel-title">
              <span className="dashboard-panel-dot bg-brand-primary" />
              <div>
                <p className="dashboard-panel-label">Journey Filters</p>
                <p className="mt-1 text-xs text-text-muted">Narrow by stage, market, journey status, or operational risk.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void mutate()}
              className="ui-button-secondary inline-flex h-10 w-fit items-center gap-2 px-3 text-xs font-bold"
            >
              {isValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_170px_170px_170px_170px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                value={search}
                onChange={(event) => resetToFirstPage(() => setSearch(event.target.value))}
                placeholder="Search claim, patient, member"
                className="pl-9"
              />
            </div>
            <Select value={stage} onValueChange={(value) => resetToFirstPage(() => setStage(value))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All stages</SelectItem>
                {stageOptions.map((item) => (
                  <SelectItem key={item.stage} value={item.stage}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => resetToFirstPage(() => setStatus(value))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {["IN_PROGRESS", "WAITING", "BLOCKED", "STUCK", "SLA_BREACHED", "FAILED", "COMPLETED", "SKIPPED"].map((item) => (
                  <SelectItem key={item} value={item}>{humanizeLifecycleValue(item).replace(/\bSla\b/g, "Due time")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={market} onValueChange={(value) => resetToFirstPage(() => setMarket(value))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Market" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All markets</SelectItem>
                {Object.entries(MARKET_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={focus} onValueChange={(value) => resetToFirstPage(() => setFocus(value as FocusFilter))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Focus" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All risk</SelectItem>
                <SelectItem value="STUCK">Stuck only</SelectItem>
                <SelectItem value="DUE">Due-time breach only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {isLoading && !data ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)]" />
          ))
        ) : stageOptions.length ? (
          stageOptions.map((item) => (
            <StageCard
              key={item.stage}
              stage={item}
              active={stage === item.stage}
              onSelect={() => resetToFirstPage(() => setStage(stage === item.stage ? "ALL" : item.stage))}
            />
          ))
        ) : (
          <div className="md:col-span-2 2xl:col-span-4">
            <EmptyState icon={Filter} title="No journey stages" description="Stage summary will appear when journey data is available." />
          </div>
        )}
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] bg-[var(--acos-surface)] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-black text-text-primary">Claim Journey Register</p>
            <p className="mt-1 text-xs text-text-muted">Claim-level stage, due time, blocker, and next action visibility.</p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-3 py-1.5 text-xs font-semibold text-text-secondary">
            <Stethoscope className="h-3.5 w-3.5 text-brand-primary" />
            {metricLabel(totalRows)} records
          </div>
        </div>

        {error ? (
          <div className="m-5 flex items-start gap-3 rounded-xl border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 p-4 text-[var(--status-danger)]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Failed to load claim journey monitor.</p>
              <p className="mt-1 text-xs text-[var(--status-danger)]/70">{error instanceof Error ? error.message : "Claim journey service returned an error."}</p>
            </div>
          </div>
        ) : isLoading && !data ? (
          <div className="flex items-center justify-center gap-3 px-5 py-16 text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
            Loading claim journey data...
          </div>
        ) : data?.claims.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-card-muted)]">
                <tr>
                  {["Claim", "Market", "Current Stage", "Status", "Age / Due Time", "Needs Attention / Next Action", "Amount", "Links"].map((head) => (
                    <th key={head} className={cn("px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-text-muted", head === "Links" && "text-right")}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.claims.map((claim) => (
                  <LifecycleClaimRow key={claim.claim_reference} claim={claim} onViewPipeline={setPipelineClaim} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8">
            <EmptyState icon={Workflow} title="No claim journey records" description="Adjust filters or refresh once journey events are available." />
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 text-sm text-text-muted">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="ui-button-secondary px-3 py-2 disabled:opacity-35" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </button>
            <button type="button" className="ui-button-secondary px-3 py-2 disabled:opacity-35" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              Next
            </button>
          </div>
        </div>
      )}

      <ClaimsPipelineDrawer
        claimRef={pipelineClaim}
        open={!!pipelineClaim}
        onOpenChange={(open) => !open && setPipelineClaim(null)}
      />
    </div>
  );
}
