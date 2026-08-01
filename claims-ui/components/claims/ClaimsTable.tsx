"use client";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimStatusBadge } from "./ClaimStatusBadge";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { ConfidenceScore } from "@/components/shared/ConfidenceScore";
import { EmptyState } from "@/components/shared/EmptyState";
import { getClaimLifecycleSnapshot, LifecycleStatusPill } from "@/components/operations/lifecycle-utils";
import { FileText, Eye, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Activity } from "lucide-react";
import type { ClaimResponse } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { CLAIM_TYPE_LABELS } from "@/lib/constants";

// Sanitize patient names that contain OCR form-header bleed-through.
// This is defense-in-depth for data already stored before the OCR fix.
const FORM_JUNK_KEYWORDS = ["CLAIM FORM", "CLAIM REFERENCE", "SUBMISSION DATE", "CLAIM TYPE", "REIMBURSEMENT"];
function sanitizePatientName(name: string): string {
  if (!name || name === "Unknown Patient") return name || "—";
  const upper = name.toUpperCase();
  const isFormJunk =
    name.length > 50 ||
    FORM_JUNK_KEYWORDS.some((kw) => upper.includes(kw));
  return isFormJunk ? "Unknown Patient" : name;
}

interface SortableHeadProps {
  field: string;
  label: string;
  currentSortBy?: string;
  currentSortOrder?: 'asc' | 'desc';
  onSort: (field: string) => void;
  align?: 'left' | 'right';
  className?: string;
}

