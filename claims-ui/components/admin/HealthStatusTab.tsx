"use client";
import { useState } from "react";
import {
  RefreshCw, AlertCircle, Clock,
  Activity, Wifi, Zap, Shield, Server, Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminGetHealth, adminGetKubernetesHealth } from "@/lib/api";
import { getDashboardKPIs } from "@/lib/api";
import type { IntegrationHealth, IntegrationCheck, KubernetesHealth, KubernetesServiceHealth } from "@/lib/types";
import {
  adminMetricCardClass,
  adminOutlineButtonClass,
  adminPanelClass,
  adminSectionCopyClass,
} from "@/components/admin/admin-theme";


function StatusBadge({ status }: { status: string }) {
  const cls = {
    up:             "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    down:           "text-rose-500 bg-rose-500/10 border-rose-500/20",
    degraded:       "text-amber-500 bg-amber-500/10 border-amber-500/20",
    not_found:      "text-slate-400 bg-slate-500/10 border-slate-500/20",
    not_configured: "text-slate-400 bg-slate-500/10 border-slate-500/20",
    unknown:        "text-amber-500 bg-amber-500/10 border-amber-500/20",
    error:          "text-rose-500 bg-rose-500/10 border-rose-500/20",
  }[status] ?? "text-muted-foreground";

  const label = {
    up:             "Online",
    down:           "Offline",
    degraded:       "Degraded",
    not_found:      "Missing",
    not_configured: "Not configured",
    unknown:        "Unknown",
    error:          "Error",
  }[status] ?? status;

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function CheckRow({
  name, icon: Icon, check,
}: {
  name: string;
  icon: React.FC<{ className?: string }>;
  check: IntegrationCheck;
}) {
  return (
    <div className="flex items-center justify-between rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-white/35" />
        <div>
          <p className="text-sm font-medium text-white/82">{name}</p>
          {check.host && <p className="text-xs text-white/35">{check.host}</p>}
          {check.detail && check.status !== "up" && (
            <p className="text-xs text-white/35">{check.detail}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {check.latency_ms !== undefined && check.latency_ms > 0 && (
          <span className="flex items-center gap-1 text-xs text-white/35">
            <Clock className="h-3 w-3" /> {check.latency_ms}ms
          </span>
        )}
        <StatusBadge status={check.status} />
      </div>
    </div>
  );
}

function KubernetesServiceRow({ service }: { service: KubernetesServiceHealth }) {
  const portText = service.ports
    .map((port) => port.node_port ? `${port.port}:${port.node_port}` : String(port.port ?? ""))
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex items-center justify-between gap-4 rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Server className="h-4 w-4 shrink-0 text-white/35" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-white/82">{service.name}</p>
            {service.service_type && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/35">
                {service.service_type}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-white/35">
            {service.deployment ?? "no deployment"} · {service.service ?? "no service"}
            {portText ? ` · ${portText}` : ""}
          </p>
          {service.namespace && (
            <p className="text-xs text-white/30">
              Namespace {service.namespace}
              {service.workload_type === "sidecar" ? " · Sidecar check" : ""}
            </p>
          )}
          {service.detail && service.status !== "up" && (
            <p className="text-xs text-white/35">{service.detail}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs tabular-nums text-white/35 sm:inline">
          {service.ready_replicas}/{service.desired_replicas} ready
        </span>
        {service.restarts > 0 && (
          <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-400">
            {service.restarts} restarts
          </span>
        )}
        <StatusBadge status={service.status} />
      </div>
    </div>
  );
}

function KubernetesHealthPanel({ health }: { health: KubernetesHealth }) {
  const grouped = health.services.reduce<Record<string, KubernetesServiceHealth[]>>((acc, service) => {
    acc[service.group] = acc[service.group] ?? [];
    acc[service.group].push(service);
    return acc;
  }, {});

  return (
    <div className={`${adminPanelClass} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-white/35" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
              ACOS Services
            </p>
          </div>
          <p className={`mt-1 text-xs ${adminSectionCopyClass}`}>
            Namespace {health.namespace}
            {health.detail ? ` · ${health.detail}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-white/35">
            {health.summary.up}/{health.summary.total} ready
          </span>
          <StatusBadge status={health.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <TrafficCard label="Ready" value={health.summary.up} sub="Workloads online" icon={Shield} color="emerald" />
        <TrafficCard label="Attention" value={health.summary.degraded + health.summary.down + health.summary.not_found} sub="Needs action" icon={AlertCircle} color="amber" />
        <TrafficCard label="Optional" value={health.summary.not_configured ?? 0} sub="Paused by design" icon={Activity} color="blue" />
        <TrafficCard label="Restarts" value={health.summary.restarts} sub="Container restart count" icon={RefreshCw} color="violet" />
      </div>

      {Object.entries(grouped).map(([group, services]) => (
        <div key={group} className="space-y-2">
          <p className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/30">{group}</p>
          <div className="space-y-2">
            {services.map((service) => (
              <KubernetesServiceRow key={service.key} service={service} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Traffic stat card ─────────────────────────────────────────────────────────

export function formatTrafficPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  let percent = value;
  if (Math.abs(percent) <= 1) {
    percent *= 100;
  } else if (Math.abs(percent) > 1000 && Math.abs(percent) <= 10000) {
    percent /= 100;
  }

  return `${Math.max(0, Math.min(100, percent)).toFixed(2)}%`;
}

function TrafficCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.FC<{ className?: string }>;
  color: "emerald" | "blue" | "amber" | "violet";
}) {
  const colorCls = {
    emerald: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    blue:    "bg-blue-500/10 text-blue-500 border-blue-500/20",
    amber:   "bg-amber-500/10 text-amber-500 border-amber-500/20",
    violet:  "bg-violet-500/10 text-violet-500 border-violet-500/20",
  }[color];

  return (
    <div className={`${adminMetricCardClass} flex items-center gap-3`}>
      <div className={`rounded-md border p-2 ${colorCls}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-white/30">
          {label}
        </p>
        <p className="text-lg font-semibold leading-tight tabular-nums text-white">
          {value}
        </p>
        {sub && <p className={`text-[10px] ${adminSectionCopyClass}`}>{sub}</p>}
      </div>
    </div>
  );
}

// Minimal SVG icons for services
const DbIcon    = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5"/>
    <path d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3"/>
  </svg>
);
const CacheIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
  </svg>
);
const BrainIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

// ── Main component ────────────────────────────────────────────────────────────

export function HealthStatusTab() {
  const [health,  setHealth]  = useState<IntegrationHealth | null>(null);
  const [kubernetesHealth, setKubernetesHealth] = useState<KubernetesHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Traffic stats from dashboard KPIs
  const [totalClaims,     setTotalClaims]     = useState<number | null>(null);
  const [avgProcessingMs, setAvgProcessingMs] = useState<number | null>(null);
  const [autoAdjRate,     setAutoAdjRate]      = useState<number | null>(null);
  const [hitlPending,     setHitlPending]      = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // Run health check and KPI fetch in parallel
      const [healthData, kubernetesData, kpiData] = await Promise.all([
        adminGetHealth(),
        adminGetKubernetesHealth().catch((err) => ({
          configured: false,
          namespace: "unknown",
          status: "not_configured" as const,
          detail: err instanceof Error ? err.message : "Kubernetes health unavailable",
          summary: { total: 0, up: 0, degraded: 0, down: 0, not_found: 0, restarts: 0 },
          services: [],
          timestamp: Date.now() / 1000,
        })),
        getDashboardKPIs().catch(() => null),
      ]);
      setHealth(healthData);
      setKubernetesHealth(kubernetesData);
      if (kpiData) {
        setTotalClaims(kpiData.total_claims);
        setAvgProcessingMs(kpiData.avg_processing_time_ms);
        setAutoAdjRate(kpiData.auto_adjudication_rate);
        setHitlPending(kpiData.pending_hitl_count);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }

  const checks    = health?.checks;
  const checkedAt = health ? new Date(health.timestamp * 1000).toLocaleTimeString() : null;

  // Compute avg API latency from available checks
  const apiLatencies = health
    ? [health.checks.groq?.latency_ms, health.checks.anthropic?.latency_ms, health.checks.nvidia?.latency_ms].filter(
        (v): v is number => typeof v === "number" && v > 0
      )
    : [];
  const avgApiLatency = apiLatencies.length
    ? Math.round(apiLatencies.reduce((a, b) => a + b, 0) / apiLatencies.length)
    : null;

  const servicesUp = health
    ? Object.values(health.checks).filter((c) => c.status === "up").length
    : null;

  return (
    <div className="space-y-5">

      <div className={`${adminPanelClass} flex items-center justify-between`}>
        <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Runtime Telemetry</p>
        <p className="mt-2 text-sm text-white/45">
          {checkedAt ? `Last checked at ${checkedAt}` : "Click to run a live health check"}
        </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}
          disabled={loading} className={adminOutlineButtonClass}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking…" : "Check Now"}
        </Button>
      </div>

      {error && (
        <div className="rounded-[1rem] border border-rose-300/20 bg-rose-300/10 px-4 py-3">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}

      {/* ── Integration Health ──────────────────────────────────────────────── */}
      {checks ? (
        <div className="space-y-2">
          <CheckRow name="PostgreSQL"  icon={DbIcon}    check={checks.postgresql} />
          <CheckRow name="Redis"       icon={CacheIcon} check={checks.redis} />
          <CheckRow name="Intelligence AI Agent" icon={BrainIcon} check={checks.groq} />
          <CheckRow name="Anthropic"   icon={BrainIcon} check={checks.anthropic} />
          {checks.nvidia && (
            <CheckRow name="Backup Intelligence AI Agent" icon={BrainIcon} check={checks.nvidia} />
          )}
        </div>
      ) : !loading && (
        <div className={`${adminPanelClass} rounded-[1.5rem] border-dashed px-4 py-10 text-center`}>
          <p className="text-sm text-white/35">No data yet — run a health check to see status</p>
        </div>
      )}

      {kubernetesHealth && (
        <KubernetesHealthPanel health={kubernetesHealth} />
      )}

      {/* ── Traffic Overview ────────────────────────────────────────────────── */}
      {(health || totalClaims !== null) && (
        <div className={`${adminPanelClass} space-y-3`}>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border/60" />
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
              Traffic Overview
            </p>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TrafficCard
              label="Total Claims"
              value={totalClaims !== null ? totalClaims.toLocaleString() : "—"}
              sub="All time in system"
              icon={Activity}
              color="blue"
            />
            <TrafficCard
              label="Avg Processing"
              value={avgProcessingMs !== null ? `${(avgProcessingMs / 1000).toFixed(1)}s` : "—"}
              sub="Per claim end-to-end"
              icon={Zap}
              color="amber"
            />
            <TrafficCard
              label="Auto-Adjudication"
              value={formatTrafficPercent(autoAdjRate)}
              sub="Settled without HITL"
              icon={Shield}
              color="emerald"
            />
            <TrafficCard
              label="Services Online"
              value={servicesUp !== null
                ? `${servicesUp} / ${Object.keys(health!.checks).length}`
                : "—"}
              sub={avgApiLatency !== null ? `Avg API latency ${avgApiLatency}ms` : "Run check to see"}
              icon={Wifi}
              color="violet"
            />
          </div>

          {hitlPending !== null && hitlPending > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <strong>{hitlPending}</strong> claim{hitlPending !== 1 ? "s" : ""} awaiting human review in Final Approval queue
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
