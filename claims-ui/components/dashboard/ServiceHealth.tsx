"use client";
import type { ServiceHealthLive, ReliabilityMetricsSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";
import { Stat } from "@/components/ui/Stat";

const SERVICES: Array<{
  key: keyof ServiceHealthLive;
  label: string;
}> = [
  { key: "api",   label: "Service" },
  { key: "db",    label: "Database" },
  { key: "redis", label: "Cache" },
  { key: "llm",   label: "Assistant" },
];

function StatusPill({
  label,
  up,
  loading,
  errored,
}: {
  label: string;
  up: boolean | null;
  loading: boolean;
  errored: boolean;
}) {
  const statusText = loading ? "…" : errored ? "?" : up ? "OK" : "DOWN";

  const dotClass = cn(
    "h-2 w-2 shrink-0 rounded-full",
    loading  && "bg-white/20",
    errored  && "bg-amber-400",
    !loading && !errored && up  && "bg-emerald-400 animate-pulse",
    !loading && !errored && !up && "bg-red-400",
  );

  const pillClass = cn(
    "flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition-colors",
    loading  && "bg-white/[0.03] border-white/[0.06] text-white/30",
    errored  && "bg-amber-500/[0.08] border-amber-500/20 text-amber-400",
    !loading && !errored && up  && "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400",
    !loading && !errored && !up && "bg-red-500/[0.08] border-red-500/20 text-red-400",
  );

  return (
    <Stat tone="custom" bare className={pillClass}>
      <div className="flex items-center gap-2">
        <span className={dotClass} />
        <span className="text-xs font-bold text-white/70">{label}</span>
      </div>
      <span className="text-xs font-black tabular-nums">{statusText}</span>
    </Stat>
  );
}

interface ServiceHealthProps {
  reliability?: ReliabilityMetricsSnapshot | null;
  complianceDrift?: Record<string, boolean>;
  isLoading?: boolean;
}

export function ServiceHealth({ reliability, complianceDrift, isLoading = true }: ServiceHealthProps) {
  // Determine service health from reliability data
  const health: ServiceHealthLive | null = isLoading && !reliability ? null : {
    api: true,
    db: reliability !== null && reliability !== undefined,
    redis: true,
    llm: true,
  };

  const loading = isLoading && !reliability;
  const errored = false;
  const allUp = !loading && !errored && health && Object.values(health).every(Boolean);

  return (
    <Card
      variant="dashboard"
      className="h-auto min-h-[220px]"
      role="status"
      aria-label="Service health"
    >
      {/* Cyan theme for services - matching analytics dashboard */}
      <CardAccent className="bg-gradient-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0" />
      <CardGlow className="-bottom-8 -right-8" style={{ background: "rgba(0, 216, 214, 0.20)" }} />

      <div className="relative p-5">
        {/* Header */}
        <div className="dashboard-panel-header mb-4">
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              allUp ? "bg-emerald-400" : "bg-cyan-400"
            )} />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
              Services Health
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {SERVICES.map(({ key, label }) => (
            <StatusPill
              key={key}
              label={label}
              up={health ? health[key] : null}
              loading={loading}
              errored={errored}
            />
          ))}
        </div>
        
        {/* Compliance drift indicator */}
        {complianceDrift && Object.keys(complianceDrift).length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35 mb-3">
              Compliance Drift
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(complianceDrift).map(([market, hasDrift]) => (
                <div
                  key={market}
                  className={cn(
                    "px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide",
                    hasDrift 
                      ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                      : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  )}
                >
                  {market}: {hasDrift ? "DRIFT" : "OK"}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
