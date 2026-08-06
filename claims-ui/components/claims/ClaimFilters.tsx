"use client";

import { Search, X, Calendar, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClaimsFilters } from "@/lib/hooks/useClaimsFilters";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  SETTLED: "Settled",
  DENIED: "Denied",
  HITL_PENDING: "Review Pending",
  HITL_APPROVED: "Review Approved",
  HITL_DENIED: "Review Declined",
  ERROR: "Error",
};

const MARKET_LABEL: Record<string, string> = {
  INDIA: "India",
};

const ALL = "__all__";
const DEBOUNCE_MS = 300;
const MARKET_OPTIONS = [
  { value: "INDIA", label: "India" },
];

type DraftFilters = {
  status: string;
  market_region: string;
  service_date_from: string;
  service_date_to: string;
  received_date_from: string;
  received_date_to: string;
};

function buildDraft(params: ReturnType<typeof useClaimsFilters>["params"]): DraftFilters {
  return {
    status: params.status ?? "",
    market_region: params.market_region ?? "",
    service_date_from: params.service_date_from ?? "",
    service_date_to: params.service_date_to ?? "",
    received_date_from: params.received_date_from ?? "",
    received_date_to: params.received_date_to ?? "",
  };
}

export function ClaimFilters() {
  const { params, updateParams } = useClaimsFilters();
  const [localSearch, setLocalSearch] = useState(params.search ?? "");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draft, setDraft] = useState<DraftFilters>(() => buildDraft(params));
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (popoverOpen) return;
    setDraft({
      status: params.status ?? "",
      market_region: params.market_region ?? "",
      service_date_from: params.service_date_from ?? "",
      service_date_to: params.service_date_to ?? "",
      received_date_from: params.received_date_from ?? "",
      received_date_to: params.received_date_to ?? "",
    });
  }, [
    popoverOpen,
    params.status,
    params.market_region,
    params.service_date_from,
    params.service_date_to,
    params.received_date_from,
    params.received_date_to,
  ]);

  useEffect(() => {
    setLocalSearch(params.search ?? "");
  }, [params.search]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const outsideButton = !popoverRef.current?.contains(target);
      const outsidePanel = !panelRef.current?.contains(target);
      if (outsideButton && outsidePanel) {
        setPopoverOpen(false);
      }
    }

    function handleScroll() {
      // Reposition on scroll so panel tracks its anchor
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
      }
    }

    function handleResize() {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [popoverOpen]);

  function handleSearchChange(value: string) {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ search: value.trim() || undefined, page: 1 });
    }, DEBOUNCE_MS);
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLocalSearch("");
    setDraft({
      status: "",
      market_region: "",
      service_date_from: "",
      service_date_to: "",
      received_date_from: "",
      received_date_to: "",
    });
    updateParams({
      status: undefined,
      market_region: undefined,
      search: undefined,
      service_date_from: undefined,
      service_date_to: undefined,
      received_date_from: undefined,
      received_date_to: undefined,
      page: 1,
    });
  }

  function handleApply() {
    updateParams({
      status: draft.status || undefined,
      market_region: draft.market_region || undefined,
      service_date_from: draft.service_date_from || undefined,
      service_date_to: draft.service_date_to || undefined,
      received_date_from: draft.received_date_from || undefined,
      received_date_to: draft.received_date_to || undefined,
      page: 1,
    });
    setPopoverOpen(false);
  }

  function handleDraftClear() {
    setDraft({
      status: "",
      market_region: "",
      service_date_from: "",
      service_date_to: "",
      received_date_from: "",
      received_date_to: "",
    });
  }

  const hasFilters = params.status || params.market_region;
  const hasDateFilters =
    params.service_date_from ||
    params.service_date_to ||
    params.received_date_from ||
    params.received_date_to;
  const activeFilterCount = [
    params.status,
    params.market_region,
    params.service_date_from || params.service_date_to ? "date1" : null,
    params.received_date_from || params.received_date_to ? "date2" : null,
  ].filter(Boolean).length;
  const activeFilters = [
    params.status ? { key: "status", label: "Status", value: STATUS_LABEL[params.status] ?? params.status } : null,
    params.market_region ? { key: "market", label: "Market", value: MARKET_LABEL[params.market_region] ?? params.market_region } : null,
    params.service_date_from || params.service_date_to
      ? { key: "service_date", label: "Service", value: `${params.service_date_from ?? "Any"} -> ${params.service_date_to ?? "Any"}` }
      : null,
    params.received_date_from || params.received_date_to
      ? { key: "received_date", label: "Received", value: `${params.received_date_from ?? "Any"} -> ${params.received_date_to ?? "Any"}` }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string }>;
  const activeFilterSummary = activeFilters.map((filter) => `${filter.label}: ${filter.value}`).join(" / ");

  const serviceDateError =
    draft.service_date_from &&
    draft.service_date_to &&
    draft.service_date_from > draft.service_date_to;
  const receivedDateError =
    draft.received_date_from &&
    draft.received_date_to &&
    draft.received_date_from > draft.received_date_to;
  const draftInvalid = Boolean(serviceDateError || receivedDateError);

  return (
    <>
      <div className="min-w-0 flex-1 overflow-visible">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-[18rem] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--status-info)]/80" />
            <input
              aria-label="Search claims"
              placeholder="Search reference, patient, member, provider"
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="ui-form-field h-11 w-full rounded-2xl border-white/[0.09] bg-black/22 pl-10 pr-10 text-sm"
            />
            {localSearch && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => handleSearchChange("")}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/42 transition hover:bg-white/[0.08] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative flex shrink-0 flex-wrap items-center gap-2" ref={popoverRef}>
              <button
                ref={buttonRef}
                onClick={() => {
                  if (!popoverOpen && buttonRef.current) {
                    const rect = buttonRef.current.getBoundingClientRect();
                    setDropdownPos({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
                  }
                  setPopoverOpen((open) => !open);
                }}
                className={cn(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-2xl border px-4 text-xs font-bold transition",
                  activeFilterCount > 0 || popoverOpen
                    ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                    : "border-white/[0.09] bg-white/[0.035] text-white/70 hover:border-cyan-300/28 hover:bg-cyan-300/[0.08] hover:text-cyan-50"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-cyan-200/18 px-1.5 py-0.5 text-[9px] font-black text-cyan-50">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {(hasFilters || hasDateFilters || localSearch) && (
                <button
                  onClick={handleClear}
                  className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 text-xs font-semibold text-white/54 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}

              {popoverOpen && dropdownPos && createPortal(
                <div
                  ref={panelRef}
                  style={{ position: "fixed", top: dropdownPos.top, right: dropdownPos.right, zIndex: 9999, maxHeight: `calc(100vh - ${dropdownPos.top}px - 16px)`, overflowY: "auto" as const }}
                  className="w-[min(92vw,440px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1016] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                  <div className="border-b border-white/[0.06] px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-2xl border border-cyan-300/12 bg-cyan-300/10 p-2 text-cyan-200">
                        <SlidersHorizontal className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="ui-control-label text-white/78">Claims Filters</p>
                        <p className="mt-1 text-xs text-white/40">
                          Refine the claims table by workflow state, market, and date windows.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <label className="ui-control-label text-white/48">Status</label>
                        <select
                          value={draft.status || ALL}
                          onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value === ALL ? "" : e.target.value }))}
                          className={cn(
                            "ui-form-field w-full",
                            draft.status && "border-cyan-300/35 bg-cyan-300/[0.09] text-cyan-50"
                          )}
                        >
                          <option value={ALL}>All Statuses</option>
                          <option value="PENDING">Pending</option>
                          <option value="PROCESSING">Processing</option>
                          <option value="SETTLED">Settled</option>
                          <option value="DENIED">Denied</option>
                          <option value="HITL_PENDING">Review Pending</option>
                          <option value="HITL_APPROVED">Review Approved</option>
                          <option value="HITL_DENIED">Review Declined</option>
                          <option value="ERROR">Error</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="ui-control-label text-white/48">Market</label>
                        <select
                          value={draft.market_region || ALL}
                          onChange={(e) => setDraft((prev) => ({ ...prev, market_region: e.target.value === ALL ? "" : e.target.value }))}
                          className={cn(
                            "ui-form-field w-full",
                            draft.market_region && "border-purple-300/35 bg-purple-300/[0.09] text-purple-50"
                          )}
                        >
                          <option value={ALL}>All Markets</option>
                          {MARKET_OPTIONS.map((market) => (
                            <option key={market.value} value={market.value}>{market.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-cyan-300" />
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/62">
                          Service Date
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">From</span>
                          <input
                            type="date"
                            value={draft.service_date_from}
                            onChange={(e) => setDraft((prev) => ({ ...prev, service_date_from: e.target.value }))}
                            className="ui-form-field h-10 w-full text-sm [color-scheme:dark]"
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">To</span>
                          <input
                            type="date"
                            value={draft.service_date_to}
                            min={draft.service_date_from || undefined}
                            onChange={(e) => setDraft((prev) => ({ ...prev, service_date_to: e.target.value }))}
                            className="ui-form-field h-10 w-full text-sm [color-scheme:dark]"
                          />
                        </label>
                      </div>
                      {serviceDateError && (
                        <p className="mt-2 text-[11px] font-semibold text-rose-300">
                          From cannot be after To.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-amber-300" />
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/62">
                          Received Date
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">From</span>
                          <input
                            type="date"
                            value={draft.received_date_from}
                            onChange={(e) => setDraft((prev) => ({ ...prev, received_date_from: e.target.value }))}
                            className="ui-form-field h-10 w-full text-sm [color-scheme:dark]"
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">To</span>
                          <input
                            type="date"
                            value={draft.received_date_to}
                            min={draft.received_date_from || undefined}
                            onChange={(e) => setDraft((prev) => ({ ...prev, received_date_to: e.target.value }))}
                            className="ui-form-field h-10 w-full text-sm [color-scheme:dark]"
                          />
                        </label>
                      </div>
                      {receivedDateError && (
                        <p className="mt-2 text-[11px] font-semibold text-rose-300">
                          From cannot be after To.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <button
                      onClick={handleDraftClear}
                      className="ui-button-secondary px-3 py-2 text-xs font-medium"
                    >
                      Reset Panel
                    </button>
                    <button
                      onClick={handleApply}
                      disabled={draftInvalid}
                      className="ui-button-primary px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>,
                document.body
              )}
          </div>
        </div>
        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-100/55">
              Applied:
            </span>
            <div className="min-w-0 text-xs font-semibold text-white/76 lg:hidden">
              {activeFilterSummary}
            </div>
          </div>
        )}
      </div>

      {(params.status || params.market_region || params.received_date_from || params.received_date_to || params.service_date_from || params.service_date_to) && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {params.status && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-3 py-1 text-[11px] font-bold text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.08)]">
              Status: {STATUS_LABEL[params.status] ?? params.status}
              <button
                aria-label="Remove status filter"
                onClick={() => updateParams({ status: undefined, page: 1 })}
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {params.market_region && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-300/35 bg-purple-300/15 px-3 py-1 text-[11px] font-bold text-purple-100 shadow-[0_0_18px_rgba(192,132,252,0.08)]">
              Market: {MARKET_LABEL[params.market_region] ?? params.market_region}
              <button
                aria-label="Remove market filter"
                onClick={() => updateParams({ market_region: undefined, page: 1 })}
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {(params.received_date_from || params.received_date_to) && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
              <Calendar className="h-3 w-3" />
              Received: {params.received_date_from ?? "..."} → {params.received_date_to ?? "..."}
              <button
                aria-label="Remove received date filter"
                onClick={() => updateParams({ received_date_from: undefined, received_date_to: undefined, page: 1 })}
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {(params.service_date_from || params.service_date_to) && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-400/25 bg-green-400/10 px-3 py-1 text-[11px] font-semibold text-green-200">
              <Calendar className="h-3 w-3" />
              Service: {params.service_date_from ?? "..."} → {params.service_date_to ?? "..."}
              <button
                aria-label="Remove service date filter"
                onClick={() => updateParams({ service_date_from: undefined, service_date_to: undefined, page: 1 })}
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
