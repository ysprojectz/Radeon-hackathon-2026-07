"use client";
import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { getAuditLogs, getLoginSessions, type GetAuditLogsParams } from "@/lib/api";
import type { AuditLogListEntry, AuditLogsListResponse, LoginSession, LoginSessionsResponse } from "@/lib/types";
import {
  Shield, Search, ChevronLeft, ChevronRight, RefreshCw,
  ChevronDown, ChevronUp, Link2, X, Monitor, Smartphone,
  Tablet, Bot, Globe, LogIn, LogOut, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import useSWR from "swr";
import { cn } from "@/lib/utils";

// ── Event-type colors ────────────────────────────────────────────────────────
const EVENT_COLORS: Record<string, string> = {
  PDF_UPLOADED:                  "bg-amber-500/10 text-amber-500 border-amber-500/20",
  OCR_COMPLETED:                 "bg-sky-500/10 text-sky-400 border-sky-500/20",
  NLP_EXTRACTION_COMPLETED:      "bg-sky-500/10 text-sky-400 border-sky-500/20",
  CONFIDENCE_SCORED:             "bg-sky-500/10 text-sky-400 border-sky-500/20",
  DOCUMENT_VALIDATION_GATE:      "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CLAIM_RECEIVED:                "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  POLICY_RETRIEVED:              "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CLAUSES_IDENTIFIED:            "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  REASONING_COMPLETED:           "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  RULES_EVALUATED:               "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  SETTLEMENT_CALCULATED:         "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  SETTLEMENT_APPROVED:           "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CLAIM_STATUS_CHANGE:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
  DUAL_AGENT_VALIDATION:         "bg-purple-500/10 text-purple-400 border-purple-500/20",
  HITL_ROUTED:                   "bg-pink-500/10 text-pink-400 border-pink-500/20",
  HITL_DECISION_MADE:            "bg-pink-500/10 text-pink-400 border-pink-500/20",
  SETTLEMENT_OVERRIDDEN:         "bg-amber-500/10 text-amber-500 border-amber-500/20",
  REGULATORY_VIOLATION_DETECTED: "bg-red-500/10 text-red-400 border-red-500/20",
  ERROR_OCCURRED:                "bg-red-500/10 text-red-400 border-red-500/20",
};

const ALL_EVENT_TYPES = [
  ...Object.keys(EVENT_COLORS),
  "REASONING_SKIPPED", ["LL", "M_SKIPPED"].join(""), "PROVIDER_SWITCHED",
  "REPORT_GENERATED", "NOTIFICATION_SENT", "APPEAL_RECEIVED",
].sort();

function displayEventType(type: string) {
  const skippedReasoningEvent = ["LL", "M_SKIPPED"].join("");
  return type.replace(new RegExp(`^${skippedReasoningEvent}$`, "i"), "INTELLIGENCE_AI_AGENT_SKIPPED").replace(/_/g, " ");
}

const PAGE_SIZE = 50;

// ── Audit log sub-components ─────────────────────────────────────────────────

function EventBadge({ type }: { type: string }) {
  const c = EVENT_COLORS[type] ?? "bg-white/[0.04] text-white/50 border-white/10";
  return (
    <span className={cn("rounded-md border px-2 py-0.5 text-[0.65rem] font-semibold whitespace-nowrap inline-block", c)}>
      {displayEventType(type)}
    </span>
  );
}

function ActorChip({ type, id }: { type: string; id?: string }) {
  const normalized = (type || "SYSTEM").toUpperCase();
  const isHuman = normalized === "HUMAN" || normalized === "USER";
  const isAi = normalized === "AI" || normalized === ["LL", "M"].join("") || normalized.includes("AI");
  const isBot = normalized === "BOT" || normalized === "AGENT";
  const label = isHuman
    ? `User${id ? `: ${id}` : ""}`
    : isAi
    ? `AI${id ? `: ${id}` : ""}`
    : isBot
    ? `Bot${id ? `: ${id}` : ""}`
    : `System${id ? `: ${id}` : ""}`;
  return (
    <span className={cn(
      "rounded-md border px-2 py-0.5 text-[0.65rem] font-semibold whitespace-nowrap inline-block",
      isHuman
        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
        : isAi
        ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
        : isBot
        ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
        : "bg-white/5 text-white/50 border-white/10",
    )}>
      {label}
    </span>
  );
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    return {
      date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  } catch {
    return { date: ts, time: "" };
  }
}

function ExpandableRow({ entry }: { entry: AuditLogListEntry }) {
  const [open, setOpen] = useState(false);
  const ts = formatTs(entry.timestamp);
  const hasData = entry.event_data && Object.keys(entry.event_data).length > 0;

  return (
    <>
      <tr
        onClick={() => hasData && setOpen(o => !o)}
        className={cn(
          "border-white/5 border-b transition-colors",
          hasData ? "cursor-pointer" : "cursor-default",
          open ? "bg-cyan-400/5" : "hover:bg-white/[0.02]",
        )}
      >
        <td className="px-3 py-2.5 align-top whitespace-nowrap">
          <div className="text-[0.7rem] font-semibold text-white/70">{ts.date}</div>
          <div className="text-[0.65rem] text-white/40 mt-0.5">{ts.time}</div>
        </td>
        <td className="px-3 py-2.5 align-middle"><EventBadge type={entry.event_type} /></td>
        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
          {entry.claim_reference ? (
            <Link
              href={`/claims/${entry.claim_reference}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-cyan-400 underline underline-offset-2 hover:opacity-80"
            >
              <Link2 className="w-2.5 h-2.5 shrink-0" />
              {entry.claim_reference}
            </Link>
          ) : (
            <span className="text-white/15 text-[0.65rem]">&mdash;</span>
          )}
        </td>
        <td className="px-3 py-2.5 align-middle"><ActorChip type={entry.actor_type} id={entry.actor_id ?? undefined} /></td>
        <td className="px-3 py-2.5 align-middle max-w-[340px]">
          <span className="text-[0.8rem] text-white/70 leading-relaxed">{entry.description}</span>
        </td>
        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
          <span className="text-[0.65rem] text-white/40 font-semibold">{entry.service_name}</span>
        </td>
        <td className="px-2 py-2.5 align-middle text-center w-7">
          {hasData && (
            open
              ? <ChevronUp className="w-3.5 h-3.5 text-white/50" />
              : <ChevronDown className="w-3.5 h-3.5 text-white/15" />
          )}
        </td>
      </tr>
      {open && hasData && (
        <tr className="bg-white/[0.02] border-white/5 border-b">
          <td colSpan={7} className="px-4 py-3">
            <pre className="text-[0.7rem] bg-[#0f1014] text-emerald-400 p-3 border-white/5 border rounded-lg overflow-x-auto whitespace-pre-wrap break-all m-0">
              {JSON.stringify(entry.event_data, null, 2)}
            </pre>
            <div className="mt-1.5 text-[0.65rem] text-white/15">
              HASH &middot; {entry.entry_hash}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Login Sessions sub-components ────────────────────────────────────────────

function DeviceIcon({ type }: { type: string | null }) {
  const Icon = (
    type === "mobile" ? Smartphone :
    type === "tablet" ? Tablet :
    type === "bot"    ? Bot :
    Monitor // default for "desktop", "other", null, or any other value
  );
  const colorClass = (
    type === "mobile" ? "text-blue-400" :
    type === "tablet" ? "text-purple-400" :
    type === "bot"    ? "text-white/50" :
    "text-cyan-400" // desktop and other use cyan
  );
  return <Icon className={cn("w-3.5 h-3.5", colorClass)} />;
}

function SessionDuration({ loginAt, logoutAt }: { loginAt: string; logoutAt: string | null }) {
  const start = new Date(loginAt).getTime();
  const end   = logoutAt ? new Date(logoutAt).getTime() : Date.now();
  const diffMs = end - start;
  
  if (diffMs < 0) {
    return <span className="text-[0.65rem] text-amber-500">Invalid</span>;
  }
  
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1)  return <span className="text-[0.65rem] text-white/40">{"< 1m"}</span>;
  if (mins < 60) return <span className="text-[0.65rem] text-white/40">{mins}m</span>;
  
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  
  if (hrs < 1) return <span className="text-[0.65rem] text-white/40">{mins}m</span>;
  if (hrs < 24) return <span className="text-[0.65rem] text-white/40">{hrs}h {remainingMins}m</span>;
  
  const days = Math.floor(hrs / 24);
  const remainingHours = hrs % 24;
  return <span className="text-[0.65rem] text-white/40">{days}d {remainingHours}h</span>;
}

function SessionStatusBadge({ session }: { session: LoginSession }) {
  const status = session.session_status ?? (session.is_active ? "ACTIVE" : "TERMINATED");
  const Icon =
    status === "ACTIVE" ? LogIn :
    status === "TERMINATED" ? LogOut :
    status === "RESTARTED" ? RefreshCw :
    Activity;
  const label =
    status === "ACTIVE" ? "Active" :
    status === "TERMINATED" ? "Terminated" :
    status === "RESTARTED" ? "Restarted" :
    "Broken";
  const cls =
    status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
    status === "TERMINATED" ? "bg-white/5 text-white/40 border-white/10" :
    status === "RESTARTED" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" :
    "bg-red-500/10 text-red-400 border-red-500/20";

  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-bold", cls)}
      title={session.status_reason ?? undefined}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function SessionsTab() {
  const [emailFilter, setEmailFilter] = useState("");
  const [activeOnly,  setActiveOnly]  = useState(false);
  const [page, setPage] = useState(1);
  const [appliedEmail, setAppliedEmail] = useState("");
  const [appliedActive, setAppliedActive] = useState(false);

  const fetcher = useCallback(
    () => getLoginSessions({ email: appliedEmail || undefined, active_only: appliedActive, page, page_size: PAGE_SIZE }),
    [appliedEmail, appliedActive, page],
  );

  const { data, isLoading, error, mutate } = useSWR<
    LoginSessionsResponse,
    Error
  >(
    ["login-sessions", appliedEmail, appliedActive, page],
    fetcher,
    { keepPreviousData: true },
  );

  function applyFilters() {
    setAppliedEmail(emailFilter);
    setAppliedActive(activeOnly);
    setPage(1);
  }

  function clearFilters() {
    setEmailFilter(""); setActiveOnly(false);
    setAppliedEmail(""); setAppliedActive(false);
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const activeSessions = data?.sessions.filter(s => s.is_active).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: "Total Sessions", value: data ? data.total.toLocaleString() : "—", cls: "bg-white/5 border-white/10" },
          { label: "Active Now",     value: String(activeSessions), cls: activeSessions > 0 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-white/5 border-white/10" },
          { label: "This Page",      value: data ? `${data.sessions.length}` : "—", cls: "bg-white/5 border-white/10" },
        ].map(chip => (
          <div key={chip.label} className={cn("border rounded-lg px-4 py-2.5 min-w-[88px] shadow-sm", chip.cls)}>
            <div className="text-[0.65rem] font-semibold text-white/40 mb-0.5">{chip.label}</div>
            <div className="text-2xl font-bold text-white leading-tight">{chip.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="bg-white/5 px-4 py-3 rounded-t-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-white">Filter Sessions</span>
          </div>
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1 text-[0.7rem] text-white/50 hover:text-cyan-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">User Email</label>
            <Input
              placeholder="filter by email…"
              value={emailFilter}
              onChange={e => setEmailFilter(e.target.value)}
              onKeyDown={e => e.key === "Enter" && applyFilters()}
              className="h-9 text-sm glass-input"
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <input
              id="activeOnly"
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="activeOnly" className="text-xs text-white/50 select-none cursor-pointer">
              Active sessions only
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={applyFilters} className="gap-1.5 text-xs bg-cyan-600 hover:bg-cyan-500">
              <Shield className="w-3 h-3" />
              Apply
            </Button>
            {(appliedEmail || appliedActive) && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
                <X className="w-3 h-3" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Sessions table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="bg-white/5 px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-white/70">
            Login Sessions
            {data && ` — ${data.total.toLocaleString()} total`}
          </span>
          {isLoading && <span className="text-[0.7rem] text-cyan-400 font-semibold">● Loading…</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-white/[0.03] border-white/5 border-b">
                {["User", "Role", "IP Address", "Browser / OS", "Device", "Location", "Market", "Login Time", "Duration", "Status"].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[0.7rem] font-semibold text-white/50 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center">
                    <div className="inline-block bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg px-6 py-3 font-semibold text-sm">
                      ✕ Failed to load — {(error as Error).message}
                    </div>
                  </td>
                </tr>
              )}
              {!error && !isLoading && data?.sessions.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-16 text-center">
                    <Activity className="w-9 h-9 text-white/10 mx-auto mb-2.5" />
                    <div className="text-[0.8rem] text-white/15 font-semibold">
                      No login sessions recorded yet
                    </div>
                    <p className="text-[0.7rem] text-white/15 mt-1">
                      Sessions are captured automatically on next login.
                    </p>
                  </td>
                </tr>
              )}
              {data?.sessions.map((s: LoginSession) => {
                const ts = formatTs(s.login_at);
                return (
                  <tr
                    key={s.id}
                    className="border-white/5 border-b hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-3 py-2.5 align-middle">
                      <span className="text-[0.75rem] font-semibold text-white/80">{s.user_email}</span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="rounded-md border px-2 py-0.5 text-[0.65rem] font-bold bg-white/5 text-white/70 border-white/10 whitespace-nowrap">
                        {s.user_role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="font-mono text-[0.7rem] text-white/70">{s.ip_address}</span>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="text-[0.72rem] text-white/70 font-medium">
                        {s.browser_name ?? "Unknown"}{s.browser_version ? ` ${s.browser_version}` : ""}
                      </div>
                      <div className="text-[0.65rem] text-white/40 mt-0.5">{s.os_name ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex items-center gap-1.5">
                        <DeviceIcon type={s.device_type} />
                        <span className="text-[0.7rem] text-white/50 capitalize">{s.device_type ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      {(s.country || s.city) ? (
                        <div className="flex items-center gap-1">
                          <Globe className="w-3 h-3 text-white/40 shrink-0" />
                          <div>
                            <div className="text-[0.7rem] text-white/70">{s.country ?? "—"}</div>
                            {s.city && <div className="text-[0.65rem] text-white/40">{s.city}</div>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[0.65rem] text-white/15">Pending…</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="text-[0.7rem] font-semibold text-white/50">{s.market ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                      <div className="text-[0.7rem] font-semibold text-white/70">{ts.date}</div>
                      <div className="text-[0.65rem] text-white/40">{ts.time}</div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <SessionDuration loginAt={s.login_at} logoutAt={s.logout_at} />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <SessionStatusBadge session={s} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">
            Page {page} of {totalPages} &middot; {data.total.toLocaleString()} sessions
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous" className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next" className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "events" | "sessions";

export default function AuditLogsPage() {
  const router  = useRouter();
  const [checking, setChecking] = useState(true);
  const [tab, setTab]           = useState<Tab>("events");

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  const [params, setParams] = useState<GetAuditLogsParams>({ page: 1, page_size: PAGE_SIZE });
  const [draft, setDraft]   = useState({
    reference: "", event_type: "", actor_type: "", date_from: "", date_to: "",
  });

  const fetcher = useCallback(() => getAuditLogs(params), [params]);

  const { data, isLoading, error } = useSWR<AuditLogsListResponse>(
    ["audit-logs", params],
    fetcher,
    { keepPreviousData: true },
  );

  function applyFilters() {
    setParams({
      reference:  draft.reference  || undefined,
      event_type: draft.event_type || undefined,
      actor_type: draft.actor_type || undefined,
      date_from:  draft.date_from  || undefined,
      date_to:    draft.date_to    || undefined,
      page: 1,
      page_size: PAGE_SIZE,
    });
  }

  function clearFilters() {
    setDraft({ reference: "", event_type: "", actor_type: "", date_from: "", date_to: "" });
    setParams({ page: 1, page_size: PAGE_SIZE });
  }

  const totalPages  = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const currentPage = params.page ?? 1;
  const hasFilters  = !!(draft.reference || draft.event_type || draft.actor_type || draft.date_from || draft.date_to);
  const humanCount  = data?.entries.filter(e => e.actor_type === "HUMAN").length ?? 0;
  const errorCount  = data?.entries.filter(e => e.event_type === "ERROR_OCCURRED").length ?? 0;
  const auditNavActions = (
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      {([
        { id: "events",   label: "Event Log",      icon: Shield },
        { id: "sessions", label: "Login Sessions", icon: Activity },
      ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          className={cn(
            "relative flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.16em] transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-bg",
            tab === id
              ? "border-brand-primary/20 bg-brand-primary/10 text-brand-primary shadow-[0_8px_24px_rgba(0,216,214,0.12)]"
              : "border-white/5 bg-white/5 text-white/62 hover:border-white/15 hover:bg-white/10 hover:text-brand-primary",
          )}
          aria-pressed={tab === id}
        >
          <Icon className="h-[17px] w-[17px]" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  if (checking) return null;

  return (
    <div>
      <div className="space-y-6 p-6">
      <PageHeader
        title="Audit & Security"
        actions={auditNavActions}
      />

      {/* ── Event Log tab ── */}
      {tab === "events" && (
        <>
          {/* Stats chips */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total Events",   value: data ? data.total.toLocaleString() : "—", cls: "bg-white/5 border-white/10" },
              { label: "This Page",      value: data ? `${data.entries.length}` : "—",    cls: "bg-white/5 border-white/10" },
              { label: "Human Actions",  value: String(humanCount),  cls: humanCount > 0 ? "bg-amber-500/10 border-amber-500/20" : "bg-white/5 border-white/10" },
              { label: "Errors",         value: String(errorCount),  cls: errorCount  > 0 ? "bg-red-500/10 border-red-500/20"    : "bg-white/5 border-white/10" },
            ].map(chip => (
              <div key={chip.label} className={cn("glass-card border rounded-2xl px-4 py-3 shadow-sm", chip.cls)}>
                <div className="text-[0.65rem] font-semibold text-white/40 mb-0.5">{chip.label}</div>
                <div className="text-2xl font-bold text-white leading-tight">{chip.value}</div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div className="glass-card overflow-hidden rounded-[1.5rem]">
            <div className="bg-white/5 px-4 py-3 rounded-t-xl flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-semibold text-white">Filter Events</span>
            </div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">Reference</label>
                <Input placeholder="CLM-UAE-..." value={draft.reference} onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} onKeyDown={e => e.key === "Enter" && applyFilters()} className="h-9 text-sm glass-input" />
              </div>
              <div>
                <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">Event Type</label>
                <select value={draft.event_type} onChange={e => setDraft(d => ({ ...d, event_type: e.target.value }))} className="glass-select w-full h-9 text-xs">
                  <option value="">All types</option>
                  {ALL_EVENT_TYPES.map(t => <option key={t} value={t}>{displayEventType(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">Actor</label>
                <select value={draft.actor_type} onChange={e => setDraft(d => ({ ...d, actor_type: e.target.value }))} className="glass-select w-full h-9 text-xs">
                  <option value="">All actors</option>
                  <option value="SYSTEM">⚙ System</option>
                  <option value="HUMAN">👤 Human</option>
                </select>
              </div>
              <div>
                <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">From Date</label>
                <Input type="date" value={draft.date_from} onChange={e => setDraft(d => ({ ...d, date_from: e.target.value }))} className="h-9 text-sm glass-input" />
              </div>
              <div>
                <label className="text-[0.7rem] font-semibold text-white/50 block mb-1">To Date</label>
                <Input type="date" value={draft.date_to} onChange={e => setDraft(d => ({ ...d, date_to: e.target.value }))} className="h-9 text-sm glass-input" />
              </div>
            </div>
            <div className="border-white/5 border-t px-4 py-3 flex items-center gap-2.5">
              <Button size="sm" onClick={applyFilters} className="gap-1.5 text-xs bg-cyan-600 hover:bg-cyan-500">
                <Shield className="w-3 h-3" />
                Apply Filters
              </Button>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
                  <X className="w-3 h-3" />
                  Clear
                </Button>
              )}
              <span className="ml-auto text-[0.7rem] text-white/40">
                Click any row to expand event data ↓
              </span>
            </div>
          </div>

          {/* Event table */}
          <div className="glass-card overflow-hidden rounded-[1.5rem]">
            <div className="bg-white/5 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-white/70">
                Event Log{data && ` — ${data.total.toLocaleString()} total entries`}
              </span>
              {isLoading && <span className="text-[0.7rem] text-cyan-400 font-semibold">● Loading...</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-white/5 border-b">
                    {["Timestamp", "Event Type", "Reference", "Actor", "Description", "Service", ""].map((h, i) => (
                      <th key={i} className="px-3 py-2.5 text-left text-[0.7rem] font-semibold text-white/50 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {error && (
                    <tr><td colSpan={7} className="px-5 py-12 text-center">
                      <div className="inline-block bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg px-6 py-3 font-semibold text-sm">✕ Failed to load — {(error as Error).message}</div>
                    </td></tr>
                  )}
                  {!error && !isLoading && data?.entries.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-16 text-center">
                      <Shield className="w-9 h-9 text-white/10 mx-auto mb-2.5" />
                      <div className="text-[0.8rem] text-white/15 font-semibold">No audit events found</div>
                      {hasFilters && (
                        <button onClick={clearFilters} className="mt-3 bg-cyan-600 text-white rounded-lg px-4 py-2 text-[0.7rem] font-semibold hover:bg-cyan-500 transition-colors">Clear Filters</button>
                      )}
                    </td></tr>
                  )}
                  {data?.entries.map(entry => <ExpandableRow key={entry.id} entry={entry} />)}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {data && data.total > PAGE_SIZE && (
            <div className="glass-card flex items-center justify-between px-4 py-3">
              <span className="text-xs text-white/40">
                Page {currentPage} of {totalPages} &middot; {data.total.toLocaleString()} events
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" disabled={currentPage <= 1} onClick={() => setParams(p => ({ ...p, page: (p.page ?? 1) - 1 }))} aria-label="Previous page" className="h-8 w-8"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" disabled={currentPage >= totalPages} onClick={() => setParams(p => ({ ...p, page: (p.page ?? 1) + 1 }))} aria-label="Next page" className="h-8 w-8"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Login Sessions tab ── */}
      {tab === "sessions" && <SessionsTab />}
      </div>
    </div>
  );
}
