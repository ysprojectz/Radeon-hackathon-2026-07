"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  CheckSquare,
  Clock,
  XCircle,
  Cpu,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { fetchCurrentUser } from "@/lib/auth";
import { getAdminReport } from "@/lib/api";
import type { AdminReportResponse, ReportColumn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { PageHeader } from "@/components/shared/PageHeader";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "claims",      label: "Summary",             icon: FileText     },
  { id: "settlements", label: "Settlement Review",   icon: CheckSquare  },
  { id: "hitl",        label: "Review Queue",         icon: Clock        },
  { id: "denials",     label: "Denial Analysis",      icon: XCircle      },
  { id: "processing",  label: "Processing Timeline",  icon: Cpu          },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const PERIOD_PRESETS = [
  { label: "Today",     days: 0  },
  { label: "7 Days",    days: 7  },
  { label: "30 Days",   days: 30 },
  { label: "90 Days",   days: 90 },
  { label: "12 Months", days: 365},
  { label: "Custom",    days: -1 },
] as const;

const MARKETS = ["All", "INDIA"];

const PAGE_SIZE = 50;
const REPORT_FETCH_CHUNK_SIZE = 10_000;

// ─── CSV helper ───────────────────────────────────────────────────────────────

function exportToCSV(
  columns: ReportColumn[],
  rows: Record<string, string>[],
  filename: string
) {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((row) =>
    columns.map((c) => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const csv = [header, ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function periodDates(days: number, anchorDate?: string | null): { from: string; to: string } {
  const to   = parseISODate(anchorDate) ?? new Date();
  const from = new Date();
  from.setTime(to.getTime());
  from.setDate(from.getDate() - Math.max(days - 1, 0));
  return { from: toISODate(from), to: toISODate(to) };
}

function resolvePeriodRange(
  periodPreset: number,
  customFrom: string,
  customTo: string,
  anchorDate?: string | null,
): { from?: string; to?: string } {
  if (periodPreset === -1) {
    return {
      from: customFrom || undefined,
      to: customTo || undefined,
    };
  }

  if (periodPreset === 0) {
    const base = toISODate(parseISODate(anchorDate) ?? new Date());
    return { from: base, to: base };
  }

  const dates = periodDates(periodPreset, anchorDate);
  return { from: dates.from, to: dates.to };
}

function buildReportFilters(params: {
  category: CategoryId;
  periodPreset: number;
  customFrom: string;
  customTo: string;
  market: string;
  dateAnchor?: string | null;
}) {
  const { from, to } = resolvePeriodRange(
    params.periodPreset,
    params.customFrom,
    params.customTo,
    params.dateAnchor,
  );

  return {
    category: params.category,
    date_from: from,
    date_to: to,
    market_region: params.market !== "All" ? params.market : undefined,
  };
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const router = useRouter();

  // Auth guard
  const [authChecked, setAuthChecked] = useState(false);

  // Filters
  const [category,      setCategory]      = useState<CategoryId>("claims");
  const [periodPreset,  setPeriodPreset]  = useState<number>(30);    // days; -1 = custom
  const [customFrom,    setCustomFrom]    = useState("");
  const [customTo,      setCustomTo]      = useState("");
  const [market,        setMarket]        = useState("All");
  const [page,          setPage]          = useState(1);
  const [filtersOpen,   setFiltersOpen]   = useState(false);
  const [dateAnchor,    setDateAnchor]    = useState<string | null>(null);

  // Data
  const [data,     setData]     = useState<AdminReportResponse | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSelecting, setBulkSelecting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Date range validation (custom period only)
  const dateRangeError =
    periodPreset === -1 && customFrom && customTo && customFrom > customTo
      ? "Start date must be before or equal to end date."
      : null;

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (!u || u.role !== "ADMIN") {
        router.replace("/");
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    // Don't fetch if custom date range is invalid
    if (periodPreset === -1 && customFrom && customTo && customFrom > customTo) return;

    setLoading(true);
    setError(null);
    const reportFilters = buildReportFilters({
      category,
      periodPreset,
      customFrom,
      customTo,
      market,
      dateAnchor,
    });

    try {
      const result = await getAdminReport({
        ...reportFilters,
        page,
        page_size: PAGE_SIZE,
      });
      setData(result);
      const nextAnchor = result.date_anchor ?? null;
      setDateAnchor((prev) => (prev === nextAnchor ? prev : nextAnchor));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, [category, periodPreset, customFrom, customTo, market, page, dateAnchor]);

  useEffect(() => {
    if (authChecked) fetchData();
  }, [authChecked, fetchData]);

  // ── Reset page when filters change ─────────────────────────────────────────
  useEffect(() => {
    setPage(1);
  }, [category, periodPreset, customFrom, customTo, market]);

  useEffect(() => {
    setSelected(new Set());
  }, [category, periodPreset, customFrom, customTo, market]);

  const columns  = data?.columns  ?? [];
  const records  = data?.records  ?? [];
  const total    = data?.total_records ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = total > 0 && selected.size === total;
  const someSelected = selected.size > 0 && !allSelected;
  const advancedFilterCount = [
    market !== "All" ? "market" : null,
    periodPreset === -1 ? "date" : null,
  ].filter(Boolean).length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (!authChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  async function fetchAllReportRecords() {
    const reportFilters = buildReportFilters({
      category,
      periodPreset,
      customFrom,
      customTo,
      market,
      dateAnchor,
    });

    const totalRecords = data?.total_records ?? 0;
    const pageSize = Math.min(Math.max(totalRecords, 1), REPORT_FETCH_CHUNK_SIZE);
    const firstPage = await getAdminReport({
      ...reportFilters,
      page: 1,
      page_size: pageSize,
    });

    let allRecords = [...firstPage.records];
    const fetchedTotal = firstPage.total_records ?? allRecords.length;

    if (fetchedTotal <= pageSize) {
      return {
        columns: firstPage.columns,
        records: allRecords,
      };
    }

    const totalPagesNeeded = Math.ceil(fetchedTotal / REPORT_FETCH_CHUNK_SIZE);
    for (let nextPage = 2; nextPage <= totalPagesNeeded; nextPage += 1) {
      const pageResult = await getAdminReport({
        ...reportFilters,
        page: nextPage,
        page_size: REPORT_FETCH_CHUNK_SIZE,
      });
      allRecords = allRecords.concat(pageResult.records);
    }

    return {
      columns: firstPage.columns,
      records: allRecords,
    };
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }

    setBulkSelecting(true);
    try {
      const { records: allRecords } = await fetchAllReportRecords();
      const keys = allRecords
        .map((row, index) => row.claim_reference ?? String(index))
        .filter(Boolean);
      setSelected(new Set(keys));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select all report rows");
    } finally {
      setBulkSelecting(false);
    }
  }

  async function handleExportAll() {
    if (!data) return;

    try {
      const reportData = total > records.length
        ? await fetchAllReportRecords()
        : { columns, records };
      exportToCSV(reportData.columns, reportData.records, `reports-${category}-all.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export report");
    }
  }

  async function handleExportSelected() {
    if (!data) return;

    try {
      const reportData = selected.size > records.length
        ? await fetchAllReportRecords()
        : { columns, records };
      const rows = reportData.records.filter((row, index) =>
        selected.has(row.claim_reference ?? String(index))
      );
      exportToCSV(reportData.columns, rows, `reports-${category}-selected.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export selected rows");
    }
  }

  function clearAdvancedFilters() {
    setMarket("All");
    const defaultRange = periodDates(30, dateAnchor);
    setCustomFrom(defaultRange.from);
    setCustomTo(defaultRange.to);
    setPeriodPreset(30);
    setPage(1);
  }

  function applyPeriodPreset(days: number) {
    setPeriodPreset(days);
    setPage(1);
    if (days === -1) {
      // When selecting Custom, pre-populate with last 30 days as a starting point
      const { from, to } = resolvePeriodRange(30, "", "", dateAnchor);
      setCustomFrom(from ?? "");
      setCustomTo(to ?? "");
      setFiltersOpen(true);
      return;
    }
    const { from, to } = resolvePeriodRange(days, "", "", dateAnchor);
    setCustomFrom(from ?? "");
    setCustomTo(to ?? "");
    setFiltersOpen(false);
  }

  const activeCat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  return (
    <div>
      <div className="flex flex-col gap-5 p-5 md:p-6">
      <PageHeader
        title="Historical Claim Reports"
      />

      {/* ── Category tabs ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all border",
              category === id
                ? "bg-[var(--brand-primary-subtle)] text-brand-primary border-[rgba(37,99,235,0.24)]"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Period presets */}
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map(({ label, days }) => (
            <button
              type="button"
              key={label}
              onClick={() => applyPeriodPreset(days)}
              aria-pressed={periodPreset === days}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all",
                periodPreset === days
                  ? "border-[rgba(37,99,235,0.35)] bg-[var(--brand-primary-subtle)] text-brand-primary"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className="h-8 gap-1.5 text-xs border-slate-200"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Advanced Filters
          {advancedFilterCount > 0 && (
            <span className="rounded-full bg-[var(--brand-primary-subtle)] px-1.5 py-0.5 text-[9px] font-bold text-brand-primary">
              {advancedFilterCount}
            </span>
          )}
        </Button>
        {advancedFilterCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAdvancedFilters}
            className="h-8 gap-1.5 text-xs border-slate-200"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-h-[min(86vh,640px)] max-w-[min(92vw,460px)] gap-0 overflow-hidden p-0" aria-describedby="admin-reports-filter-description">
          <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex items-start gap-3 pr-10">
              <div className="mt-0.5 rounded-2xl border border-[rgba(37,99,235,0.18)] bg-[var(--brand-primary-subtle)] p-2 text-brand-primary">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-left text-[var(--text-primary)]">
                  Advanced Filters
                </DialogTitle>
                <DialogDescription id="admin-reports-filter-description" className="not-sr-only mt-1 text-left text-xs text-[var(--text-muted)]">
                  Refine the report by market and activity date range.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex max-h-[calc(min(86vh,640px)-132px)] flex-col gap-5 overflow-y-auto p-5">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Market</label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start" className="z-[80]">
                  {MARKETS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {m === "All" ? "All Markets" : m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                Custom Activity Range
              </label>
              <DateRangePicker
                compact
                from={customFrom}
                to={customTo}
                onFromChange={(value) => {
                  setPeriodPreset(-1);
                  setCustomFrom(value);
                }}
                onToChange={(value) => {
                  setPeriodPreset(-1);
                  setCustomTo(value);
                }}
                error={dateRangeError}
              />
            </div>
          </div>

          <DialogFooter className="border-t border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-5 py-4 sm:justify-stretch">
            <Button
              variant="outline"
              onClick={clearAdvancedFilters}
              className="flex-1"
            >
              Clear All
            </Button>
            <Button
              onClick={() => setFiltersOpen(false)}
              className="flex-1"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <activeCat.icon className="h-4 w-4 text-primary/60" />
          <span className="font-medium">{activeCat.label}</span>
          {loading ? (
            <span className="text-muted-foreground/50 text-xs">loading…</span>
          ) : (
            <span className="text-muted-foreground/60 text-xs">
              {total.toLocaleString()} record{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExportSelected()}
              disabled={loading || bulkSelecting}
              className="h-8 gap-1.5 text-xs"
            >
              <FileDown className="h-3.5 w-3.5" />
              Export Selected ({selected.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportAll()}
            disabled={loading || bulkSelecting || total === 0}
            className="h-8 gap-1.5 text-xs"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="scrollbar-styled max-h-[62vh] overflow-auto glass-card rounded-xl">
        <table className="w-full text-sm" aria-label={`${activeCat.label} report data`}>
          <thead className="bg-[var(--bg-card)]">
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <th className="w-8 px-4 py-3 text-left" scope="col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => void toggleAll()}
                  aria-label="Select all rows"
                  disabled={loading || bulkSelecting || total === 0}
                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                />
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-500 uppercase text-xs tracking-wider"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="dark:divide-white/5 divide-slate-100 divide-y">
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-10 text-center text-muted-foreground/40"
                >
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-10 text-center text-muted-foreground/40"
                >
                  No records found for the selected filters.
                </td>
              </tr>
            ) : (
              records.map((row, i) => {
                const key = row.claim_reference ?? String(i);
                const isSelected = selected.has(key);
                return (
                  <tr
                    key={key}
                    className={cn(
                      "transition-colors",
                      isSelected
                        ? "bg-[rgba(37,99,235,0.04)]"
                        : "bg-transparent",
                      "hover:bg-slate-50"
                    )}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        aria-label={`Select row ${key}`}
                        disabled={bulkSelecting}
                        className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="whitespace-nowrap px-4 py-3 dark:text-slate-200 text-slate-700">
                        {renderCell(col.key, row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground/60">
          <span>
            {bulkSelecting ? (
              "Selecting all filtered rows…"
            ) : (
              <>
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–
                {Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function renderCell(key: string, value: string): React.ReactNode {
  if (!value) return <span className="text-muted-foreground/30">—</span>;

  // Status badge
  if (key === "status") {
    // Semantic only (DESIGN_SYSTEM.md §1.2) — info states share --status-info,
    // the same blue as --brand-primary, rather than introducing sky/blue as
    // two separate accent hues.
    const colour: Record<string, string> = {
      SETTLED:        "text-[var(--status-success)] bg-[rgba(5,150,105,0.10)] border-[rgba(5,150,105,0.20)]",
      DENIED:         "text-[var(--status-danger)] bg-[rgba(220,38,38,0.10)] border-[rgba(220,38,38,0.20)]",
      HITL_PENDING:   "text-[var(--status-warning)] bg-[rgba(217,119,6,0.10)] border-[rgba(217,119,6,0.20)]",
      HITL_IN_REVIEW: "text-[var(--status-info)] bg-[rgba(37,99,235,0.10)] border-[rgba(37,99,235,0.20)]",
      ERROR:          "text-[var(--status-danger)] bg-[rgba(220,38,38,0.10)] border-[rgba(220,38,38,0.20)]",
      PROCESSING:     "text-[var(--status-info)] bg-[rgba(37,99,235,0.10)] border-[rgba(37,99,235,0.20)]",
      PENDING:        "text-[var(--text-muted)] bg-[var(--bg-card-muted)] border-[var(--border-subtle)]",
    };
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          colour[value] ?? "text-muted-foreground border-border/30"
        )}
      >
        {value}
      </span>
    );
  }

  // Confidence — colour coded
  if (key === "confidence_score") {
    const num = parseFloat(value);
    const cls = isNaN(num)
      ? "text-muted-foreground/50"
      : num >= 95
      ? "text-[var(--status-success)] font-semibold"
      : num >= 80
      ? "text-[var(--status-warning)]"
      : "text-[var(--status-danger)]";
    return <span className={cls}>{isNaN(num) ? value : `${Math.round(num)}%`}</span>;
  }

  // Date — short format
  if (key === "date_received" || key === "sla_deadline") {
    if (!value || value === "None") return <span className="text-muted-foreground/30">—</span>;
    const d = new Date(value);
    if (isNaN(d.getTime())) return <span>{value}</span>;
    return (
      <span title={d.toISOString()}>
        {d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
      </span>
    );
  }

  // Monetary fields — right-align
  if (
    key === "total_billed" ||
    key === "total_settlement" ||
    key === "total_copay" ||
    key === "total_deductible" ||
    key === "total_member_responsibility"
  ) {
    const num = parseFloat(value);
    if (isNaN(num)) return <span>{value}</span>;
    return <span className="font-mono tabular-nums">{num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
  }

  return <span>{value}</span>;
}
