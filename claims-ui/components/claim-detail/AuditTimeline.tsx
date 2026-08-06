"use client";
import Link from "next/link";
import { HashChainBadge } from "@/components/shared/HashChainBadge";
import { truncateHash, formatTimeOnly, formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { AuditTrailResponse } from "@/lib/types";

const EVENT_COLORS: Record<string, string> = {
  // Processing pipeline
  CLAIM_RECEIVED:               "bg-blue-400",
  RULES_EVALUATED:              "bg-indigo-400",
  REASONING_COMPLETED:          "bg-violet-400",
  SETTLEMENT_CALCULATED:        "bg-teal-400",
  HITL_QUEUED:                  "bg-orange-400",
  HITL_DECISION:                "bg-emerald-400",
  CLAIM_SETTLED:                "bg-emerald-500",
  CLAIM_DENIED:                 "bg-red-400",
  OCR_COMPLETED:                "bg-brand-primary",
  DOCUMENT_VALIDATION_GATE:     "bg-emerald-400",
  ADJUDICATION_STARTED:         "bg-violet-400",
  ADJUDICATION_COMPLETED:       "bg-violet-500",
  // Disbursement lifecycle
  DISBURSEMENT_QUEUED:          "bg-teal-500",
  ACCOUNT_REGISTERED:           "bg-blue-400",
  ACCOUNT_CREATED:              "bg-blue-400",
  ACCOUNT_VERIFIED:             "bg-emerald-400",
  ACCOUNT_VERIFICATION_PENDING: "bg-amber-400",
  ACCOUNT_NOT_REGISTERED:       "bg-orange-500",
  ACCOUNT_REJECTED:             "bg-red-500",
  GATEWAY_SYNC_PENDING:         "bg-amber-300",
  GATEWAY_SYNCED:               "bg-indigo-400",
  PAYOUT_INITIATED:             "bg-amber-400",
  PAYOUT_PROCESSING:            "bg-amber-500",
  PAYOUT_COMPLETED:             "bg-emerald-500",
  PAYOUT_FAILED:                "bg-red-500",
};

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  // Intake & processing
  PDF_UPLOADED:                 "Claim Initiated",
  CLAIM_RECEIVED:               "Claim Initiated",
  OCR_COMPLETED:                "Document Processed",
  NLP_EXTRACTION_COMPLETED:     "Fields Extracted",
  DOCUMENT_VALIDATION_GATE:     "Validation Complete",
  POLICY_RETRIEVED:             "Policy Matched",
  CLAUSES_IDENTIFIED:           "Coverage Rules Identified",
  ADJUDICATION_STARTED:         "Processing",
  RULES_EVALUATED:              "Rules Verified",
  REASONING_COMPLETED:          "AI Analysis Complete",
  CONFIDENCE_SCORED:            "Confidence Scored",
  SETTLEMENT_CALCULATED:        "Settlement Calculated",
  SETTLEMENT_APPROVED:          "Settlement Approved",
  HITL_ROUTED:                  "Review Required",
  HITL_QUEUED:                  "Review Required",
  HITL_DECISION_MADE:           "Human Decision",
  HITL_DECISION:                "Human Decision",
  CLAIM_SETTLED:                "Claim Approved & Settled",
  CLAIM_DENIED:                 "Claim Denied",
  CLAIM_STATUS_CHANGE:          "Status Updated",
  ADJUDICATION_COMPLETED:       "Processing Complete",
  // Disbursement lifecycle
  DISBURSEMENT_QUEUED:          "Disbursement Queued",
  ACCOUNT_REGISTERED:           "Bank Account Registered",
  ACCOUNT_CREATED:              "Bank Account Registered",
  ACCOUNT_VERIFICATION_PENDING: "Awaiting Bank Verification",
  ACCOUNT_NOT_REGISTERED:       "Bank Account Required",
  ACCOUNT_VERIFIED:             "Bank Account Verified",
  ACCOUNT_REJECTED:             "Bank Account Rejected",
  GATEWAY_SYNC_PENDING:         "Awaiting Gateway Sync",
  GATEWAY_SYNCED:               "Payment Rail Active",
  PAYOUT_INITIATED:             "Payment Initiated",
  PAYOUT_PROCESSING:            "Payment Processing",
  PAYOUT_COMPLETED:             "Payment Credited",
  PAYOUT_FAILED:                "Payment Failed",
};

interface AuditTimelineProps {
  audit: AuditTrailResponse;
  showHash?: boolean;
}

function getAuditDescription(entry: AuditTrailResponse["entries"][number], claimReference: string) {
  if (entry.event_type !== "PDF_UPLOADED" || !entry.description.includes("unknown")) {
    return entry.description;
  }

  const data = entry.event_data as Record<string, unknown>;
  const storagePath = data?.storage_path ? String(data.storage_path) : "";
  if (storagePath && storagePath !== "unknown") {
    return `PDF saved to storage: ${storagePath}`;
  }

  const originalFilename = data?.original_filename ? String(data.original_filename) : "";
  if (originalFilename && claimReference) {
    return `PDF saved to storage: claims/${claimReference}/received_${originalFilename}`;
  }

  if (originalFilename) {
    return `PDF saved to storage: ${originalFilename}`;
  }

  return entry.description;
}

