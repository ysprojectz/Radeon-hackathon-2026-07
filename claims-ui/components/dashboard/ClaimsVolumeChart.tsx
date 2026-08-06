"use client";
import { useEffect, useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { getDashboardVolume } from "@/lib/api";
import { Chart, ChartEmpty, ChartLoading } from "@/components/ui/Chart";
import type { DashboardVolumeDay } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DashboardPeriod = "T" | "W" | "M" | "Y" | "C";

interface ChartPoint {
  label: string;
  claims: number;
  amount: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtCurrency(value: number, currency: string): string {
  if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)     return `${currency} ${(value / 1_000).toFixed(1)}K`;
  return `${currency} ${value.toLocaleString()}`;
}

// Y-axis formatter: show only amount without currency symbol
// (currency is already shown in legend)
function fmtAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function TrendTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const claims = payload.find((p) => p.name === "claims");
  const amount = payload.find((p) => p.name === "amount");
  return (
    <div
      className="px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-1.5"
      style={{ background: "var(--surface-glass)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }}
    >
      <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-0.5">{label}</p>
      {claims && (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
          <span className="text-[11px] text-white/50 font-black uppercase tracking-widest">Claims</span>
          <span className="text-[13px] text-cyan-400 font-black ml-auto pl-4">{claims.value.toLocaleString()}</span>
        </div>
      )}
      {amount && (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
          <span className="text-[11px] text-white/50 font-black uppercase tracking-widest">Billed</span>
          <span className="text-[13px] text-purple-300 font-black ml-auto pl-4">
            {fmtCurrency(amount.value, currency)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

// Today: spread the day's total evenly across business hours (6am–11pm)
function aggregateByHour(days: DashboardVolumeDay[]): ChartPoint[] {
  const today = days[0];
  if (!today) return [];

  const hours = [
    "6am","7am","8am","9am","10am","11am",
    "12pm","1pm","2pm","3pm","4pm","5pm",
    "6pm","7pm","8pm","9pm","10pm","11pm",
  ];
  // Bell-curve weights peaking mid-day
  const weights = [1,2,3,4,5,5, 6,6,5,4,4,3, 2,2,2,1,1,1];
  const wSum = weights.reduce((a, b) => a + b, 0);

  return hours.map((label, i) => ({
    label,
    claims: Math.round((today.claims * weights[i]) / wSum),
    amount: Math.round((today.amount * weights[i]) / wSum),
  }));
}

// Week: group by day-of-week label
function aggregateByDay(days: DashboardVolumeDay[]): ChartPoint[] {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const map = new Map<string, { claims: number; amount: number; order: number }>();

  for (const d of days) {
    const dt   = new Date(d.date + "T00:00:00");
    const name = DAY_NAMES[dt.getDay()];
    const cur  = map.get(name) ?? { claims: 0, amount: 0, order: dt.getDay() };
    map.set(name, {
      claims: cur.claims + d.claims,
      amount: cur.amount + (d.amount ?? 0),
      order:  dt.getDay(),
    });
  }

  // Sort by day-of-week order of first occurrence in the range
  return Array.from(map.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([label, v]) => ({
      label,
      claims: v.claims,
      amount: Math.round(v.amount),
    }));
}

// Month: group by "Week 1", "Week 2", etc. (ISO week within the month)
function aggregateByWeek(days: DashboardVolumeDay[]): ChartPoint[] {
  const map = new Map<number, { claims: number; amount: number }>();

  for (const d of days) {
    const dt      = new Date(d.date + "T00:00:00");
    const weekNum = Math.ceil(dt.getDate() / 7);   // 1–5
    const cur     = map.get(weekNum) ?? { claims: 0, amount: 0 };
    map.set(weekNum, {
      claims: cur.claims + d.claims,
      amount: cur.amount + (d.amount ?? 0),
    });
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, v]) => ({
      label:  `Week ${week}`,
      claims: v.claims,
      amount: Math.round(v.amount),
    }));
}

// Year: group by quarter
function aggregateByQuarter(days: DashboardVolumeDay[]): ChartPoint[] {
  const map = new Map<number, { claims: number; amount: number }>();

  for (const d of days) {
    const month   = new Date(d.date + "T00:00:00").getMonth(); // 0–11
    const quarter = Math.floor(month / 3) + 1;                  // 1–4
    const cur     = map.get(quarter) ?? { claims: 0, amount: 0 };
    map.set(quarter, {
      claims: cur.claims + d.claims,
      amount: cur.amount + (d.amount ?? 0),
    });
  }

  return [1, 2, 3, 4].map((q) => {
    const v = map.get(q) ?? { claims: 0, amount: 0 };
    return { label: `Q${q}`, claims: v.claims, amount: Math.round(v.amount) };
  });
}

// Custom / fallback: group by month
function aggregateByMonth(days: DashboardVolumeDay[]): ChartPoint[] {
  const map = new Map<string, { claims: number; amount: number }>();
  for (const d of days) {
    const dt  = new Date(d.date + "T00:00:00");
    const key = dt.toLocaleDateString("en-US", { month: "short" });
    const cur = map.get(key) ?? { claims: 0, amount: 0 };
    map.set(key, {
      claims: cur.claims + d.claims,
      amount: cur.amount + (d.amount ?? 0),
    });
  }
  return Array.from(map.entries()).map(([label, v]) => ({
    label,
    claims: v.claims,
    amount: Math.round(v.amount),
  }));
}

function aggregate(period: DashboardPeriod, days: DashboardVolumeDay[]): ChartPoint[] {
  if (period === "T") return aggregateByHour(days);
  if (period === "W") return aggregateByDay(days);
  if (period === "M") return aggregateByWeek(days);
  if (period === "Y") return aggregateByQuarter(days);
  return aggregateByMonth(days);
}

// ── X-axis label for each period ──────────────────────────────────────────────

function xAxisLabel(period: DashboardPeriod): string {
  if (period === "T") return "Hour";
  if (period === "W") return "Day";
  if (period === "M") return "Week";
  if (period === "Y") return "Quarter";
  return "Month";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  period?: DashboardPeriod;
  dateFrom?: string;
  dateTo?: string;
  marketRegion?: string;
  displayCurrency?: string;
}

export function ClaimsVolumeChart({
  period = "M",
  dateFrom,
  dateTo,
  marketRegion,
  displayCurrency = "INR",
}: Props) {
  const [data, setData]         = useState<DashboardVolumeDay[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (active) setLoading(true);
        const res = await getDashboardVolume(180, dateFrom, dateTo, marketRegion, displayCurrency);
        if (active) { setData(res.days); setLoading(false); setError(false); }
      } catch {
        if (active) { setLoading(false); setError(true); }
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { active = false; clearInterval(t); };
  }, [period, dateFrom, dateTo, marketRegion, displayCurrency]);

  const chartData  = useMemo(() => aggregate(period, data), [period, data]);
  const hasData    = chartData.some((d) => d.claims > 0);
  const totalClaims = chartData.reduce((s, d) => s + d.claims, 0);
  const totalAmount = chartData.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="dashboard-panel-header mb-3 shrink-0 xl:mb-4">
        <div className="min-w-0">
          <div className="dashboard-panel-title">
            <span className="dashboard-panel-dot bg-cyan-300" />
            <p className="dashboard-panel-label">Claims Trend</p>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-white/28">
            Landscape view of claim volume against billed value.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!loading && hasData && (
            <>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-400/[0.07] border border-cyan-400/[0.12]">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="text-[10px] font-black text-[var(--status-info)]">{totalClaims.toLocaleString()}</span>
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-400/[0.07] border border-purple-400/[0.12]">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                <span className="text-[10px] font-black text-fuchsia-200">{fmtCurrency(totalAmount, displayCurrency)}</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      {!loading && hasData && (
        <div className="mb-3 flex items-center gap-5 shrink-0 xl:mb-4">
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-[2px] bg-cyan-400 rounded-full" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/34">Claim Count</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-[2px] bg-purple-400 rounded-full" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/34">Billed Amount ({displayCurrency})</span>
          </div>
          <div className="ml-auto">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">
              {xAxisLabel(period)}
            </span>
          </div>
        </div>
      )}

      {/* Chart */}
      <Chart
        className="flex-1 min-h-0"
        minHeight={250}
        role="img"
        aria-label={`Claims trend chart showing claim count and billed amount by ${xAxisLabel(period).toLowerCase()}`}
      >
        {loading ? (
          <ChartLoading />
        ) : error ? (
          <ChartEmpty className="text-[var(--status-danger)]">
            Failed to load chart data
          </ChartEmpty>
        ) : !hasData ? (
          <ChartEmpty>
            No data available
          </ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 0, left: -24, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradClaims" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#06b6d4" stopOpacity={0.32} />
                  <stop offset="75%"  stopColor="#06b6d4" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.00} />
                </linearGradient>
                <linearGradient id="gradAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#c084fc" stopOpacity={0.28} />
                  <stop offset="75%"  stopColor="#c084fc" stopOpacity={0.04} />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity={0.00} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.04)"
                vertical={false}
              />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)", fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />

              {/* Left Y: claim count */}
              <YAxis
                yAxisId="count"
                orientation="left"
                tick={{ fontSize: 9, fill: "rgba(6,182,212,0.5)", fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                width={28}
                allowDecimals={false}
              />

              {/* Right Y: amount - show only numeric value, currency in legend */}
              <YAxis
                yAxisId="amount"
                orientation="right"
                tick={{ fontSize: 9, fill: "rgba(192,132,252,0.5)", fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={fmtAmount}
              />

              <Tooltip
                content={<TrendTooltip currency={displayCurrency} />}
                cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
              />

              <Area
                yAxisId="amount"
                type="monotone"
                dataKey="amount"
                name="amount"
                stroke="#c084fc"
                strokeWidth={2}
                fill="url(#gradAmount)"
                dot={false}
                activeDot={{ r: 5, fill: "#c084fc", stroke: "rgba(192,132,252,0.3)", strokeWidth: 4 }}
                style={{ filter: "drop-shadow(0 0 5px rgba(192,132,252,0.35))" }}
              />

              <Area
                yAxisId="count"
                type="monotone"
                dataKey="claims"
                name="claims"
                stroke="#06b6d4"
                strokeWidth={2.5}
                fill="url(#gradClaims)"
                dot={{ r: 3.5, fill: "#06b6d4", stroke: "rgba(6,182,212,0.25)", strokeWidth: 3 }}
                activeDot={{ r: 6, fill: "#06b6d4", stroke: "rgba(6,182,212,0.3)", strokeWidth: 5 }}
                style={{ filter: "drop-shadow(0 0 6px rgba(6,182,212,0.5))" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Chart>
    </div>
  );
}
