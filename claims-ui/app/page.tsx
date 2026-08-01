"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertTriangle, Database } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ClaimsStatusChart } from "@/components/dashboard/ClaimsStatusChart";
import { ClaimsMarketChart } from "@/components/dashboard/ClaimsMarketChart";
import { ClaimsVolumeChart } from "@/components/dashboard/ClaimsVolumeChart";
import { ActivityFeed }      from "@/components/dashboard/ActivityFeed";
import { TimePeriodFilter }  from "@/components/dashboard/TimePeriodFilter";
import { PageHeader }        from "@/components/shared/PageHeader";
import { ClaimStatusBadge } from "@/components/claims/ClaimStatusBadge";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { CalendarCard } from "@/components/dashboard/CalendarCard";
import { DashboardRegionFilter } from "@/components/dashboard/DashboardRegionFilter";
import { KPIGrid } from "@/components/dashboard/KPIGrid";
import { PipelineFlow } from "@/components/dashboard/PipelineFlow";
import { SLAGauge } from "@/components/dashboard/SLAGauge";
import { FraudPrevented } from "@/components/dashboard/FraudPrevented";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CLAIM_TYPE_LABELS, MARKET_CURRENCY, STATUS_LABELS } from "@/lib/constants";
import type { CalendarEventType } from "@/lib/calendar";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import { useClaims } from "@/lib/hooks/useClaims";
import { useHITLQueue } from "@/lib/hooks/useHITLQueue";
import { useProactiveIntelligence } from "@/lib/hooks/useProactiveIntelligence";
import { NeuralIntelligenceTicker } from "@/components/dashboard/NeuralIntelligenceTicker";
import {
  formatDate,
  getTodayRange,
  getWeekRange,
  getMonthRange,
  getMonthRangeForMonth,
  getMonthName,
  getYearRange,
  getYearRangeForYear,
  cn,
} from "@/lib/utils";
import type { DashboardPeriod } from "@/lib/types";

