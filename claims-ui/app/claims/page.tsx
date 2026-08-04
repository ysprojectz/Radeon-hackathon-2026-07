"use client";
import { useState, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download, CheckCircle, XCircle, X, Loader2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaimFilters } from "@/components/claims/ClaimFilters";
import { ClaimsTable } from "@/components/claims/ClaimsTable";
import { ClaimsDashboard } from "@/components/claims/ClaimsDashboard";
import { ClaimsPipelineDrawer } from "@/components/claims/ClaimsPipelineDrawer";
import { DashboardRegionFilter } from "@/components/dashboard/DashboardRegionFilter";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmationDialog } from "@/components/shared/ConfirmationDialog";
import { showUndoToast } from "@/components/shared/ToastWithUndo";
import { useClaims } from "@/lib/hooks/useClaims";
import { useClaimsFilters } from "@/lib/hooks/useClaimsFilters";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import { getClaims, type GetClaimsParams } from "@/lib/api";
import { MARKET_CURRENCY } from "@/lib/constants";
import type { ClaimResponse } from "@/lib/types";
import { toast } from "sonner";

const PAGE_SIZE = 20;
const API_BASE = "/api/v1/proxy";
const EXPORT_PAGE_SIZE = 100;
type ExportScope = "all" | "selected";

function escapeCsvValue(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function claimToCsvRow(claim: ClaimResponse): string[] {
  const confidence = claim.confidence_score == null
    ? ""
    : `${Math.round(Number(claim.confidence_score) * 100)}%`;
  return [
    claim.claim_reference,
    claim.patient_name,
    claim.member_number,
    claim.market_region,
    claim.claim_type,
    claim.status,
    claim.service_date,
    claim.date_received,
    claim.total_billed,
    claim.total_settlement ?? claim.total_settled_amount ?? "",
    claim.total_member_responsibility ?? "",
    confidence,
    claim.currency,
  ];
}

function downloadClaimsCsv(claims: ClaimResponse[], scope: ExportScope) {
  const headers = [
    "Claim Reference",
    "Patient",
    "Member Number",
    "Market",
    "Claim Type",
    "Status",
    "Service Date",
    "Received Date",
    "Total Billed",
    "Settlement",
    "Member Responsibility",
    "Confidence",
    "Currency",
  ];
  const rows = [headers, ...claims.map(claimToCsvRow)];
  const csv = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `claims-${scope}-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ClaimsPage() {
  const { params, updateParams } = useClaimsFilters();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [exportLoading, setExportLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState<"approve" | "deny" | null>(null);
  const [showDenyConfirmation, setShowDenyConfirmation] = useState(false);
  const [showSelectAllWarning, setShowSelectAllWarning] = useState(false);
  const [lastBulkAction, setLastBulkAction] = useState<{ type: "approve" | "deny"; ids: string[]; timestamp: number } | null>(null);
  const [selectedPipelineClaim, setSelectedPipelineClaim] = useState<string | null>(null);

  const dateRangeInvalid = Boolean(
    (params.service_date_from && params.service_date_to && params.service_date_from > params.service_date_to) ||
    (params.received_date_from && params.received_date_to && params.received_date_from > params.received_date_to)
  );
  const { data, isLoading, error, refresh } = useClaims(params, { enabled: !dateRangeInvalid });

  // Dashboard KPIs hook - synced with current filters where applicable
  const { kpis, isLoading: isKpisLoading } = useDashboardKPIs({
    dateFrom: params.received_date_from,
    dateTo: params.received_date_to,
    marketRegion: params.market_region,
    enabled: !dateRangeInvalid
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const currentPage = params.page ?? 1;
  const allIds = useMemo(() => data?.claims?.map((c) => c.claim_reference) ?? [], [data?.claims]);
  const displayCurrency = params.market_region ? (MARKET_CURRENCY[params.market_region] ?? "INR") : "INR";

  const handleMarketRegionChange = useCallback((marketRegion: string) => {
    setSelectedIds(new Set());
    updateParams({
      market_region: marketRegion || undefined,
      page: 1,
    });
  }, [updateParams]);

  const headerActions = (
    <DashboardRegionFilter
      marketRegion={params.market_region ?? ""}
      displayCurrency={displayCurrency}
      onMarketChange={handleMarketRegionChange}
    />
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback((ids: string[]) => {
    const allSelected = ids.every((id) => selectedIds.has(id));
    
    // Check if we're selecting all on the current page but there are more pages
    if (!allSelected && data && data.total > PAGE_SIZE) {
      // Show warning about selecting all across pages
      setShowSelectAllWarning(true);
      return;
    }
    
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, [selectedIds, data]);

  // Handle "Select All Across Pages" confirmation
  const handleSelectAllAcrossPages = useCallback(() => {
    setShowSelectAllWarning(false);
    // Select all claims across all pages
    // Note: For performance, we only have the current page's IDs
    // This would need backend support for true "select all" functionality
    setSelectedIds(new Set(allIds));
    toast.info("Selected all claims on this page", {
      description: "For selecting all claims across pages, please use the export feature.",
    });
  }, [allIds]);

  async function handleBulkDecision(decision: "SETTLED" | "DENIED", skipConfirmation = false) {
    if (selectedIds.size === 0) return;
    
    // Show confirmation for deny actions
    if (decision === "DENIED" && !skipConfirmation) {
      setShowDenyConfirmation(true);
      return;
    }
    
    setBulkLoading(decision === "SETTLED" ? "approve" : "deny");
    const actionIds = Array.from(selectedIds);
    
    try {
      const res = await fetch(`${API_BASE}/claims/bulk-decision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_ids: actionIds, decision }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      // Store the action for undo
      setLastBulkAction({ type: decision === "SETTLED" ? "approve" : "deny", ids: actionIds, timestamp: Date.now() });
      
      // Show success toast with undo option
      showUndoToast({
        message: `Bulk ${decision === "SETTLED" ? "approval" : "denial"} submitted`,
        undoText: "UNDO",
        onUndo: async () => {
          await handleUndoBulkAction();
        },
        duration: 8000,
      });
      
      setSelectedIds(new Set());
      refresh();
    } catch {
      toast.error("Bulk action failed", { description: "Please try again." });
    } finally {
      setBulkLoading(null);
    }
  }

  // Handle undo for bulk actions
  const handleUndoBulkAction = async () => {
    if (!lastBulkAction) return;
    
    const reverseDecision = lastBulkAction.type === "approve" ? "DENIED" : "SETTLED";
    
    try {
      const res = await fetch(`${API_BASE}/claims/bulk-decision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_ids: lastBulkAction.ids, decision: reverseDecision }),
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      toast.success(`Bulk ${reverseDecision === "SETTLED" ? "approval" : "denial"} restored`);
      setLastBulkAction(null);
      refresh();
    } catch {
      toast.error("Undo failed", { description: "Please try again." });
    }
  };

  // Handle deny confirmation - Submit deny without showing confirmation again
  const handleConfirmDeny = () => {
    setShowDenyConfirmation(false);
    void handleBulkDecision("DENIED", true);
  };

  const fetchAllFilteredClaims = useCallback(async () => {
    const exportParams: GetClaimsParams = {
      ...params,
      page: 1,
      page_size: EXPORT_PAGE_SIZE,
    };
    const first = await getClaims(exportParams);
    const claims = [...first.claims];
    const pages = Math.ceil(first.total / EXPORT_PAGE_SIZE);
    for (let page = 2; page <= pages; page += 1) {
      const next = await getClaims({ ...exportParams, page });
      claims.push(...next.claims);
    }
    return claims;
  }, [params]);

  const handleExport = useCallback(async (scope: ExportScope = exportScope) => {
    if (scope === "selected" && selectedIds.size === 0) {
      toast.error("Select at least one claim before exporting selected records.");
      return;
    }

    setExportLoading(true);
    try {
      const allFilteredClaims = await fetchAllFilteredClaims();
      const records = scope === "all"
        ? allFilteredClaims
        : allFilteredClaims.filter((claim) => selectedIds.has(claim.claim_reference));

      if (records.length === 0) {
        toast.error(scope === "all" ? "No claims available to export." : "Selected claims are no longer in the current filter result.");
        return;
      }

      downloadClaimsCsv(records, scope);
      toast.success(`Exported ${records.length} claim${records.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Export failed", { description: "Please try again." });
    } finally {
      setExportLoading(false);
    }
  }, [exportScope, fetchAllFilteredClaims, selectedIds]);

  function handleExportSelected() {
    setExportScope("selected");
    void handleExport("selected");
  }

  const handleSort = (field: string) => {
    const newSortOrder =
      params.sort_by === field && params.sort_order === 'desc'
        ? 'asc'
        : 'desc';

    updateParams({
      sort_by: field,
      sort_order: newSortOrder,
      page: 1,
    });
  };

  return (
    <div className="acos-page">
      <PageHeader
        title="Claims List"
        actions={headerActions}
      />

      <ClaimsDashboard stats={kpis} isLoading={isKpisLoading} />

      <section className="dashboard-panel overflow-visible">
        <div className="relative p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="dashboard-panel-title">
              <span className="dashboard-panel-dot bg-[var(--text-muted)]" />
              <div>
                <p className="dashboard-panel-label">Filters & Export</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Search the register, refine results, and download exactly what you need.</p>
              </div>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">
              <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {data?.total ?? 0} records
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-[1.35rem] border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-3 xl:flex-row xl:items-center">
            <ClaimFilters />
            <div className="flex shrink-0 flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5 xl:w-auto xl:min-w-[26rem] xl:flex-row xl:items-center">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-1 xl:w-[16rem]">
                <button
                  type="button"
                  onClick={() => setExportScope("all")}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${exportScope === "all" ? "bg-brand-primary text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"}`}
                >
                  All {data?.total ? `(${data.total})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setExportScope("selected")}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${exportScope === "selected" ? "bg-brand-primary text-white shadow-sm" : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"}`}
                >
                  Selected ({selectedIds.size})
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exportLoading || (exportScope === "selected" && selectedIds.size === 0)}
                className="ui-button-primary inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 xl:min-w-[9rem]"
              >
                {exportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exportScope === "selected" ? "Export Selected" : "Export Filtered"}
              </button>
              <p className="px-1 text-[11px] leading-5 text-[var(--text-muted)] xl:hidden">
                Filtered exports include every matching page. Selected exports use checked rows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="glass-card flex items-center gap-3 px-4 py-3 border border-[rgba(37,99,235,0.18)] bg-[rgba(37,99,235,0.04)] animate-in slide-in-from-top-2 duration-200">
          <span className="text-sm font-semibold text-brand-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              onClick={() => handleBulkDecision("SETTLED")}
              disabled={!!bulkLoading}
              loading={bulkLoading === "approve"}
            >
              {bulkLoading !== "approve" && <CheckCircle className="w-3.5 h-3.5" />}
              Approve All
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleBulkDecision("DENIED")}
              disabled={!!bulkLoading}
              loading={bulkLoading === "deny"}
            >
              {bulkLoading !== "deny" && <XCircle className="w-3.5 h-3.5" />}
              Deny All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportSelected}
              disabled={exportLoading}
              loading={exportLoading}
            >
              {!exportLoading && <Download className="w-3.5 h-3.5" />}
              Export Selected
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="w-3.5 h-3.5" />
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Deny All */}
      <ConfirmationDialog
        open={showDenyConfirmation}
        onOpenChange={setShowDenyConfirmation}
        title="Confirm Bulk Denial"
        confirmText="Deny All"
        confirmVariant="destructive"
        onConfirm={handleConfirmDeny}
      />

      {/* Select All Warning Dialog */}
      <ConfirmationDialog
        open={showSelectAllWarning}
        onOpenChange={(open) => {
          if (!open) setShowSelectAllWarning(false);
        }}
        title="Select All Across Pages"
        confirmText="Select Current Page"
        onConfirm={handleSelectAllAcrossPages}
        cancelText="Cancel"
      />

      {/* Claims table — its own horizontal scroll container on narrow viewports
          (DESIGN_SYSTEM.md §6), so the page itself never scrolls sideways. */}
      <div className="glass-card overflow-x-auto">
        <ClaimsTable
          claims={data?.claims}
          isLoading={isLoading}
          error={error}
          currentSortBy={params.sort_by}
          currentSortOrder={params.sort_order}
          onSort={handleSort}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onToggleAll={handleToggleAll}
          onViewPipeline={setSelectedPipelineClaim}
        />
      </div>

      <ClaimsPipelineDrawer
        claimRef={selectedPipelineClaim}
        open={!!selectedPipelineClaim}
        onOpenChange={(open) => !open && setSelectedPipelineClaim(null)}
      />

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-2 text-sm">
          <span className="text-white/42">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}-{Math.min(currentPage * PAGE_SIZE, data.total)} of {data.total} claims
          </span>
          <div className="flex items-center gap-2">
            <button
              className="ui-button-secondary px-2 py-1 disabled:opacity-30"
              disabled={currentPage <= 1}
              onClick={() => updateParams({ page: currentPage - 1 })}
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => updateParams({ page })}
                className={`px-3 py-1 rounded-lg text-sm ${
                  page === currentPage
                    ? "ui-button-primary"
                    : "ui-button-secondary"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              className="ui-button-secondary px-2 py-1 disabled:opacity-30"
              disabled={currentPage >= totalPages}
              onClick={() => updateParams({ page: currentPage + 1 })}
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
