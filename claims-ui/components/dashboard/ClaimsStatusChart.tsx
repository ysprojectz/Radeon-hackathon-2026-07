"use client";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { STATUS_LABELS } from "@/lib/constants";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";
import { Chart } from "@/components/ui/Chart";
import { Stat } from "@/components/ui/Stat";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import type { AnalyticsCardDesign } from "./analyticsCardDesign";

const CHART_COLORS: Record<string, string> = {
  SETTLED:       "#c084fc",
  PENDING:       "var(--brand-primary)",
  HITL_PENDING:  "var(--brand-warning)",
  DENIED:        "var(--brand-danger)",
  HITL_APPROVED: "#c084fc",
  HITL_DENIED:   "var(--brand-danger)",
  PROCESSING:    "var(--brand-primary)",
  CANCELLED:     "#4b5563",
  ERROR:         "#f97316",
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { key: string } }>;
  total: number;
}

function ChartTooltip({ active, payload, total }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
  return (
    <div className="bg-[#0f1117] border border-white/[0.08] px-3 py-2 rounded-xl shadow-2xl text-xs backdrop-blur-xl">
      <p className="font-black text-white">{name}</p>
      <p className="text-white/40 mt-0.5 font-mono tabular-nums">
        {value} claims · {pct}%
      </p>
    </div>
  );
}

interface ClaimsStatusChartProps {
  data?: Record<string, number>;
  isLoading: boolean;
  design?: AnalyticsCardDesign;
}

