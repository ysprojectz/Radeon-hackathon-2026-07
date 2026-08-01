"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle, FileText, CalendarDays } from "lucide-react";
import { TIER_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { PolicyResponse } from "@/lib/types";

interface PolicyCardProps {
  policy: PolicyResponse;
  onUpload: (policy: PolicyResponse) => void;
}

export function PolicyCard({ policy, onUpload }: PolicyCardProps) {
  const clauseCount = policy.clauses_count ?? 0;
  const hasClauses = clauseCount > 0;

  // Date-aware validity: use termination_date as primary (it's always the greater/later date)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const termDate = policy.termination_date ? new Date(policy.termination_date) : null;
  const effDate  = policy.effective_date   ? new Date(policy.effective_date)   : null;
  const isExpired  = termDate ? termDate < today : false;
  const isUpcoming = effDate  ? effDate  > today : false;

  // Effective active = DB says ACTIVE and not expired and not upcoming
  const isActive = policy.status === "ACTIVE" && !isExpired;

  return (
    <div className={`glass-card group rounded-xl transition-all hover:scale-[1.01] border-l-4 ${
      isExpired
        ? "border-l-red-500 opacity-75"
        : isUpcoming
        ? "border-l-amber-400 opacity-90"
        : isActive
        ? "border-l-emerald-500"
        : "dark:border-l-slate-600 border-l-gray-300 opacity-75"
    }`}>
      <div className="p-4 space-y-3">
        {/* Policy number + status */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-xs dark:text-slate-400 text-slate-500">
            {policy.policy_number}
          </p>
          <Badge
            variant="outline"
            className={
              isExpired
                ? "dark:border-red-500/30 border-red-200 dark:bg-red-500/10 bg-red-50 dark:text-red-400 text-red-700 text-xs"
                : isUpcoming
                ? "dark:border-amber-500/30 border-amber-200 dark:bg-amber-500/10 bg-amber-50 dark:text-amber-400 text-amber-700 text-xs"
                : isActive
                ? "dark:border-emerald-500/30 border-green-200 dark:bg-emerald-500/10 bg-green-50 dark:text-emerald-400 text-green-700 text-xs"
                : "dark:border-slate-500/30 border-gray-200 dark:bg-slate-500/10 bg-gray-50 dark:text-slate-400 text-gray-700 text-xs"
            }
          >
            ●{" "}{isExpired ? "EXPIRED" : isUpcoming ? "UPCOMING" : isActive ? "ACTIVE" : "INACTIVE"}
          </Badge>
        </div>

        {/* Name */}
        <div>
          <p className="font-semibold text-sm leading-tight dark:text-white text-slate-900">{policy.policy_name}</p>
          <p className="text-xs dark:text-slate-400 text-slate-500">{policy.carrier_name}</p>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs dark:bg-white/10 dark:text-slate-300">
            {TIER_LABELS[policy.tier] ?? policy.tier}
          </Badge>
          <Badge variant="outline" className="text-xs dark:border-white/10 dark:text-slate-300">
            {policy.currency}
          </Badge>
          {policy.annual_limit && (
            <span className="text-xs dark:text-slate-400 text-slate-500">
              {policy.currency}{" "}
              {Number(policy.annual_limit).toLocaleString()} /yr
            </span>
          )}
        </div>

        {/* Policy validity period — termination_date is always the greater/later date */}
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 dark:text-slate-500 text-slate-400" />
          <span className="dark:text-slate-500 text-slate-400">
            {policy.effective_date ? formatDate(policy.effective_date) : "—"}
          </span>
          <span className="dark:text-slate-600 text-slate-300">→</span>
          <span className={`font-medium ${
            isExpired
              ? "dark:text-red-400 text-red-600"
              : isUpcoming
              ? "dark:text-amber-400 text-amber-600"
              : "dark:text-emerald-400 text-emerald-700"
          }`}>
            {policy.termination_date
              ? formatDate(policy.termination_date)
              : "Open-ended"}
          </span>
          {isExpired && (
            <span className="ml-0.5 dark:text-red-400 text-red-600 font-semibold">(Expired)</span>
          )}
          {isUpcoming && (
            <span className="ml-0.5 dark:text-amber-400 text-amber-600 font-semibold">(Upcoming)</span>
          )}
        </div>

        {/* Clause count */}
        <div className="flex items-center gap-1.5 text-xs">
          {hasClauses ? (
            <>
              <CheckCircle className="h-3.5 w-3.5 dark:text-emerald-400 text-green-500" />
              <span className="dark:text-emerald-400 text-green-700 font-medium">
                {clauseCount} clauses extracted
              </span>
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5 dark:text-slate-500 text-slate-400" />
              <span className="dark:text-slate-400 text-slate-500">
                Policy document not loaded
              </span>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="pt-1">
          <Button
            size="sm"
            variant={hasClauses ? "outline" : "default"}
            className="w-full text-xs gap-1"
            onClick={() => onUpload(policy)}
          >
            <Upload className="h-3 w-3" />
            {hasClauses ? "Re-upload PDF" : "Load Policy Document"}
          </Button>
        </div>
      </div>
    </div>
  );
}
