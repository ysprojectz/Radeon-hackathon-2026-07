"use client";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";

interface Props {
  fraudToday?: string;
  fraudTotal?: string;
  isLoading: boolean;
  currency?: string;
}

// Emerald color theme matching analytics dashboard (INDIAN market color)
const EMERALD_THEME = {
  accent: "#10B981",
  bg: "#10B981",
  glow: "rgba(16, 185, 129, 0.30)",
  soft: "rgba(16, 185, 129, 0.12)",
};

function fmt(value?: string): string {
  if (!value) return "0";
  const n = parseFloat(value);
  if (isNaN(n) || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function FraudPrevented({ fraudToday, fraudTotal, isLoading, currency = "AED" }: Props) {
  const totalVal  = parseFloat(fraudTotal ?? "0");
  const todayVal  = parseFloat(fraudToday ?? "0");
  const hasTotal  = !isLoading && totalVal > 0;
  const hasToday  = !isLoading && todayVal > 0;

  return (
    <Card variant="dashboard" className="h-full min-h-0">
      {/* Emerald theme - top accent and glow */}
      <CardAccent className="bg-gradient-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0" />
      <CardGlow className="-bottom-8 -left-8" style={{ background: EMERALD_THEME.glow, opacity: 0.24 }} />

      <div className="relative p-5">
        {/* Header */}
        <div className="dashboard-panel-header mb-5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
              Fraud Prevented
            </p>
          </div>
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        {/* Main value */}
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-2 w-20 rounded-full bg-white/10" />
            <div className="h-10 w-32 rounded-lg bg-white/10" />
          </div>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/25 mb-1">
              Total Blocked Value
            </p>
            <p className={cn(
              "text-[2.4rem] font-black font-mono leading-none tracking-tighter tabular-nums",
              hasTotal ? "text-emerald-400" : "text-white/20"
            )}>
              {hasTotal ? `${currency} ${fmt(fraudTotal)}` : "—"}
            </p>
          </>
        )}

        {/* Divider + today */}
        {!isLoading && (
          <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25 mb-1">Today</p>
              <p className={cn(
                "text-lg font-black font-mono tabular-nums",
                hasToday ? "text-emerald-300" : "text-white/25"
              )}>
                {hasToday ? `${currency} ${fmt(fraudToday)}` : "—"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wide">
              <ShieldCheck className="w-3 h-3" />
              Protected
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