export default function DashboardPage() {

  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Time Period Filter State ──────────────────────────────────────────────
  const [period, setPeriod] = useState<DashboardPeriod>("Y");
  const [selectedYear, setSelectedYear] = useState<number | "Current">("Current");
  const [selectedMonth, setSelectedMonth] = useState<number | "Current">("Current");
  const [customFrom, setCustomFrom] = useState<string | undefined>();
  const [customTo, setCustomTo] = useState<string | undefined>();
  const [marketRegion, setMarketRegion] = useState("");

  // Use market-specific currency (USD, AED, INR, etc.) for all claim values
  const dashboardCurrency = marketRegion ? (MARKET_CURRENCY[marketRegion] ?? "USD") : "USD";

  // Initialize from URL params on mount
  useEffect(() => {
    const urlPeriod = searchParams.get("period") as DashboardPeriod | null;
    const urlYear = searchParams.get("year");
    const urlMonth = searchParams.get("month");
    const urlFrom = searchParams.get("from");
    const urlTo = searchParams.get("to");
    const urlMarket = searchParams.get("market");

    const validPeriod = urlPeriod && ["T", "W", "M", "Y", "C"].includes(urlPeriod) ? urlPeriod : null;
    const nextPeriod = validPeriod ?? "Y";
    setPeriod(nextPeriod);
    if (!validPeriod) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", "Y");
      router.replace(`?${params.toString()}`, { scroll: false });
    }
    if (urlYear) {
      setSelectedYear(urlYear === "Current" ? "Current" : parseInt(urlYear, 10));
    }
    if (urlMonth) {
      setSelectedMonth(urlMonth === "Current" ? "Current" : parseInt(urlMonth, 10));
    }
    setCustomFrom(urlFrom ?? undefined);
    setCustomTo(urlTo ?? undefined);
    setMarketRegion(urlMarket ?? "");
  }, [router, searchParams]);

  // Calculate date range based on selected period
  let dateFrom: string | undefined;
  let dateTo: string | undefined;

  if (period === "T") {
    const range = getTodayRange();
    dateFrom = range.from;
    dateTo = range.to;
  } else if (period === "W") {
    const range = getWeekRange();
    dateFrom = range.from;
    dateTo = range.to;
  } else if (period === "M") {
    if (selectedMonth === "Current") {
      const range = getMonthRange();
      dateFrom = range.from;
      dateTo = range.to;
    } else {
      const range = getMonthRangeForMonth(selectedMonth, selectedYear === "Current" ? undefined : selectedYear);
      dateFrom = range.from;
      dateTo = range.to;
    }
  } else if (period === "Y") {
    if (selectedYear === "Current") {
      const range = getYearRange();
      dateFrom = range.from;
      dateTo = range.to;
    } else {
      const range = getYearRangeForYear(selectedYear);
      dateFrom = range.from;
      dateTo = range.to;
    }
  } else if (period === "C") {
    dateFrom = customFrom;
    dateTo = customTo;
  }

  const customRangeIncomplete = period === "C" && (!customFrom || !customTo);
  const customRangeInvalid = period === "C" && Boolean(customFrom && customTo && customFrom > customTo);
  const dashboardFiltersReady = !customRangeIncomplete && !customRangeInvalid;

  // Fetch KPIs with date filtering
  const { kpis, error: kpisError, isLoading: kpisLoading } = useDashboardKPIs({
    dateFrom,
    dateTo,
    marketRegion: marketRegion || undefined,
    displayCurrency: dashboardCurrency,
    enabled: dashboardFiltersReady,
  });

  // Fetch recent claims with same date filter (by received date)
  const { data: recentClaims, isLoading: claimsLoading } = useClaims({
    page_size: 50,
    market_region: marketRegion || undefined,
    received_date_from: dateFrom,
    received_date_to: dateTo,
  }, {
    enabled: dashboardFiltersReady,
  });

  const { queue: hitlQueue } = useHITLQueue();
  const { visibleAlerts, dismiss } = useProactiveIntelligence(kpis, hitlQueue);

  const dbDisconnected = kpis && kpis.db_available === false;
  const updateDashboardQuery = useCallback((next: {
    period?: DashboardPeriod;
    year?: number | "Current";
    month?: number | "Current";
    from?: string;
    to?: string;
    market?: string;
  }) => {
    const nextPeriod = next.period ?? period;
    const nextYear = next.year ?? selectedYear;
    const nextMonth = next.month ?? selectedMonth;
    const nextFrom = next.from ?? customFrom;
    const nextTo = next.to ?? customTo;
    const nextMarket = next.market ?? marketRegion;

    const params = new URLSearchParams();
    params.set("period", nextPeriod);

    if (nextPeriod === "Y" && nextYear && nextYear !== "Current") {
      params.set("year", String(nextYear));
    }
    if (nextPeriod === "M" && (nextMonth !== "Current" || (nextYear && nextYear !== "Current"))) {
      if (nextMonth !== "Current") params.set("month", String(nextMonth));
      if (nextYear && nextYear !== "Current") params.set("year", String(nextYear));
    }
    if (nextPeriod === "C" && nextFrom) params.set("from", nextFrom);
    if (nextPeriod === "C" && nextTo) params.set("to", nextTo);
    if (nextMarket) params.set("market", nextMarket);

    router.replace(`?${params.toString()}`, { scroll: false });
  }, [customFrom, customTo, marketRegion, period, router, selectedYear, selectedMonth]);

  // ── Filter Change Handlers ─────────────────────────────────────────────────
  const handlePeriodChange = (newPeriod: DashboardPeriod) => {
    setPeriod(newPeriod);
    if (newPeriod !== "Y" && newPeriod !== "M") {
      setSelectedYear("Current");
      setSelectedMonth("Current");
    }
    updateDashboardQuery({ period: newPeriod });
  };

  const handleYearChange = (newYear: number | "Current") => {
    setPeriod("Y");
    setSelectedYear(newYear);
    setSelectedMonth("Current");
    updateDashboardQuery({ period: "Y", year: newYear, month: "Current" });
  };

  const handleMonthChange = (newMonth: number | "Current") => {
    setPeriod("M");
    setSelectedMonth(newMonth);
    updateDashboardQuery({ period: "M", month: newMonth });
  };

  const handleCustomFromChange = (date: string) => {
    setCustomFrom(date);
    updateDashboardQuery({ period: "C", from: date });
  };

  const handleCustomToChange = (date: string) => {
    setCustomTo(date);
    updateDashboardQuery({ period: "C", to: date });
  };

  const handleMarketChange = useCallback((nextMarket: string) => {
    setMarketRegion(nextMarket);
    updateDashboardQuery({ market: nextMarket });
  }, [updateDashboardQuery]);

  const headerActions = useMemo(() => (
    <DashboardRegionFilter
      marketRegion={marketRegion}
      displayCurrency={dashboardCurrency}
      onMarketChange={handleMarketChange}
    />
  ), [dashboardCurrency, handleMarketChange, marketRegion]);

  // ── Period Display Text ────────────────────────────────────────────────────
  const getPeriodLabel = () => {
    if (period === "T") return "Today's Performance";
    if (period === "W") return "This Week's Performance";
    if (period === "M") {
      if (selectedMonth === "Current") return "This Month's Performance";
      const mName = getMonthName(selectedMonth);
      return selectedYear === "Current" ? `${mName}'s Performance` : `${mName} ${selectedYear}'s Performance`;
    }
    if (period === "Y") {
      return selectedYear === "Current" ? "This Year's Performance" : `${selectedYear}'s Performance`;
    }
    if (period === "C" && customRangeInvalid) return "Choose a valid custom date range";
    if (period === "C" && customRangeIncomplete) return "Select a start and end date";
    if (period === "C" && customFrom && customTo) {
      return `Performance: ${customFrom} to ${customTo}`;
    }
    return "Performance Overview";
  };

  /* ── Derived metrics ─────────────────────────────────────────── */
  const priorityClaims = (recentClaims?.claims ?? []).filter((claim) =>
    ["HITL_PENDING", "DENIED", "HITL_DENIED", "ERROR"].includes(claim.status)
  );
  const nonPriorityClaims = (recentClaims?.claims ?? []).filter((claim) =>
    !["HITL_PENDING", "DENIED", "HITL_DENIED", "ERROR"].includes(claim.status)
  );
  const alertFeedClaims = [...priorityClaims, ...nonPriorityClaims].slice(0, 12);

  // ── Recent Claims selection ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Recent Claims filters ─────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter,   setTypeFilter]   = useState("");
  const [recentSearch, setRecentSearch] = useState("");
  const filteredClaims = (recentClaims?.claims ?? []).filter((c) => {
    const q = recentSearch.trim().toLowerCase();
    if (q && ![
      c.claim_reference,
      c.patient_name,
      c.member_number,
      c.provider_name,
    ].some((value) => String(value ?? "").toLowerCase().includes(q))) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (typeFilter   && c.claim_type !== typeFilter) return false;
    return true;
  });

  const exportCSV = useCallback(() => {
    const rows = recentClaims?.claims ?? [];
    if (!rows.length) return;
    const headers = ["Reference","Patient","Date","Type","Status","Billed","Settlement","Market"];
    const lines = rows.map((c) => [
      c.claim_reference ?? "",
      `"${(c.patient_name ?? "").replace(/"/g, '""')}"`,
      c.service_date ?? "",
      c.claim_type ?? "",
      c.status ?? "",
      c.total_billed ?? "0",
      c.total_settlement ?? "0",
      c.market_region ?? "",
    ].join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `claims-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recentClaims]);

  const now = new Date();
  const todayISO = now.toISOString().split("T")[0];
  
  const calendarEvents = [
    ...(kpis?.pending_hitl_count ?? 0) > 0
      ? [{
          id: "hitl",
          date: todayISO,
          type: "HITL_REVIEW" as CalendarEventType,
          time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
          title: `${kpis!.pending_hitl_count} Claims Await Review`,
          href: "/hitl",
        }]
      : [],
    ...priorityClaims.slice(0, 2).map((c, i) => ({
      id: c.claim_reference ?? `evt-${i}`,
      date: todayISO,
      type: "MANUAL_REVIEW" as CalendarEventType,
      time: new Date(now.getTime() + (i + 1) * 3600_000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      title: `Review ${c.claim_reference?.split("-").pop() ? `CLM-${c.claim_reference.split("-").pop()}` : "Claim"}`,
      href: `/claims/${c.claim_reference}`,
    })),
    {
      id: "audit",
      date: todayISO,
      type: "AUDIT_REQUIRED" as CalendarEventType,
      time: "17:00",
      title: "Daily Audit Report",
      href: "/reports",
    },
  ].slice(0, 3);

  const buildClaimsUrl = (status?: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (dateFrom) p.set("received_date_from", dateFrom);
    if (dateTo) p.set("received_date_to", dateTo);
    if (marketRegion) p.set("market_region", marketRegion);
    const qs = p.toString();
    return `/claims${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="acos-page">
      {/* ── Diagnostic banners ─────────────────────────────────────── */}
      {kpisError && (
        <Alert variant="destructive" className="rounded-xl dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm font-semibold">
            Dashboard data unavailable
          </AlertTitle>
          <AlertDescription className="text-sm">
            Failed to load KPIs: {kpisError.message ?? "Unknown error"}. Check that the API server is running.
          </AlertDescription>
        </Alert>
      )}

      {dbDisconnected && (
        <Alert className="rounded-xl dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 border-amber-300 bg-amber-50">
          <Database className="h-4 w-4 dark:text-amber-400 text-amber-600" />
          <AlertTitle className="text-sm font-semibold dark:text-amber-400 text-amber-800">
            Database disconnected
          </AlertTitle>
          <AlertDescription className="text-sm dark:text-amber-400/80 text-amber-700">
            PostgreSQL not connected \u2014 API running in memory-only mode.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Proactive Intelligence Ticker ─────────────────────────── */}
      <NeuralIntelligenceTicker alerts={visibleAlerts} onDismiss={dismiss} />

      {/* ── Dashboard Header ───────────────────────────────────────────────── */}
      <PageHeader
        title="Claims Status Overview"
        actions={headerActions}
      />

      <div className="mt-6">
        <div className="glass-card px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <p className="ui-eyebrow">Dashboard Filters</p>
            <div className="flex items-center gap-3">
              <TimePeriodFilter
                period={period}
                onPeriodChange={handlePeriodChange}
                selectedYear={selectedYear}
                onYearChange={handleYearChange}
                selectedMonth={selectedMonth}
                onMonthChange={handleMonthChange}
                customFrom={customFrom}
                customTo={customTo}
                onCustomFromChange={handleCustomFromChange}
                onCustomToChange={handleCustomToChange}
              />
            </div>
          </div>
        </div>
      </div>

      {!dashboardFiltersReady ? (
        <div>
          <Alert className="rounded-[1.5rem] border-amber-300/20 bg-amber-300/10 text-amber-100">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            <AlertTitle className="text-sm font-semibold text-amber-200">
              Custom range incomplete
            </AlertTitle>
            <AlertDescription className="text-sm text-amber-100/80">
              {customRangeInvalid
                ? 'The "From" date must be on or before the "To" date before dashboard data can load.'
                : "Select both a start date and an end date to load dashboard metrics, charts, and recent claims."}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          {/* Enhanced KPI Dashboard Section */}
          <div>
            {/* KPI Grid - Primary Metrics */}
            <KPIGrid 
              kpis={kpis} 
              isLoading={kpisLoading} 
              dateFrom={dateFrom} 
              dateTo={dateTo} 
              displayCurrency={dashboardCurrency} 
              marketRegion={marketRegion || undefined} 
              periodLabel={getPeriodLabel()}
            />
          </div>

          {/* DETAILED PERFORMANCE ANALYTICS - Moved Above Pipeline */}
          <div className="mt-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-primary via-cyan-300 to-transparent" />
              <h2 className="ui-eyebrow">Detailed Performance Analytics</h2>
            </div>
            {/* Row 1: Claims Volume + Calendar */}
            <div className="mb-6 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.78fr)]">
              <div className="dashboard-panel flex h-[400px] min-h-[400px] flex-col p-5 xl:h-[410px] xl:min-h-[410px]">
                <div className="dashboard-panel-accent bg-gradient-to-r from-cyan-400/0 via-cyan-400/50 to-cyan-400/0" />
                <div className="dashboard-panel-glow -bottom-10 -left-10 bg-cyan-400/30" />
                <div className="relative flex flex-1 flex-col">
                  <ClaimsVolumeChart
                    period={period}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    marketRegion={marketRegion || undefined}
                    displayCurrency={dashboardCurrency}
                  />
                </div>
              </div>
              <div className="min-h-[360px] xl:min-h-[410px]">
                <CalendarCard systemEvents={calendarEvents} />
              </div>
            </div>

            {/* Row 2: Claims Status + Market */}
            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
              <div className="lg:col-span-2">
                <ClaimsStatusChart data={kpis?.claims_by_status} isLoading={kpisLoading} />
              </div>
              <div className="lg:col-span-1">
                <ClaimsMarketChart data={kpis?.claims_by_market} isLoading={kpisLoading} />
              </div>
            </div>

            {/* Row 2.5: Priority Claims + SLA & Fraud stacked side by side */}
            <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">

              {/* Priority Claims — scrollable */}
              <div className="dashboard-panel flex h-[430px] flex-col overflow-hidden">
                <div className="dashboard-panel-accent bg-gradient-to-r from-amber-300/0 via-amber-300/55 to-amber-300/0" />
                <div className="dashboard-panel-glow -bottom-10 -right-10 bg-amber-300/30" />
                <div className="relative flex flex-1 flex-col gap-2 p-3 min-h-0">
                  <div className="dashboard-panel-header shrink-0">
                    <div className="dashboard-panel-title">
                      <span className="dashboard-panel-dot bg-amber-300" />
                      <p className="dashboard-panel-label">Priority Claims</p>
                    </div>
                    {alertFeedClaims.length > 0 && (
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[8px] font-black tabular-nums text-amber-200">
                        {alertFeedClaims.length} pending
                      </span>
                    )}
                  </div>

                  <div
                    className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1"
                    style={{
                      "--scrollbar-thumb": "rgba(251,191,36,0.3)",
                      "--scrollbar-thumb-hover": "rgba(251,191,36,0.5)",
                    } as React.CSSProperties}
                  >
                    <ActivityFeed claims={alertFeedClaims} isLoading={claimsLoading} />
                  </div>
                </div>
              </div>

              {/* Right column — SLA + Fraud stacked */}
              <div className="flex flex-col gap-4 h-[430px]">
                <div className="flex-1 min-h-0">
                  <SLAGauge
                    complianceRate={kpis?.sla_compliance_rate}
                    targetMs={kpis?.sla_target_ms}
                    avgMs={kpis?.avg_processing_ms}
                    isLoading={kpisLoading}
                  />
                </div>
                <div className="flex-1 min-h-0">
                  <FraudPrevented
                    fraudTotal={kpis?.total_fraud_prevented ?? "0"}
                    fraudToday={kpis?.fraud_prevented_today ?? "0"}
                    currency={dashboardCurrency}
                    isLoading={kpisLoading}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* Pipeline Flow */}
          <div className="mt-6">
            <PipelineFlow stages={kpis?.pipeline_stages} kpis={kpis} isLoading={kpisLoading} />
          </div>

          <div>
            <div className="dashboard-panel overflow-hidden relative mb-6 rounded-[2rem]">
              <div className="dashboard-panel-accent bg-gradient-to-r from-cyan-300/0 via-cyan-300/45 to-cyan-300/0" />
              <div className="dashboard-panel-glow -top-12 right-10 bg-cyan-300/20" />
              <div className="p-6 sm:p-8 pb-4 flex items-center justify-between gap-4">
            <div className="dashboard-panel-title">
              <span className="dashboard-panel-dot bg-cyan-300" />
              <h3 className="ui-section-title">Recent Claims</h3>
            </div>
            <Link
              href={buildClaimsUrl()}
              className="ui-chip-label rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1.5 text-cyan-200 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/15"
            >
              View All
            </Link>
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[260px] group">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-hover:text-cyan-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                type="search"
                value={recentSearch}
                onChange={(event) => setRecentSearch(event.target.value)}
                placeholder="Search claimant name or reference ID..."
                aria-label="Search recent claims"
                className="h-12 w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] pl-12 pr-6 text-sm text-white/80 outline-none transition-colors placeholder:text-white/32 hover:border-white/[0.1] hover:bg-white/[0.07] focus:border-cyan-300/35"
              />
            </div>

            {/* Export CSV */}
            <button
              type="button"
              onClick={exportCSV}
              disabled={!recentClaims?.claims?.length}
              className={cn(
                "ui-control-label flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl border border-white/[0.06] bg-white/[0.04] px-5 text-white/45 transition-all",
                recentClaims?.claims?.length
                  ? "hover:border-white/[0.1] hover:bg-white/[0.07] hover:text-white"
                  : "cursor-not-allowed opacity-45"
              )}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>

            {/* Status filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "ui-control-label flex h-12 items-center gap-2 rounded-2xl border px-5 transition-all",
                    statusFilter
                      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
                      : "border-white/[0.06] bg-white/[0.04] text-white/45 hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  {statusFilter ? (STATUS_LABELS[statusFilter] ?? statusFilter) : "All Status"}
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {[{ key: "", label: "All Status" }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ key: k, label: v }))].map(({ key, label }) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() => setStatusFilter(key)}
                    className={cn(statusFilter === key && "bg-brand-primary/10 text-brand-primary")}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Type filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "ui-control-label flex h-12 items-center gap-2 rounded-2xl border px-5 transition-all",
                    typeFilter
                      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
                      : "border-white/[0.06] bg-white/[0.04] text-white/45 hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  {typeFilter ? (CLAIM_TYPE_LABELS[typeFilter] ?? typeFilter) : "All Types"}
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {[{ key: "", label: "All Types" }, ...Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => ({ key: k, label: v }))].map(({ key, label }) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() => setTypeFilter(key)}
                    className={cn(typeFilter === key && "bg-brand-primary/10 text-brand-primary")}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {claimsLoading ? (
            <div className="pb-8 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-4 rounded-2xl border border-white/[0.05] bg-white/[0.03] px-4 py-4">
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          ) : recentClaims?.claims?.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-white/40">
                No claims yet.{" "}
                <Link href="/submit" className="font-semibold text-brand-primary hover:underline">
                  Submit your first claim
                </Link>
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-8">
              <div className="glass-card min-w-[920px] overflow-visible">
              <table className="relative z-0 w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/30">
                    <th className="px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-white/10 bg-white/5 accent-brand-primary"
                        checked={filteredClaims.slice(0, 8).length > 0 && filteredClaims.slice(0, 8).every((c) => selectedIds.has(c.claim_reference ?? ""))}
                        onChange={(e) => {
                          const visibleIds = filteredClaims.slice(0, 8).map((c) => c.claim_reference ?? "");
                          if (e.target.checked) {
                            setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
                          } else {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              visibleIds.forEach((id) => next.delete(id));
                              return next;
                            });
                          }
                        }}
                      />
                    </th>
                    <th className="px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35">ID</th>
                    <th className="px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35">Member</th>
                    <th className="hidden px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35 md:table-cell">Date</th>
                    <th className="px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35">Type</th>
                    <th className="px-4 py-4 text-[0.65rem] font-bold uppercase tracking-normal text-white/35">Status</th>
                    <th className="hidden px-4 py-4 text-right text-[0.65rem] font-bold uppercase tracking-normal text-white/35 lg:table-cell">Amount</th>
                    <th className="px-4 py-4 text-right text-[0.65rem] font-bold uppercase tracking-normal text-white/35">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.slice(0, 8).map((claim) => (
                    <tr key={claim.claim_reference} className="group relative cursor-pointer border-b border-white/[0.035] transition-all hover:z-30 hover:translate-x-0.5 hover:bg-cyan-400/[0.04]">
                      <td className="px-4 py-5 relative">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-white/10 bg-white/5 accent-brand-primary"
                          checked={selectedIds.has(claim.claim_reference ?? "")}
                          onChange={(e) => {
                            const id = claim.claim_reference ?? "";
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(id);
                              else next.delete(id);
                              return next;
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r bg-cyan-300 scale-y-0 origin-top transition-transform group-hover:scale-y-100" />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-300/6 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                      </td>
                      <td className="px-4 py-5">
                        <span className="font-mono text-[13px] font-bold text-white/45 transition-colors group-hover:text-cyan-200">
                          #{claim.claim_reference?.split("-").pop()}
                        </span>
                      </td>
                      <td className="px-4 py-5 relative">
                        <span className="text-[14px] font-bold text-white/80 transition-colors group-hover:text-white">
                          {claim.patient_name}
                        </span>
                        {/* Hover tooltip */}
                        <div className="pointer-events-none invisible absolute bottom-full left-0 z-[100] mb-3 w-64 translate-y-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                          <div className="relative rounded-2xl border border-white/[0.1] bg-[#0b1018] px-4 py-3 shadow-[0_24px_70px_rgba(0,0,0,0.9)] ring-1 ring-cyan-300/10">
                            <p className="ui-eyebrow mb-2 text-white/30">Claimant Data</p>
                            <p className="text-[15px] font-black text-white leading-tight mb-2.5">{claim.patient_name}</p>
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                              <span className="font-mono text-[11px] font-bold tracking-wide text-cyan-400">{claim.claim_reference}</span>
                            </div>
                            <span className="absolute left-6 top-full h-3 w-3 -translate-y-1 rotate-45 border-b border-r border-white/[0.1] bg-[#0b1018]" />
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-4 py-5 font-mono text-[13px] text-white/42">
                        {formatDate(claim.service_date)}
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/25" />
                          <span className="text-[13px] text-white/45">
                            {CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <ClaimStatusBadge status={claim.status} />
                      </td>
                      <td className="hidden lg:table-cell px-4 py-5 text-right text-[13px] font-semibold text-white/72 tabular-nums">
                        <CurrencyAmount
                          amount={claim.total_settlement ?? claim.total_billed}
                          currency={claim.currency}
                        />
                      </td>
                      <td className="px-4 py-5 text-right">
                        <div className="flex translate-x-4 items-center justify-end gap-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                          <Link
                            href={`/claims/${claim.claim_reference}`}
                            className="ui-chip-label rounded-xl border border-brand-primary/25 bg-brand-primary/10 px-4 py-2 text-brand-primary transition-all hover:border-brand-primary hover:bg-brand-primary hover:text-white"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