function SortableHead({ field, label, currentSortBy, currentSortOrder, onSort, align = 'left', className = '' }: SortableHeadProps) {
  const isActive = currentSortBy === field;
  const alignClass = align === 'right' ? 'justify-end' : 'justify-start';
  const ariaSort = isActive ? (currentSortOrder === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-3 text-xs font-bold uppercase text-white/70 ${align === 'right' ? 'text-right' : ''} ${className}`}
    >
      <button
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label} ${isActive ? (currentSortOrder === 'asc' ? 'descending' : 'ascending') : ''}`}
        className={`flex items-center gap-1 ${alignClass} w-full hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary rounded transition-colors group whitespace-nowrap`}
      >
        <span>{label}</span>
        {isActive ? (
          currentSortOrder === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-brand-primary" aria-hidden="true" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-brand-primary" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

interface ClaimsTableProps {
  claims?: ClaimResponse[];
  isLoading: boolean;
  error?: Error | null;
  currentSortBy?: string;
  currentSortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
  onViewPipeline?: (id: string) => void;
}

export function ClaimsTable({ claims, isLoading, error, currentSortBy, currentSortOrder, onSort, selectedIds, onToggleSelect, onToggleAll, onViewPipeline }: ClaimsTableProps) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg dark:bg-white/5 bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-5 m-4 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
        <span className="text-sm font-semibold text-red-400">
          Failed to load claims
        </span>
      </div>
    );
  }

  if (!claims?.length) {
    return (
      <div className="p-8">
        <EmptyState
          icon={FileText}
          title="No claims found"
        />
      </div>
    );
  }

  const handleSort = (field: string) => {
    if (!onSort) return;
    onSort(field);
  };

  const allIds = claims?.map((c) => c.claim_reference) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));
  const someSelected = !allSelected && allIds.some((id) => selectedIds?.has(id));

  return (
    <div className="glass-card overflow-x-auto" style={{ isolation: "isolate" }}>
      <table className="w-full text-left text-sm text-white relative" style={{ borderCollapse: "collapse" }} aria-label="Claims List">
        <colgroup>
          <col style={{ width: "3%" }} />{/* Checkbox */}
          <col style={{ width: "17%" }} />{/* Claim ID — long refs need room */}
          <col style={{ width: "13%" }} />{/* Patient */}
          <col style={{ width: "8%" }} />{/* Type */}
          <col style={{ width: "6%" }} />{/* Market */}
          <col style={{ width: "8%" }} />{/* Date */}
          <col style={{ width: "8%" }} />{/* Status */}
          <col style={{ width: "12%" }} />{/* Journey */}
          <col style={{ width: "10%" }} />{/* Settlement */}
          <col style={{ width: "9%" }} />{/* Confidence (lg+) */}
          <col style={{ width: "6%" }} />{/* Actions */}
        </colgroup>
        <thead className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-md">
          <tr>
            <th scope="col" className="px-3 py-3 text-xs font-bold uppercase text-white/70">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={() => onToggleAll?.(allIds)}
                aria-label="Select all on this page"
                className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[var(--brand-primary)] cursor-pointer focus:ring-2 focus:ring-brand-primary"
              />
            </th>
            <SortableHead
              field="claim_reference"
              label="Claim ID"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
            />
            <SortableHead
              field="patient_name"
              label="Patient"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
            />
            <SortableHead
              field="claim_type"
              label="Type"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
              className="hidden sm:table-cell"
            />
            <SortableHead
              field="market_region"
              label="Market"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
              className="hidden md:table-cell"
            />
            <SortableHead
              field="service_date"
              label="Date"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
              className="hidden lg:table-cell"
            />
            <SortableHead
              field="status"
              label="Status"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
            />
            <th scope="col" className="hidden px-3 py-3 text-xs font-bold uppercase text-white/70 xl:table-cell">
              Journey
            </th>
            <SortableHead
              field="total_settlement"
              label="Settlement"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
              align="right"
            />
            <SortableHead
              field="confidence_score"
              label="Confidence"
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onSort={handleSort}
              align="right"
              className="hidden lg:table-cell"
            />
            <th scope="col" className="px-3 py-3 text-center text-xs font-bold uppercase text-white/70">Actions</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            const lifecycle = getClaimLifecycleSnapshot(claim);
            return (
            <tr
              key={claim.claim_reference}
              className="group relative border-b border-[var(--border-subtle)] transition-all duration-200 hover:bg-[rgba(37,99,235,0.04)] hover:translate-x-0.5 active:scale-[0.998] active:bg-[rgba(37,99,235,0.08)] focus-within:bg-[rgba(37,99,235,0.04)]"
            >
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds?.has(claim.claim_reference) ?? false}
                  onChange={() => onToggleSelect?.(claim.claim_reference)}
                  aria-label={`Select claim ${claim.claim_reference}`}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[var(--brand-primary)] cursor-pointer focus:ring-2 focus:ring-brand-primary"
                />
              </td>
              <td className="px-3 py-3 font-mono font-medium text-brand-primary whitespace-nowrap overflow-hidden text-ellipsis">
                <Link href={`/claims/${claim.claim_reference}`} className="hover:underline focus:outline-none focus:ring-2 focus:ring-brand-primary rounded inline-block" title={claim.claim_reference}>
                  {claim.claim_reference}
                </Link>
              </td>
              <td className="px-3 py-3 text-[var(--text-primary)] overflow-visible" style={{ position: "relative", zIndex: 10 }}>
                <div className="relative w-full group/patient">
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-primary)] transition-colors group-hover/patient:text-brand-primary">
                    {sanitizePatientName(claim.patient_name)}
                  </span>
                  <div className="pointer-events-none absolute left-0 bottom-[calc(100%+6px)] z-[9999] w-56 invisible opacity-0 translate-y-1 transition-all duration-200 group-hover/patient:visible group-hover/patient:opacity-100 group-hover/patient:translate-y-0">
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 shadow-lg">
                      <p className="ui-eyebrow mb-2 text-[var(--text-muted)]">Claimant Data</p>
                      <p className="mb-2.5 text-[15px] font-bold leading-tight text-[var(--text-primary)]">
                        {sanitizePatientName(claim.patient_name)}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
                        <span className="font-mono text-[11px] font-bold tracking-wide text-brand-primary">
                          {claim.claim_reference}
                        </span>
                      </div>
                    </div>
                    {/* Arrow pointing down */}
                    <div className="ml-4 h-2 w-3 overflow-hidden">
                      <div className="h-3 w-3 rotate-45 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-card)] translate-x-0.5" />
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-white/60 text-xs hidden sm:table-cell">
                {CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}
              </td>
              <td className="px-3 py-3 text-white/70 text-xs hidden md:table-cell">
                {claim.market_region}
              </td>
              <td className="px-3 py-3 text-white/50 text-xs hidden lg:table-cell">
                {formatDate(claim.service_date)}
              </td>
              <td className="px-3 py-3">
                <ClaimStatusBadge status={claim.status} />
              </td>
              <td className="hidden px-3 py-3 xl:table-cell">
                <div className="max-w-[150px]" title={`${lifecycle.stage} / ${lifecycle.blocker || lifecycle.nextAction || "No blocker"}`}>
                  <LifecycleStatusPill status={lifecycle.status} compact />
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[10px] font-semibold text-white/54">{lifecycle.stage}</span>
                    <span className="font-mono text-[10px] text-white/28">{lifecycle.age}</span>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-right font-mono text-sm text-white whitespace-nowrap">
                <CurrencyAmount
                  amount={claim.total_settlement ?? claim.total_billed}
                  currency={claim.currency}
                />
              </td>
              <td className="px-3 py-3 text-right hidden lg:table-cell">
                {claim.confidence_score ? (
                  <ConfidenceScore score={claim.confidence_score} size="sm" />
                ) : (
                  <span className="text-xs text-white/40">\u2014</span>
                )}
              </td>
              <td className="px-3 py-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onViewPipeline?.(claim.claim_reference);
                    }}
                    className="text-white/40 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary rounded p-1 inline-block transition-colors"
                    title="View Journey"
                    aria-label={`View Journey for claim ${claim.claim_reference}`}
                  >
                    <Activity className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <Link
                    href={`/claims/${claim.claim_reference}`}
                    className="text-white/40 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary rounded p-1 inline-block transition-colors"
                    title="View Details"
                    aria-label={`View Details for claim ${claim.claim_reference}`}
                  >
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
