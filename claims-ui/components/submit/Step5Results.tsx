"use client";
import Link from "next/link";
import { CheckCircle2, RotateCcw, ExternalLink, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaimStatusBadge } from "@/components/claims/ClaimStatusBadge";
import { ConfidenceScore } from "@/components/shared/ConfidenceScore";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { useClaimDetail } from "@/lib/hooks/useClaimDetail";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface Step5Props {
  claimReference: string;
  onReset: () => void;
}

export function Step5Results({ claimReference, onReset }: Step5Props) {
  const { claim, settlement, isLoading } = useClaimDetail(claimReference);

  if (isLoading) {
    return <LoadingSpinner message="Loading result…" />;
  }

  if (!claim) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-muted-foreground">
          Claim processed. Reference:{" "}
          <span className="font-mono font-semibold">{claimReference}</span>
        </p>
        <Button asChild>
          <Link href={`/claims/${claimReference}`}>View Claim →</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status-aware banner */}
      {claim.status === "SETTLED" ? (
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <CheckCircle2 className="h-12 w-12 text-[var(--status-success)]" />
          <h2 className="text-xl font-bold dark:text-[var(--status-success)] text-[var(--status-success)]">
            Claim Adjudicated Successfully
          </h2>
        </div>
      ) : claim.status === "HITL_PENDING" ? (
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <Clock className="h-12 w-12 text-[var(--status-warning)]" />
          <h2 className="text-xl font-bold dark:text-[var(--status-warning)] text-[var(--status-warning)]">Claim Under Review</h2>
        </div>
      ) : claim.status === "DENIED" ? (
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <XCircle className="h-12 w-12 text-[var(--status-danger)]" />
          <h2 className="text-xl font-bold dark:text-[var(--status-danger)] text-[var(--status-danger)]">Claim Denied</h2>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <CheckCircle2 className="h-12 w-12 text-brand-primary" />
          <h2 className="text-xl font-bold dark:text-brand-primary text-brand-primary">Claim Submitted</h2>
        </div>
      )}

      {/* Result card */}
      <div className="rounded-xl border bg-muted/20 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="font-mono text-sm font-bold">{claim.claim_reference}</span>
          <div className="flex items-center gap-2">
            <ClaimStatusBadge status={claim.status} />
            {claim.confidence_score && (
              <ConfidenceScore score={claim.confidence_score} />
            )}
          </div>
        </div>

        {settlement && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-background border p-3">
              <p className="text-xs text-muted-foreground mb-1">Total Billed</p>
              <CurrencyAmount
                amount={settlement.total_billed}
                currency={settlement.currency}
                className="text-base font-semibold"
              />
            </div>
            <div className="rounded-lg dark:bg-[var(--status-success)]/10 bg-[var(--status-success)] border dark:border-[var(--status-success)]/20 border-[var(--status-success)] p-3">
              <p className="text-xs dark:text-[var(--status-success)] text-[var(--status-success)] mb-1">Plan Paid</p>
              <CurrencyAmount
                amount={settlement.total_plan_payment}
                currency={settlement.currency}
                bold
                className="text-base dark:text-[var(--status-success)] text-[var(--status-success)]"
              />
            </div>
            <div className="rounded-lg dark:bg-[var(--status-warning)]/10 bg-[var(--status-warning)] border dark:border-[var(--status-warning)]/20 border-[var(--status-warning)] p-3">
              <p className="text-xs dark:text-[var(--status-warning)] text-[var(--status-warning)] mb-1">Member Resp.</p>
              <CurrencyAmount
                amount={settlement.total_member_responsibility}
                currency={settlement.currency}
                bold
                className="text-base dark:text-[var(--status-warning)] text-[var(--status-warning)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* CTAs */}
      <div className="flex gap-3 justify-center flex-wrap">
        <Button asChild className="gap-1.5">
          <Link href={`/claims/${claim.claim_reference}`}>
            <ExternalLink className="h-4 w-4" />
            View Full Claim Details
          </Link>
        </Button>
        <Button variant="outline" onClick={onReset} className="gap-1.5">
          <RotateCcw className="h-4 w-4" />
          Submit Another Claim
        </Button>
      </div>
    </div>
  );
}