export function ClaimsStatusChart({ data, isLoading, design = "command" }: ClaimsStatusChartProps) {
  const router = useRouter();

  const chartData = data
    ? Object.entries(data)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([key, value]) => ({
          name: STATUS_LABELS[key] ?? key,
          value,
          key,
        }))
    : [];

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  // Derived insight metrics
  const approved = (data?.SETTLED ?? 0) + (data?.HITL_APPROVED ?? 0);
  const denied   = (data?.DENIED ?? 0) + (data?.HITL_DENIED ?? 0);
  const review   = (data?.HITL_PENDING ?? 0) + (data?.PROCESSING ?? 0);
  const pending  = data?.PENDING ?? 0;

  const approvalRate = total > 0 ? ((approved / total) * 100) : 0;
  const denialRate   = total > 0 ? ((denied   / total) * 100) : 0;
  const reviewRate   = total > 0 ? ((review   / total) * 100) : 0;
  const pendingRate  = total > 0 ? ((pending  / total) * 100) : 0;
  const topStatus = chartData[0];
  const throughputRate = total > 0 ? (((approved + denied) / total) * 100) : 0;
  const topStatusShare = topStatus ? ((topStatus.value / total) * 100) : 0;

  const handleSegmentClick = (status: string) => {
    if (status === "HITL_PENDING" || status === "PENDING") {
      router.push("/hitl");
    } else {
      router.push(`/claims?status=${status}`);
    }
  };

  const insightStats = [
    {
      label: "Approved",
      value: approvalRate,
      count: approved,
      icon: CheckCircle2,
      color: "#c084fc",
      bg: "bg-fuchsia-400/10",
      border: "border-fuchsia-400/15",
      text: "text-fuchsia-300",
    },
    {
      label: "Denied",
      value: denialRate,
      count: denied,
      icon: XCircle,
      color: "var(--brand-danger)",
      bg: "bg-red-400/10",
      border: "border-red-400/15",
      text: "text-red-400",
    },
    {
      label: "In Review",
      value: reviewRate,
      count: review,
      icon: AlertTriangle,
      color: "var(--brand-warning)",
      bg: "bg-amber-400/10",
      border: "border-amber-400/15",
      text: "text-amber-300",
    },
    {
      label: "Pending",
      value: pendingRate,
      count: pending,
      icon: Clock,
      color: "var(--brand-primary)",
      bg: "bg-cyan-400/10",
      border: "border-cyan-400/15",
      text: "text-cyan-300",
    },
  ];

  const renderDonut = (size = 176, inner = 56, outer = 88) => (
    <Chart
      className="mx-auto shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Claims status distribution chart with ${total} total claims`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
            stroke="none"
            onClick={(d) => handleSegmentClick(d.key)}
            cursor="pointer"
            isAnimationActive
            animationBegin={0}
            animationDuration={600}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.key}
                fill={CHART_COLORS[entry.key] ?? "#94a3b8"}
                className="cursor-pointer transition-opacity hover:opacity-75"
                style={{ outline: "none" }}
              />
            ))}
          </Pie>
          <text
            x="50%" y="45%"
            textAnchor="middle" dominantBaseline="central"
            fill="white"
            style={{ fontSize: size > 180 ? 30 : 25, fontWeight: 900, fontFamily: "var(--font-jetbrains-mono), monospace" }}
          >
            {total}
          </text>
          <text
            x="50%" y="61%"
            textAnchor="middle" dominantBaseline="central"
            fill="rgba(255,255,255,0.28)"
            style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.14em" }}
          >
            TOTAL
          </text>
          <Tooltip content={<ChartTooltip total={total} />} />
        </PieChart>
      </ResponsiveContainer>
    </Chart>
  );

  const renderMetricTile = (s: typeof insightStats[number], compact = false) => (
    <Stat
      key={s.label}
      tone="custom"
      className={`${s.border} ${s.bg} ${compact ? "px-3 py-2" : "px-3.5 py-3"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <s.icon size={compact ? 12 : 14} className={s.text} strokeWidth={2.4} />
          <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-white/42">
            {s.label}
          </span>
        </div>
        <span className="font-mono text-[10px] font-black text-white/40">{s.count.toLocaleString()}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className={`font-mono ${compact ? "text-lg" : "text-2xl"} font-black leading-none tabular-nums ${s.text}`}>
          {s.value.toFixed(1)}<span className="ml-0.5 text-[0.58em] opacity-60">%</span>
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full" style={{ width: `${s.value}%`, backgroundColor: s.color }} />
        </div>
      </div>
    </Stat>
  );

  const renderCommand = () => (
    <>
      <div className="grid flex-1 gap-4 xl:grid-cols-[190px_minmax(0,1fr)] xl:items-start">
        <div className="shrink-0 xl:pt-2">{renderDonut(190, 60, 95)}</div>
        <div className="custom-scrollbar min-h-0 max-h-[220px] overflow-y-auto space-y-2 pr-1">
          {chartData.slice(0, 5).map((entry) => {
            const pct = total > 0 ? ((entry.value / total) * 100) : 0;
            return (
              <button
                type="button"
                key={entry.key}
                onClick={() => handleSegmentClick(entry.key)}
                className="group w-full rounded-2xl border border-white/[0.05] bg-white/[0.035] px-3 py-2 text-left transition hover:border-white/[0.12] hover:bg-white/[0.07]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[entry.key] ?? "#94a3b8" }} />
                    <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-white/64 group-hover:text-white">
                      {entry.name}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-xs font-black text-white/78">{entry.value.toLocaleString()}</span>
                    <span className="ml-2 font-mono text-[9px] text-white/35">{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[entry.key] ?? "#94a3b8" }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        {insightStats.slice(0, 4).map((s) => renderMetricTile(s, true))}
      </div>
    </>
  );

  const renderFlow = () => (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Stat tone="success" className="px-3 py-3">
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/34">Decisioned</p>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-200">{throughputRate.toFixed(0)}%</p>
        </Stat>
        <Stat tone="warning" className="px-3 py-3">
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/34">Review Load</p>
          <p className="mt-1 font-mono text-2xl font-black text-amber-200">{review.toLocaleString()}</p>
        </Stat>
        <Stat tone="custom" className="border-fuchsia-300/15 bg-fuchsia-300/[0.07] px-3 py-3 text-fuchsia-200">
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/34">Approved</p>
          <p className="mt-1 font-mono text-2xl font-black text-fuchsia-200">{approved.toLocaleString()}</p>
        </Stat>
      </div>
      <div className="custom-scrollbar min-h-0 max-h-[240px] flex-1 space-y-2 overflow-y-auto pr-1">
        {chartData.map((entry, index) => {
          const pct = total > 0 ? ((entry.value / total) * 100) : 0;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => handleSegmentClick(entry.key)}
              className="grid w-full grid-cols-[28px_minmax(0,1fr)_64px] items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <span className="font-mono text-[10px] font-black text-white/24">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-white/66">{entry.name}</span>
                  <span className="font-mono text-[9px] text-white/35">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[entry.key] ?? "#94a3b8" }} />
                </div>
              </div>
              <span className="text-right font-mono text-sm font-black text-white/72">{entry.value.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  const renderLedger = () => (
    <>
      <div className="grid flex-1 gap-3 xl:grid-cols-[150px_minmax(0,1fr)]">
        <Stat className="rounded-[1.45rem] bg-white/[0.025] p-2">
          {renderDonut(136, 43, 68)}
          <div className="px-2 pb-2 text-center">
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/30">Largest</p>
            <p className="mt-1 truncate text-xs font-black text-white/78">{topStatus?.name ?? "None"}</p>
          </div>
        </Stat>
        <div className="grid min-h-0 grid-cols-2 gap-2">
          {insightStats.map((s) => renderMetricTile(s))}
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <Stat>
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Decisioned</p>
          <p className="mt-1 font-mono text-lg font-black text-white/78">{throughputRate.toFixed(1)}%</p>
        </Stat>
        <Stat>
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Top Share</p>
          <p className="mt-1 font-mono text-lg font-black text-white/78">{topStatusShare.toFixed(1)}%</p>
        </Stat>
      </div>
    </>
  );

  return (
    <Card variant="dashboard" className="flex h-[460px] flex-col overflow-hidden">
      <CardGlow className="-bottom-10 -left-10 bg-fuchsia-400/30" />
      <CardAccent className="bg-gradient-to-r from-fuchsia-400/0 via-fuchsia-400/50 to-fuchsia-400/0" />

      <div className="relative flex flex-1 flex-col gap-3 p-4">
        {/* Header */}
        <div className="dashboard-panel-header shrink-0">
          <div className="dashboard-panel-title">
            <span className="dashboard-panel-dot bg-fuchsia-300" />
            <p className="dashboard-panel-label">Claims by Status</p>
          </div>
          <span className="rounded-full border border-fuchsia-300/15 bg-fuchsia-300/10 px-2.5 py-0.5 text-[9px] font-semibold text-fuchsia-200/90">
            {total} total
          </span>
        </div>

        {isLoading ? (
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-center gap-3.5">
              <div className="h-44 w-44 shrink-0 rounded-full border border-white/[0.05] bg-white/[0.04] animate-pulse" />
              <div className="flex-1 space-y-2">
                {[90, 70, 55, 40].map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-white/[0.06] animate-pulse shrink-0" />
                    <div className="h-2.5 rounded-md bg-white/[0.04] animate-pulse" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[0,1,2,3].map(i => (
                <div key={i} className="h-10 rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/25 font-semibold">
            No data yet
          </div>
        ) : (
          design === "flow" ? renderFlow() : design === "ledger" ? renderLedger() : renderCommand()
        )}
      </div>
    </Card>
  );
}
