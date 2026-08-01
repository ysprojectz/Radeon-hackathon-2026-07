"use client";
import { Fragment, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight, Bot, UserCheck } from "lucide-react";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { CLAIM_TYPE_LABELS } from "@/lib/constants";
import type { ClaimLineItemResponse, SettlementResponse } from "@/lib/types";

interface LineItemsTableProps {
  lineItems: ClaimLineItemResponse[];
  currency: string;
  settlement?: SettlementResponse | null;
}

export function LineItemsTable({ lineItems, currency, settlement }: LineItemsTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  function toggleRow(lineNumber: number) {
    setExpandedRow((prev) => (prev === lineNumber ? null : lineNumber));
  }

  return (
    <div className="glass-card rounded-xl border border-white/[0.08] overflow-x-auto">
      {/* Table header */}
      <div className="grid grid-cols-[32px_1fr_1fr_100px_100px_100px_110px_110px] gap-0 bg-white/[0.04] border-b border-white/[0.08] px-4 py-2.5">
        {["#","Code","Category","Billed","Allowed","Copay","Plan Paid","Status"].map((h) => (
          <span key={h} className="text-[10px] font-semibold uppercase tracking-widest text-white/40 px-1 last:text-center">{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y divide-white/[0.05]">
        {lineItems.map((item) => {
          const isExpanded = expandedRow === item.line_number;
          return (
            <Fragment key={item.line_number}>
              <div
                className="grid grid-cols-[32px_1fr_1fr_100px_100px_100px_110px_110px] gap-0 px-4 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors items-center"
                onClick={() => toggleRow(item.line_number)}
              >
                {/* # */}
                <span className="flex items-center gap-1 text-xs text-white/40 px-1">
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3 text-brand-primary" />
                    : <ChevronRight className="h-3 w-3 text-white/30" />}
                  {item.line_number}
                </span>

                {/* Code */}
                <div className="px-1 space-y-0.5">
                  <span className="font-mono text-xs font-semibold text-brand-primary">{item.procedure_code}</span>
                  {item.procedure_desc && (
                    <p className="text-[11px] text-white/45 leading-tight">{item.procedure_desc}</p>
                  )}
                </div>

                {/* Category */}
                <div className="px-1">
                  <span className="inline-block rounded-lg bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-white/60">
                    {CLAIM_TYPE_LABELS[item.service_category] ?? item.service_category}
                  </span>
                </div>

                {/* Amounts */}
                <span className="px-1 text-right text-sm text-white/75 tabular-nums">
                  <CurrencyAmount amount={item.billed_amount} currency={currency} />
                </span>
                <span className="px-1 text-right text-sm text-white/75 tabular-nums">
                  <CurrencyAmount amount={item.allowed_amount} currency={currency} />
                </span>
                <span className="px-1 text-right text-sm text-white/75 tabular-nums">
                  <CurrencyAmount amount={item.copay_amount} currency={currency} />
                </span>
                <span className="px-1 text-right text-sm font-semibold text-white/90 tabular-nums">
                  <CurrencyAmount amount={item.plan_paid} currency={currency} />
                </span>

                {/* Status badge */}
                <div className="px-1 flex justify-center">
                  {item.is_covered === false ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">
                      <XCircle className="h-3 w-3" />Denied
                    </span>
                  ) : item.sub_limit_applied ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400">
                      <AlertCircle className="h-3 w-3" />Sub-limit
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      <CheckCircle className="h-3 w-3" />Covered
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="glass-card border-t border-white/[0.06] px-5 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* AI Remarks */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-primary/80 uppercase tracking-wider">
                        <Bot className="h-3.5 w-3.5" />AI Agent Remarks
                      </div>
                      <div className="glass-card rounded-xl border border-white/[0.08] bg-black/30 p-3 space-y-2 text-xs">
                        {item.is_covered === false && (
                          <div>
                            <span className="font-semibold text-red-400">Denial Reason: </span>
                            <span className="text-white/70">{item.denial_reason ?? "Not specified"}</span>
                            {item.denial_code && (
                              <span className="ml-1.5 text-white/40">(Code: {item.denial_code})</span>
                            )}
                          </div>
                        )}
                        {item.sub_limit_applied && item.sub_limit_name && (
                          <div>
                            <span className="font-semibold text-amber-400">Sub-limit Applied: </span>
                            <span className="text-white/70">{item.sub_limit_name}</span>
                          </div>
                        )}
                        {item.calculation_steps && item.calculation_steps.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-semibold text-white/60">Adjudication Logic:</span>
                            <div className="space-y-1 mt-1">
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {item.calculation_steps.map((step: any, i) => {
                                const stepName = String(step.step || "Step");
                                const isCritical = ["ZONAL_COPAY", "ICU_RENT_CAP", "ROOM_RENT_CAP", "PROPORTIONATE_DEDUCTION", "GIPSA_CAP"].includes(stepName);
                                
                                return (
                                  <div key={i} className={`rounded-lg border px-2 py-1.5 ${isCritical ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-white/5"}`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`text-[9px] font-bold uppercase tracking-widest ${isCritical ? "text-amber-400" : "text-white/40"}`}>
                                        {stepName.replace(/_/g, " ")}
                                      </span>
                                      {step.rate && <span className="text-[9px] font-mono text-white/30">{step.rate}</span>}
                                      {step.ratio && <span className="text-[9px] font-mono text-white/30">Ratio: {step.ratio}</span>}
                                    </div>
                                    <div className="text-[11px] text-white/60 leading-relaxed">
                                      {Object.entries(step)
                                        .filter(([k]) => !["step", "rate", "ratio"].includes(k))
                                        .map(([k, v]) => (
                                          <span key={k} className="mr-3">
                                            <span className="text-white/30 lowercase italic mr-1">{k}:</span>
                                            <span className="font-mono text-white/70">{String(v)}</span>
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {item.clause_references && item.clause_references.length > 0 && (
                          <div>
                            <span className="font-semibold text-white/60">Policy References:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.clause_references.map((ref, i) => (
                                <span key={i} className="inline-block rounded-full bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 text-[10px] text-brand-primary/80">
                                  {ref}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {item.is_covered !== false && !item.sub_limit_applied &&
                          (!item.calculation_steps || item.calculation_steps.length === 0) &&
                          (!item.clause_references || item.clause_references.length === 0) && (
                          <p className="text-white/35 italic">Claim covered — no additional remarks.</p>
                        )}
                      </div>
                    </div>

                    {/* Approver Remarks */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-400/80 uppercase tracking-wider">
                        <UserCheck className="h-3.5 w-3.5" />Claim Approver Remarks
                      </div>
                      <div className="glass-card rounded-xl border border-white/[0.08] bg-black/30 p-3 space-y-2 text-xs">
                        {settlement?.was_hitl_reviewed ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="font-semibold text-emerald-400">Reviewed by Claims Approver</span>
                            </div>
                            {settlement.hitl_justification && (
                              <div>
                                <span className="font-semibold text-white/60">Justification: </span>
                                <span className="text-white/55">{settlement.hitl_justification}</span>
                              </div>
                            )}
                            {settlement.hitl_override_amount && (
                              <div>
                                <span className="font-semibold text-white/60">Amount Overridden to: </span>
                                <CurrencyAmount amount={settlement.hitl_override_amount} currency={currency} />
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-white/35 italic">Auto-adjudicated by AI Engine.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
