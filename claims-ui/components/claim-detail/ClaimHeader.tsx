"use client";
import { MapPin, Stethoscope, Calendar, User } from "lucide-react";
import { ClaimStatusBadge } from "@/components/claims/ClaimStatusBadge";
import { ConfidenceScore } from "@/components/shared/ConfidenceScore";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { formatDate } from "@/lib/utils";
import type { ClaimResponse } from "@/lib/types";

interface ClaimHeaderProps {
  claim: ClaimResponse;
  actions?: React.ReactNode;
}

export function ClaimHeader({ claim, actions }: ClaimHeaderProps) {
  return (
    <div className="glass-card rounded-xl dark:border-white/10 border-slate-200 dark:bg-[var(--bg-secondary)]/60 bg-white/70 p-6 space-y-5">
      {/* Top row: reference + status + actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-lg font-bold dark:text-[var(--brand-primary)] text-cyan-600">
            {claim.claim_reference}
          </span>
          <ClaimStatusBadge status={claim.status} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {claim.confidence_score && (
            <ConfidenceScore score={claim.confidence_score} />
          )}
          {actions}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 dark:text-slate-500 text-slate-400 shrink-0" />
          <div>
            <p className="text-xs dark:text-slate-500 text-slate-400">Patient</p>
            <p className="font-medium dark:text-white text-slate-900">{claim.patient_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 dark:text-slate-500 text-slate-400 shrink-0" />
          <div>
            <p className="text-xs dark:text-slate-500 text-slate-400">Provider</p>
            <p className="font-medium dark:text-white text-slate-900">{claim.provider_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 dark:text-slate-500 text-slate-400 shrink-0" />
          <div>
            <p className="text-xs dark:text-slate-500 text-slate-400">Member · Market</p>
            <p className="font-medium dark:text-white text-slate-900">
              {claim.member_number} · {claim.market_region}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 dark:text-slate-500 text-slate-400 shrink-0" />
          <div>
            <p className="text-xs dark:text-slate-500 text-slate-400">Service Date</p>
            <p className="font-medium dark:text-white text-slate-900">{formatDate(claim.service_date)}</p>
          </div>
        </div>
      </div>

      {/* Diagnosis */}
      {claim.primary_diagnosis_code && (
        <div className="flex items-center gap-2 text-sm dark:border-white/10 border-slate-200 border-t pt-3">
          <span className="rounded-lg dark:bg-white/5 bg-slate-100 px-2.5 py-1 font-mono text-xs dark:text-[var(--brand-primary)] text-cyan-600">
            {claim.primary_diagnosis_code}
          </span>
          <span className="dark:text-slate-400 text-slate-500">
            {claim.primary_diagnosis_desc ?? "\u2014"}
          </span>
          <span className="ml-auto text-xs dark:text-slate-500 text-slate-400">
            {claim.claim_type} · {claim.network_tier}
          </span>
        </div>
      )}

      {/* Billed amount banner */}
      <div className="flex items-center gap-6 rounded-xl dark:bg-white/5 bg-slate-50 px-5 py-3 text-sm flex-wrap">
        <span className="dark:text-slate-400 text-slate-500">Total Billed:</span>
        <CurrencyAmount
          amount={claim.total_billed}
          currency={claim.currency}
          bold
          className="text-base dark:text-white text-slate-900"
        />
        {claim.total_settlement && (
          <>
            <span className="dark:text-slate-600 text-slate-300">→</span>
            <div>
              <span className="text-xs dark:text-slate-400 text-slate-500 mr-1">Plan Paid:</span>
              <CurrencyAmount
                amount={claim.total_settlement}
                currency={claim.currency}
                bold
                className="text-base dark:text-[var(--brand-secondary)] text-emerald-600"
              />
            </div>
          </>
        )}
        {claim.total_member_responsibility && (
          <>
            <span className="dark:text-slate-600 text-slate-300">·</span>
            <div>
              <span className="text-xs dark:text-slate-400 text-slate-500 mr-1">Member:</span>
              <CurrencyAmount
                amount={claim.total_member_responsibility}
                currency={claim.currency}
                className="font-semibold dark:text-[var(--brand-warning)] text-amber-600"
              />
            </div>
          </>
        )}
        {claim.processing_time_ms && (
          <span className="ml-auto text-xs dark:text-slate-500 text-slate-400">
            Processed in {claim.processing_time_ms.toLocaleString()} ms
          </span>
        )}
      </div>
    </div>
  );
}