export function AuditTimeline({ audit, showHash = false }: AuditTimelineProps) {
  const calculateTAT = (entries: typeof audit.entries, fromIndex: number, toIndex: number) => {
    if (fromIndex >= entries.length || toIndex >= entries.length || fromIndex >= toIndex) return null;
    const diffMs = new Date(entries[toIndex].timestamp).getTime() - new Date(entries[fromIndex].timestamp).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return null;
    if (diffMs < 1000)    return "<1s";
    if (diffMs < 60000)   return `${Math.round(diffMs / 1000)}s`;
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)}m`;
    if (diffMs < 86400000)return `${Math.round(diffMs / 3600000)}h`;
    return `${Math.round(diffMs / 86400000)}d`;
  };

  // Group consecutive events by stage label
  const groupedEntries: { entries: typeof audit.entries; stage: string | undefined }[] = [];
  let currentGroup: { entries: typeof audit.entries; stage: string | undefined } | null = null;
  for (const entry of audit.entries) {
    const stageLabel = PIPELINE_STAGE_LABELS[entry.event_type];
    if (!currentGroup) {
      currentGroup = { entries: [entry], stage: stageLabel };
    } else if (stageLabel) {
      groupedEntries.push(currentGroup);
      currentGroup = { entries: [entry], stage: stageLabel };
    } else {
      currentGroup.entries.push(entry);
    }
  }
  if (currentGroup) groupedEntries.push(currentGroup);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40">{audit.total_entries} events</p>
        <HashChainBadge valid={audit.chain_valid} />
      </div>

      <ol className="relative space-y-0">
        {groupedEntries.map((group, groupIndex) => {
          const firstEntry = group.entries[0];
          const isLastGroup = groupIndex === groupedEntries.length - 1;
          const dotColor   = EVENT_COLORS[firstEntry.event_type] ?? "bg-white/30";
          const stageLabel = group.stage || firstEntry.event_type.replace(/_/g, " ");
          const entryIndex = audit.entries.findIndex(
            (e) => e.entry_hash === firstEntry.entry_hash || e.timestamp === firstEntry.timestamp
          );
          const tatToThisStage = groupIndex > 0 && entryIndex >= 0
            ? calculateTAT(audit.entries, 0, entryIndex)
            : null;

          return (
            <li key={`${firstEntry.entry_hash}-${groupIndex}`} className="flex gap-4 pb-5 last:pb-0">
              {/* Rail */}
              <div className="flex flex-col items-center pt-1 shrink-0">
                <div className={cn("h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-black/40", dotColor)} />
                {!isLastGroup && <div className="w-px flex-1 bg-white/[0.07] mt-1.5" />}
              </div>

              {/* Content */}
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-white/90">{stageLabel}</span>
                  <span className="text-[11px] text-white/40">
                    {firstEntry.actor_type}{firstEntry.actor_id ? ` (${firstEntry.actor_id})` : ""}
                  </span>
                  <span className="ml-auto text-[11px] text-white/35 tabular-nums shrink-0">
                    {formatDateTime(firstEntry.timestamp)}
                  </span>
                </div>

                {tatToThisStage && (
                  <span className="inline-block rounded-full bg-white/[0.05] border border-white/[0.07] px-2 py-0.5 text-[10px] text-white/40">
                    +{tatToThisStage} from start
                  </span>
                )}

                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/20">
                  PIPELINE · {stageLabel.toUpperCase()}
                </div>

                <p className="text-[12px] text-white/65 leading-relaxed">{getAuditDescription(firstEntry, audit.claim_reference)}</p>

                {/* Disbursement reference badge */}
                {firstEntry.event_type === "PAYOUT_COMPLETED" && (() => {
                  const txnId = (firstEntry.event_data as Record<string, unknown>)?.gateway_txn_id;
                  return txnId ? (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="font-mono text-[11px] font-bold text-emerald-300 tracking-wide">
                        Ref: {String(txnId)}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* Pending state indicator */}
                {(firstEntry.event_type === "ACCOUNT_VERIFICATION_PENDING" ||
                  firstEntry.event_type === "ACCOUNT_NOT_REGISTERED" ||
                  firstEntry.event_type === "GATEWAY_SYNC_PENDING") && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                      <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">Pending Action</span>
                    </span>
                    <Link
                      href={`/accounts?search=${encodeURIComponent(audit.claim_reference)}&status=${firstEntry.event_type === "ACCOUNT_NOT_REGISTERED" ? "ALL" : "UNVERIFIED"}`}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/62 transition-colors hover:border-[var(--status-info)]/30 hover:text-[var(--status-info)]"
                    >
                      Open Accounts
                    </Link>
                  </div>
                )}

                {showHash && (
                  <p className="font-mono text-[10px] text-white/25">
                    {truncateHash(firstEntry.entry_hash)}
                    {group.entries.length > 1 && ` +${group.entries.length - 1} events`}
                  </p>
                )}

                {group.entries.length > 1 && (
                  <div className="ml-3 space-y-1 pt-1 border-l border-white/[0.06] pl-3">
                    {group.entries.slice(1).map((subEntry, subIndex) => (
                      <div key={`${subEntry.entry_hash}-${subIndex}`} className="flex items-center gap-2 text-[11px]">
                        <div className="h-1 w-1 rounded-full bg-white/20 shrink-0" />
                        <span className="text-white/35">{subEntry.event_type.replace(/_/g, " ")}</span>
                        <span className="ml-auto text-white/25 tabular-nums">{formatTimeOnly(subEntry.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
