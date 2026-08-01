"use client";
import { useEffect, useState } from "react";
import { KPICard } from "./KPICard";
import type { DashboardKPIs } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { getDashboardVolume } from "@/lib/api";
import { AlertTriangle, CreditCard, FileText, ShieldAlert } from "lucide-react";

interface KPIGridProps {
  kpis?: DashboardKPIs;
  isLoading: boolean;
  dateFrom?: string;
  dateTo?: string;
  displayCurrency?: string;
  marketRegion?: string;
  periodLabel?: string;
}

function claimsUrl(status?: string, dateFrom?: string, dateTo?: string, marketRegion?: string) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (dateFrom) p.set("received_date_from", dateFrom);
  if (dateTo) p.set("received_date_to", dateTo);
  if (marketRegion) p.set("market_region", marketRegion);
  const qs = p.toString();
  return `/claims${qs ? `?${qs}` : ""}`;
}

function clampPercent(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.min(100, Math.max(0, Number(value)));
}

function formatPercentage(value?: number): string {
  if (!Number.isFinite(value ?? NaN)) return "—";
  const num = clampPercent(value);
  return num % 1 === 0 ? `${num}%` : `${num}%`.replace(/\.0+$/, '');
}

export function KPIGrid({ kpis, isLoading, dateFrom, dateTo, displayCurrency, marketRegion, periodLabel }: KPIGridProps) {
  const currency = kpis?.display_currency ?? displayCurrency ?? "INR";
  const [trends, setTrends] = useState<{
    claims?: { value: number };
    settled?: { value: number };
  }>({});
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayInSelectedRange = Boolean(
    dateFrom && dateTo && dateFrom <= todayISO && todayISO <= dateTo
  );
  const activeScopeLabel = periodLabel ?? "Selected filter";

  useEffect(() => {
    let cancelled = false;
    async function fetchTrends() {
      try {
        setTrends({});
        const res = await getDashboardVolume(2, dateFrom, dateTo, marketRegion, currency);
        if (cancelled) return;
        const days = res.days || [];
        if (days.length >= 2) {
          const today = days[days.length - 1];
          const yesterday = days[days.length - 2];

          const claimsDelta = yesterday.claims > 0 
            ? ((today.claims - yesterday.claims) / yesterday.claims) * 100 
            : 0;
          
          const amountDelta = yesterday.amount > 0 
            ? ((today.amount - yesterday.amount) / yesterday.amount) * 100 
            : 0;

          setTrends({
            claims: { value: claimsDelta },
            settled: { value: amountDelta },
          });
        }
      } catch {
        if (!cancelled) setTrends({});
      }
    }
    fetchTrends();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, marketRegion, currency]);

  const autoAdjudicationRate = clampPercent(kpis?.auto_adjudication_rate);
  const avgProcessingMs = kpis?.avg_processing_ms ?? kpis?.avg_processing_time_ms ?? 0;
  const avgProcessingSeconds = avgProcessingMs > 0 ? `${(avgProcessingMs / 1000).toFixed(1)}s` : "0.0s";
  const blockedClaims = kpis?.pipeline_stages?.denied
    ?? ((kpis?.claims_by_status?.DENIED ?? 0) + (kpis?.claims_by_status?.HITL_DENIED ?? 0) + (kpis?.claims_by_status?.ERROR ?? 0));

   return (
    <div className="@container">
    <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @4xl:grid-cols-4">
      <KPICard
        title="Total Claims"
        value={kpis?.total_claims.toLocaleString() ?? "—"}
        subLabel={
          kpis
            ? todayInSelectedRange
              ? `${kpis.claims_today} received today`
              : "Filtered date range"
            : undefined
        }
        footerRight={activeScopeLabel}
        colorScheme="neutral"
        icon={FileText}
        trend={trends.claims}
        isLoading={isLoading}
        href={claimsUrl(undefined, dateFrom, dateTo, marketRegion)}
      />

      <KPICard
        title="Manual Review"
        value={kpis?.pending_hitl_count ?? "—"}
        subLabel={kpis ? `${kpis.overdue_hitl_count} overdue` : undefined}
        footerRight={marketRegion ? `${marketRegion} review queue` : "Filtered review queue"}
        colorScheme="warning"
        icon={AlertTriangle}
        isLoading={isLoading}
        urgent={(kpis?.pending_hitl_count ?? 0) > 0}
        href="/hitl"
      />

      <KPICard
        title="Blocked Claims"
        value={kpis ? blockedClaims.toLocaleString() : "—"}
        subLabel={kpis ? `${formatPercentage(kpis.denial_rate)} denial rate` : undefined}
        footerRight={blockedClaims > 0 ? activeScopeLabel : "No blocked exposure"}
        colorScheme="danger"
        icon={ShieldAlert}
        isLoading={isLoading}
        urgent={blockedClaims > 0}
        href={claimsUrl("DENIED", dateFrom, dateTo, marketRegion)}
      />

      <KPICard
        title="Settled Value"
        value={kpis ? formatCurrency(kpis.total_settled_amount, currency) : "—"}
        subLabel={kpis ? `${formatPercentage(autoAdjudicationRate)} auto-adjudicated` : undefined}
        footerRight={`${activeScopeLabel} · Avg ${avgProcessingSeconds}`}
        colorScheme="success"
        icon={CreditCard}
        trend={trends.settled}
        isLoading={isLoading}
        href={claimsUrl("SETTLED", dateFrom, dateTo, marketRegion)}
      />
    </div>
    </div>
  );
}
