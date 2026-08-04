"use client";
import React from "react";
import {
  BarChart3, Globe, DollarSign, Zap, ClipboardCheck,
  ArrowUpRight, ArrowDownRight
} from "lucide-react";
import type { DashboardKPIs } from "@/lib/types";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: {
    value: string;
    isUp: boolean;
  };
  /** Semantic only (DESIGN_SYSTEM.md §1.2/§1.3) — "neutral" for plain
   * informational counts, "success"/"warning"/"danger"/"info" only when the
   * card actually communicates that status. Never decorative variety. */
  color?: "neutral" | "success" | "warning" | "danger" | "info";
}

function StatCard({ title, value, icon: Icon, trend, color = "neutral" }: StatCardProps) {
  const colorMap: Record<string, { border: string, bg: string, text: string, icon: string }> = {
    neutral: {
      border: "border-[var(--border-subtle)]",
      bg: "",
      text: "text-[var(--text-secondary)]",
      icon: "text-[var(--text-secondary)]",
    },
    info: {
      border: "border-[rgba(37,99,235,0.18)]",
      bg: "bg-[rgba(37,99,235,0.04)]",
      text: "text-brand-primary",
      icon: "text-brand-primary",
    },
    success: {
      border: "border-[rgba(5,150,105,0.18)]",
      bg: "bg-[rgba(5,150,105,0.04)]",
      text: "text-[var(--status-success)]",
      icon: "text-[var(--status-success)]",
    },
    warning: {
      border: "border-[rgba(217,119,6,0.18)]",
      bg: "bg-[rgba(217,119,6,0.04)]",
      text: "text-[var(--status-warning)]",
      icon: "text-[var(--status-warning)]",
    },
    danger: {
      border: "border-[rgba(220,38,38,0.18)]",
      bg: "bg-[rgba(220,38,38,0.04)]",
      text: "text-[var(--status-danger)]",
      icon: "text-[var(--status-danger)]",
    },
  };

  const theme = colorMap[color] || colorMap.neutral;

  return (
    <div className={`dashboard-panel min-h-[132px] overflow-hidden border ${theme.border} ${theme.bg}`}>
      <div className="relative flex h-full flex-col justify-center p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">{title}</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <h3 className="font-mono text-3xl font-black leading-none tabular-nums text-[var(--text-primary)]">{value}</h3>
              {trend && (
                <div className={`mb-0.5 flex items-center text-[10px] font-black uppercase tracking-[0.12em] ${trend.isUp ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}`}>
                  {trend.isUp ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                  {trend.value}
                </div>
              )}
            </div>
          </div>
          <span className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-2.5 ${theme.icon}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

interface ClaimsDashboardProps {
  stats?: DashboardKPIs;
  isLoading?: boolean;
}

export function ClaimsDashboard({ stats, isLoading }: ClaimsDashboardProps) {
  if (isLoading || !stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="dashboard-panel h-[132px] animate-pulse border border-white/10 bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      <StatCard
        title="Overall Volume"
        value={stats.total_claims}
        icon={BarChart3}
        color="neutral"
      />

      <StatCard
        title="Market Distribution"
        value={Object.keys(stats.claims_by_market).length}
        icon={Globe}
        color="neutral"
      />

      <StatCard
        title="Total Settlements"
        value={`${stats.display_currency || "INR"} ${parseFloat(stats.total_settled_amount).toLocaleString("en-IN")}`}
        icon={DollarSign}
        color="neutral"
        trend={{ value: "Target met", isUp: true }}
      />

      <StatCard
        title="Process Latency"
        value={`${(stats.avg_processing_time_ms / 1000).toFixed(2)}s`}
        icon={Zap}
        color="neutral"
      />

      <StatCard
        title="Review Quality"
        value={stats.pending_hitl_count}
        icon={ClipboardCheck}
        color={stats.overdue_hitl_count > 0 ? "danger" : "success"}
      />
    </div>
  );
}
