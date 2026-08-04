"use client";
import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDashboardVolume } from "@/lib/api";
import { Card, CardAccent } from "@/components/ui/card";
import { Chart } from "@/components/ui/Chart";
import { Stat } from "@/components/ui/Stat";
import type { DashboardKPIs, DashboardVolumeDay } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/constants";

// ── Brand palette ──────────────────────────────────────────────────────────────
const BRAND = {
  cyan:   "#00d8d6",
  yellow: "#f7dc6f",
  pink:   "#f8a5c2",
  purple: "#a855f7",
  gray:   "#334155",
};

const CHART_STATUS_PALETTE: Record<string, string> = {
  SETTLED:       "#c084fc",
  PENDING:       BRAND.cyan,
  HITL_PENDING:  BRAND.cyan,
  DENIED:        "#4b5563",
  HITL_APPROVED: "#c084fc",
  HITL_DENIED:   "#4b5563",
  PROCESSING:    BRAND.cyan,
  CANCELLED:     "#374151",
  ERROR:         "#374151",
};

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function DarkTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-4 py-3 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-[10px] backdrop-blur-xl">
      {label && <p className="font-black uppercase tracking-[0.15em] text-white/40 mb-2">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="font-black" style={{ color: p.color }}>
          {p.name}: <span className="text-white">{p.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

// ── Volume period presets ──────────────────────────────────────────────────────
const PRESETS = [
  { label: "7D",  days: 7  },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

// ── Panel 1: Claims Volume Area Chart ─────────────────────────────────────────
function VolumePanel() {
  const [days, setDays]     = useState(30);
  const [open, setOpen]     = useState(false);
  const [volumeData, setVolumeData] = useState<DashboardVolumeDay[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getDashboardVolume(days)
      .then((r) => { if (live) { setVolumeData(r.days); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [days]);

  const chartData = volumeData.map((d) => ({
    name: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    Claims:  d.claims,
    Settled: d.settled,
    Fraud:   d.fraud,
  }));

  const totalClaims = volumeData.reduce((s, d) => s + d.claims,  0);
  const totalSettled= volumeData.reduce((s, d) => s + d.settled, 0);
  const settleRate  = totalClaims > 0 ? Math.round((totalSettled / totalClaims) * 100) : 0;

  return (
    <Card variant="surface" className="md:col-span-12 lg:col-span-4 bg-white/[0.03] backdrop-blur-3xl p-8 rounded-[40px] border-white/5 flex flex-col h-[400px] relative overflow-hidden group">
      <CardAccent className="h-[2px] bg-gradient-to-r from-transparent via-brand-primary/20 to-transparent" />

      <div className="flex items-center justify-between mb-6 shrink-0 relative z-10">
        <div>
          <h3 className="text-[13px] font-black text-white/40 uppercase tracking-[0.3em]">Claims Volume</h3>
          {!loading && (
            <p className="text-[11px] text-white/20 mt-1 font-black">
              <span className="text-brand-primary">{settleRate}%</span> settlement rate
            </p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/30 hover:bg-white/10 hover:text-white transition-all"
          >
            {PRESETS.find((p) => p.days === days)?.label ?? "30D"} <ChevronDown size={12} />
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-2 bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden z-20 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => { setDays(p.days); setOpen(false); }}
                  className={cn(
                    "block w-full px-5 py-2.5 text-left text-[10px] font-black uppercase tracking-widest transition-colors",
                    days === p.days ? "text-brand-primary bg-brand-primary/10" : "text-white/30 hover:text-white hover:bg-white/5"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Chart className="flex-1 w-full min-h-0 relative z-10">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGradClaims" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={BRAND.cyan} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={BRAND.cyan} stopOpacity={0}   />
                </linearGradient>
                <linearGradient id="areaGradSettled" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={BRAND.purple} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={BRAND.purple} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fontWeight: 900, fill: "rgba(255,255,255,0.12)", letterSpacing: "0.08em" }}
                dy={10}
                interval="preserveStartEnd"
              />
              <YAxis hide />
              <Tooltip content={<DarkTooltip />} cursor={{ stroke: "rgba(0,216,214,0.1)", strokeWidth: 2 }} />
              <Area
                type="monotone"
                dataKey="Claims"
                stroke={BRAND.cyan}
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#areaGradClaims)"
                dot={false}
                activeDot={{ r: 6, strokeWidth: 0, fill: BRAND.cyan }}
              />
              <Area
                type="monotone"
                dataKey="Settled"
                stroke={BRAND.purple}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#areaGradSettled)"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0, fill: BRAND.purple }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Chart>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-4 shrink-0 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 rounded-full" style={{ backgroundColor: BRAND.cyan }} />
          <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Claims</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 rounded-full" style={{ backgroundColor: BRAND.purple }} />
          <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Settled</span>
        </div>
      </div>
    </Card>
  );
}

// ── Panel 2: Status Donut ──────────────────────────────────────────────────────
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
};

function StatusDonutPanel({
  kpis, loading, displayCurrency = "INR",
}: { kpis?: DashboardKPIs; loading: boolean; displayCurrency?: string }) {
  const raw = kpis?.claims_by_status ?? {};
  const donutData = Object.entries(raw)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ name: STATUS_LABELS[key] ?? key, value, key }));

  const total = donutData.reduce((s, d) => s + d.value, 0);

  // Financial summary
  const currencySymbol = CURRENCY_SYMBOLS[displayCurrency] ?? displayCurrency;
  const settled = parseFloat(kpis?.total_settled_amount ?? "0");
  const settledFmt = settled >= 1_000_000
    ? `${currencySymbol}${(settled / 1_000_000).toFixed(1)}M`
    : settled >= 1_000
    ? `${currencySymbol}${(settled / 1_000).toFixed(1)}K`
    : `${currencySymbol}${settled.toFixed(0)}`;

  const denialRate = kpis?.denial_rate ?? 0;
  const settlePct  = total > 0 ? Math.round(((raw.SETTLED ?? 0) / total) * 100) : 0;

  return (
    <Card variant="surface" className="md:col-span-6 lg:col-span-4 bg-white/[0.03] backdrop-blur-3xl p-8 rounded-[40px] border-white/5 flex flex-col h-[400px] relative overflow-hidden group">
      <CardAccent className="h-[2px] bg-gradient-to-r from-transparent via-brand-accent-2/20 to-transparent" />

      <div className="flex items-center justify-between mb-6 shrink-0 relative z-10">
        <h3 className="text-[13px] font-black text-white/40 uppercase tracking-[0.3em]">Claims Breakdown</h3>
        <span className="px-3 py-1 bg-white/5 border border-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-white/20">
          Live
        </span>
      </div>

      <div className="flex flex-col flex-1 justify-between relative z-10">
        {/* Donut */}
        <div className="relative flex justify-center">
          <div className="w-[160px] h-[160px]">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData.length > 0 ? donutData : [{ name: "No data", value: 1, key: "" }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={72}
                    paddingAngle={donutData.length > 1 ? 6 : 0}
                    dataKey="value"
                    startAngle={180}
                    endAngle={-180}
                    isAnimationActive={true}
                  >
                    {(donutData.length > 0 ? donutData : [{ key: "" }]).map((entry, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={CHART_STATUS_PALETTE[entry.key] ?? BRAND.gray}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const { name, value } = payload[0];
                      const pct = total > 0 && value != null ? ((Number(value) / total) * 100).toFixed(1) : "0";
                      return (
                        <div className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-xl text-[10px] shadow-xl">
                          <p className="font-black text-white">{name}</p>
                          <p className="text-white/40 mt-0.5">{value} claims · {pct}%</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {!loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black font-mono text-white leading-none tracking-tighter">
                {settlePct}%
              </span>
              <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] mt-1">Settled</span>
            </div>
          )}
        </div>

        {/* Bottom stats */}
        <div className="mt-auto">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] mb-1">Settled Value</p>
              <h4 className="text-2xl font-black font-mono text-white tracking-tighter">{settledFmt}</h4>
            </div>
            <div className={cn(
              "flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg border",
              denialRate <= 10
                ? "text-emerald-400 bg-emerald-400/5 border-emerald-400/10"
                : "text-red-400 bg-red-400/5 border-red-400/10"
            )}>
              {denialRate <= 10 ? <TrendingDown size={12} strokeWidth={3} /> : <TrendingUp size={12} strokeWidth={3} />}
              {denialRate.toFixed(1)}% denial
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-white/5">
            {donutData.slice(0, 4).map((item) => (
              <div key={item.key} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHART_STATUS_PALETTE[item.key] ?? BRAND.gray }} />
                <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">
                  {item.name} <span className="text-white/50">{item.value}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Panel 3: Top Denial Reasons + Market Breakdown ────────────────────────────
function DenialReasonsPanel({ kpis, loading }: { kpis?: DashboardKPIs; loading: boolean }) {
  const reasons = kpis?.top_denial_reasons ?? [];
  const markets = kpis?.claims_by_market ?? {};
  const maxCount = reasons.length > 0 ? Math.max(...reasons.map((r) => r.count)) : 1;

  const marketData = Object.entries(markets)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([market, count]) => ({ market, count }));

  return (
    <Card variant="surface" className="md:col-span-6 lg:col-span-4 bg-white/[0.03] backdrop-blur-3xl p-8 rounded-[40px] border-white/5 flex flex-col h-[400px] relative overflow-hidden group">
      <CardAccent className="h-[2px] bg-gradient-to-r from-transparent via-brand-accent-1/20 to-transparent" />

      <h3 className="text-[13px] font-black text-white/40 uppercase tracking-[0.3em] mb-6 shrink-0 relative z-10">
        {reasons.length > 0 ? "Denial Reasons" : "By Market"}
      </h3>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
        </div>
      ) : reasons.length > 0 ? (
        // Horizontal bar chart for denial reasons
        <div className="flex-1 flex flex-col justify-evenly relative z-10 gap-2 overflow-hidden">
          {reasons.slice(0, 5).map((r, i) => {
            const pct = Math.round((r.count / maxCount) * 100);
            const colors = [BRAND.pink, BRAND.yellow, BRAND.cyan, BRAND.purple, "#ef4444"];
            return (
              <div key={r.reason} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40 truncate pr-2">
                    {r.reason.replace(/_/g, " ")}
                  </span>
                  <span className="text-[9px] font-black font-mono text-white/60 shrink-0">{r.count}</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : marketData.length > 0 ? (
        // Bar chart for market breakdown
        <Chart className="flex-1 w-full min-h-0 relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={marketData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="market"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fontWeight: 900, fill: "rgba(255,255,255,0.2)", letterSpacing: "0.08em" }}
                dy={8}
              />
              <YAxis hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-xl text-[10px] shadow-xl">
                      <p className="font-black text-brand-primary">{payload[0].payload.market}</p>
                      <p className="text-white/60 mt-0.5">{payload[0].value} claims</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" name="Claims" fill={BRAND.cyan} radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-white/20 font-black uppercase tracking-widest">No data yet</p>
        </div>
      )}
    </Card>
  );
}

function NativeObservabilityPanel({ kpis, loading }: { kpis?: DashboardKPIs; loading: boolean }) {
  const observability = kpis?.native_observability;
  const stages = Object.entries(observability?.stage_averages_ms ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const agents = observability?.agent_status_counts ?? {};
  const validationRates = Object.entries(observability?.validation_signal_rates ?? {})
    .sort(([a], [b]) => a.localeCompare(b));
  const priorities = Object.entries(observability?.hitl_priority_distribution ?? {})
    .sort(([a], [b]) => Number(a) - Number(b));

  return (
    <Card variant="surface" className="md:col-span-12 lg:col-span-4 bg-white/[0.03] backdrop-blur-3xl p-8 rounded-[40px] border-white/5 flex flex-col h-[400px] relative overflow-hidden group">
      <CardAccent className="h-[2px] bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      <div className="flex items-center justify-between mb-6 shrink-0 relative z-10">
        <h3 className="text-[13px] font-black text-white/40 uppercase tracking-[0.3em]">Native Journey</h3>
        <span className="px-3 py-1 bg-emerald-400/5 border border-emerald-400/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-300/70">
          Live
        </span>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-5 relative z-10 min-h-0">
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Stage Latency</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/30">
                {observability?.sla_breach_risk_count ?? 0} due-time risk
              </p>
            </div>
            <div className="space-y-2">
              {stages.length > 0 ? stages.map(([stage, ms]) => (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-28 truncate text-[9px] font-black uppercase tracking-widest text-white/35">
                    {stage.replace(/_/g, " ")}
                  </span>
                  <div className="h-1.5 flex-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-300"
                      style={{ width: `${Math.min(100, Math.max(4, ms / 30))}%` }}
                    />
                  </div>
                  <span className="w-14 text-right text-[10px] font-black font-mono text-white/55">{ms}ms</span>
                </div>
              )) : (
                <p className="text-[11px] text-white/20 font-black uppercase tracking-widest">Waiting for timed claims</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat tone="custom" className="border-white/5 bg-white/[0.025] p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/20 mb-3">Agents</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(agents).length > 0 ? Object.entries(agents).map(([status, count]) => (
                  <span key={status} className="text-[10px] font-black uppercase tracking-widest text-white/45">
                    {status} <span className="text-white/70">{count}</span>
                  </span>
                )) : <span className="text-[10px] font-black uppercase tracking-widest text-white/20">No agent data</span>}
              </div>
            </Stat>

            <Stat tone="custom" className="border-white/5 bg-white/[0.025] p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/20 mb-3">Review Priority</p>
              <div className="flex items-end gap-2 h-10">
                {priorities.length > 0 ? priorities.map(([priority, count]) => (
                  <div key={priority} className="flex flex-col items-center gap-1">
                    <div className="w-4 rounded-t bg-brand-accent-1/80" style={{ height: `${Math.max(8, count * 8)}px` }} />
                    <span className="text-[9px] font-black font-mono text-white/35">P{priority}</span>
                  </div>
                )) : <span className="text-[10px] font-black uppercase tracking-widest text-white/20">No queue</span>}
              </div>
            </Stat>
          </div>

          <div className="pt-4 border-t border-white/5">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20 mb-3">Validation Signals</p>
            <div className="grid grid-cols-5 gap-2">
              {validationRates.length > 0 ? validationRates.map(([signal, rate]) => (
                <div key={signal} className="text-center">
                  <p className="text-sm font-black font-mono text-white">{rate}%</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-white/25 truncate">{signal}</p>
                </div>
              )) : (
                <p className="col-span-5 text-[10px] font-black uppercase tracking-widest text-white/20">No document gate data</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
interface Props {
  kpis?:            DashboardKPIs;
  kpisLoading:      boolean;
  displayCurrency?: string;
}

export function AnalyticsDashboardRow({ kpis, kpisLoading, displayCurrency = "INR" }: Props) {
  return (
    <div className="px-8 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-6 bg-brand-accent-1 rounded-full" />
        <h2 className="text-[12px] font-black uppercase tracking-[0.4em] text-white/30">Performance Analytics</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <VolumePanel />
        <StatusDonutPanel kpis={kpis} loading={kpisLoading} displayCurrency={displayCurrency} />
        <DenialReasonsPanel kpis={kpis} loading={kpisLoading} />
        <NativeObservabilityPanel kpis={kpis} loading={kpisLoading} />
      </div>
    </div>
  );
}
