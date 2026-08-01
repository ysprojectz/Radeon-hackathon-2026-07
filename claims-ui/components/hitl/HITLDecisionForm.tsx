"use client";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, Clock, TrendingUp, Activity, Sparkles } from "lucide-react";
import { HITL_DECISION_LABELS } from "@/lib/constants";
import type { HITLDecision, HITLDecisionCreate, HITLQueueItem } from "@/lib/types";
import { submitHITLDecision, reAdjudicateClaim, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface HITLDecisionFormProps {
  item: HITLQueueItem;
  canDecide: boolean;
  roleLoaded: boolean;
  onSuccess: () => void;
  onClose: () => void;
  onOptimisticSubmit?: (claimRef: string, action: () => Promise<void>) => void;
  shortcutDecision?: { decision: HITLDecision; nonce: number } | null;
}

const DECISIONS: HITLDecision[] = [
  "APPROVE_AI",
  "OVERRIDE_AMOUNT",
  "DENY_CLAIM",
  "ESCALATE",
  "REQUEST_INFO",
];

// Special action key — not a final HITL decision; triggers pipeline re-run
const RE_VERIFY_KEY = "RE_VERIFY_AI" as const;
type DecisionOrReVerify = HITLDecision | typeof RE_VERIFY_KEY;

function buildJustificationSuggestions(item: HITLQueueItem, decision: DecisionOrReVerify | ""): string[] {
  const trigger = item.trigger_reason?.replace(/_/g, " ").toLowerCase() || "manual review";
  if (decision === "APPROVE_AI") {
    return [
      `AI recommendation accepted after reviewer validation of ${trigger} evidence and policy citations.`,
      `Claim is clinically and administratively supportable; settlement aligns with policy benefits.`,
      `No additional exclusion or compliance issue identified during human review.`,
      `Reviewed claim documentation, member eligibility, and payable amount; AI decision remains appropriate.`,
    ];
  }
  if (decision === "OVERRIDE_AMOUNT") {
    return [
      `Settlement adjusted after reviewer validation of eligible billed services and policy limits.`,
      `Override reflects corrected payable amount based on covered services and member responsibility.`,
      `AI amount adjusted to align with documented benefit rules and claim evidence.`,
      `Reviewer recalculated settlement using submitted evidence and approved only the eligible portion.`,
    ];
  }
  if (decision === "DENY_CLAIM") {
    return [
      `Claim denied because submitted evidence does not satisfy applicable policy coverage requirements.`,
      `Denial upheld after review of exclusions, clinical documentation, and adjudication rationale.`,
      `Insufficient covered benefit support for payment under the active policy terms.`,
      `Documentation and policy checks do not support a payable benefit for this submission.`,
    ];
  }
  if (decision === "ESCALATE") {
    return [
      `Escalated for senior review due to ${trigger} and unresolved adjudication risk.`,
      `Additional clinical or compliance review is required before final decision.`,
      `Reviewer escalation requested due to ambiguous policy interpretation or high-value exposure.`,
      `Decision requires a senior adjudicator because available evidence does not support a defensible outcome.`,
    ];
  }
  if (decision === "REQUEST_INFO") {
    return [
      `Additional documentation is required to validate coverage and payable amount.`,
      `Requesting more information from provider/member before final adjudication.`,
      `Claim evidence is incomplete for a defensible payment or denial decision.`,
      `Pending missing documents needed to confirm eligibility, service details, and final settlement amount.`,
    ];
  }
  return [];
}

export function HITLDecisionForm({
  item,
  canDecide,
  roleLoaded,
  onSuccess,
  onClose,
  onOptimisticSubmit,
  shortcutDecision,
}: HITLDecisionFormProps) {
  const [decision, setDecision] = useState<DecisionOrReVerify | "">("");
  const [overrideAmount, setOverrideAmount] = useState("");
  const [justification, setJustification] = useState("");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDeny, setIsConfirmingDeny] = useState(false);
  const submittedRef = useRef<boolean>(false);

  const REVIEWER_NOTES_MAX = 500;

  const isReVerify = decision === RE_VERIFY_KEY;
  const justificationSuggestions = buildJustificationSuggestions(item, decision);

  // H4: Override amount validation
  const overrideAmountNum = parseFloat(overrideAmount);
  const overrideAmountError =
    decision === "OVERRIDE_AMOUNT" && overrideAmount
      ? overrideAmountNum <= 0
        ? "Amount must be greater than 0"
        : overrideAmountNum > Number(item.total_billed)
        ? `Amount cannot exceed total billed (${item.currency ?? ""} ${Number(item.total_billed).toLocaleString()})`
        : null
      : null;

  // Re-verify is always valid once selected (no justification needed)
  const valid = isReVerify
    ? true
    : decision !== "" &&
      justification.length >= 10 &&
      (decision !== "OVERRIDE_AMOUNT" || (overrideAmount && !overrideAmountError));

  // If user changes decision, exit confirmation mode
  useEffect(() => {
    if (decision !== "DENY_CLAIM") {
      setIsConfirmingDeny(false);
    }
  }, [decision]);

  useEffect(() => {
    setDecision("");
    setOverrideAmount("");
    setJustification("");
    setReviewerNotes("");
    setError(null);
    setLoading(false);
    setIsConfirmingDeny(false);
    submittedRef.current = false;
  }, [item.claim_reference]);

  useEffect(() => {
    if (!shortcutDecision || !canDecide) return;
    setDecision(shortcutDecision.decision);
    setIsConfirmingDeny(false);
  }, [canDecide, shortcutDecision]);

  async function handleSubmit() {
    if (!valid || !decision) return;
    if (submittedRef.current) return;
    setLoading(true);
    setError(null);

    const performSubmit = async () => {
      if (isReVerify) {
        // Re-run the full AI pipeline — claim stays HITL_PENDING for final human decision
        await reAdjudicateClaim(item.claim_reference);
        toast.success(
          `Re-adjudication complete — ${item.claim_reference}`,
          { description: "AI has re-verified the claim with updated policy citations" }
        );
        submittedRef.current = true;
        return;
      }
      const idempotencyKey = `hitl-${item.claim_reference}-${decision}`;
      await submitHITLDecision(
        item.claim_reference,
        {
          decision: decision as HITLDecision,
          override_amount:
            decision === "OVERRIDE_AMOUNT" ? overrideAmount : undefined,
          justification,
          ...(reviewerNotes.trim() ? { reviewer_notes: reviewerNotes.trim() } : {}),
        } as HITLDecisionCreate,
        idempotencyKey,
      );
      toast.success(
        `Decision recorded — ${item.claim_reference}`,
        { description: HITL_DECISION_LABELS[decision] }
      );
      submittedRef.current = true;
    };

    if (onOptimisticSubmit) {
      onOptimisticSubmit(item.claim_reference, async () => {
        try {
          await performSubmit();
          onSuccess();
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.detail : "Submission failed. Please try again."
          );
          throw err;
        } finally {
          setLoading(false);
        }
      });
      return;
    }

    try {
      await performSubmit();
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Submission failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmitClick() {
    if (!valid || !decision) return;

    // If decision is DENY and we are not already in confirmation mode, enter it.
    if (decision === "DENY_CLAIM" && !isConfirmingDeny) {
      setIsConfirmingDeny(true);
      return;
    }

    // Otherwise, proceed with submission.
    handleSubmit();
  }

  if (!roleLoaded) {
    return (
      <div className="space-y-4 p-4 animate-pulse">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="h-10 w-full rounded-lg bg-white/10" />
        <div className="h-10 w-full rounded-lg bg-white/10" />
        <div className="h-10 w-3/4 rounded-lg bg-white/10" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Claim summary */}
      <div className="overflow-hidden rounded-[1.35rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] shadow-[0_14px_40px_rgba(0,0,0,0.22)]">
        {/* Ref + badges row */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div>
            <p className="font-mono text-xs font-bold text-white">{item.claim_reference}</p>
            <p className="mt-0.5 text-[11px] text-white/45">
              {item.patient_name} · {item.claim_type}
              {item.market_region && <> · <span className="font-medium text-white/7 0">{item.market_region}</span></>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {/* Priority badge */}
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              item.priority === 1
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                : item.priority === 2
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
            )}>
              {item.priority === 1 ? "⚡ CRITICAL" : item.priority === 2 ? "▲ HIGH" : "● NORMAL"}
            </span>
            {item.hitl_sla_hours && (
              <span className="text-[10px] font-semibold text-white/35">
                SLA {item.hitl_sla_hours}h
              </span>
            )}
          </div>
        </div>
        {item.hitl_priority_reason && (
          <div className="border-t border-white/8 px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/35">Priority Reason</p>
            <p className="mt-1 text-[12px] leading-5 text-white/62">{item.hitl_priority_reason}</p>
          </div>
        )}
        {/* Money row */}
        <div className="grid grid-cols-2 gap-px border-t border-white/8 bg-white/8">
          <div className="bg-black/12 px-4 py-3">
            <p className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-white/35">Total Billed</p>
            <p className="text-base font-bold tabular-nums text-white">{item.currency ?? ""} {Number(item.total_billed).toLocaleString()}</p>
          </div>
          <div className="border-l border-white/8 bg-black/12 px-4 py-3">
            <p className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-white/35">
              <Activity className="h-2.5 w-2.5" /> AI Settlement
            </p>
            <p className="text-base font-bold tabular-nums text-cyan-700">{item.currency ?? ""} {Number(item.ai_settlement_amount).toLocaleString()}</p>
          </div>
        </div>
        {/* Confidence + SLA row */}
        <div className="grid grid-cols-2 gap-px border-t border-white/8 bg-white/8">
          <div className="flex items-center gap-1.5 bg-black/12 px-4 py-2.5">
            <TrendingUp className="h-3 w-3 shrink-0 text-white/35" />
            <span className="text-[10px] text-white/35">Confidence:</span>
            <span className={cn(
              "text-[10px] font-bold tabular-nums",
              Number(item.ai_confidence) >= 0.95
                ? "text-emerald-600 dark:text-emerald-400"
                : Number(item.ai_confidence) >= 0.80
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400"
            )}>
              {(Number(item.ai_confidence) * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-white/8 bg-black/12 px-4 py-2.5">
            <Clock className="h-3 w-3 shrink-0 text-white/35" />
            <span className="truncate text-[10px] text-white/35">
              {new Date(item.sla_deadline) < new Date()
                ? <span className="text-red-500 dark:text-red-400 font-semibold">⚠ Overdue</span>
                : <span className="text-white/55">{new Date(item.sla_deadline).toLocaleDateString()}</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Decision radio group — card style */}
      <div className={cn("space-y-2", !canDecide && "opacity-40 pointer-events-none select-none")}>
        <Label className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">Decision</Label>
        <RadioGroup
          value={decision}
          onValueChange={(v) => setDecision(v as DecisionOrReVerify)}
          className="grid grid-cols-1 gap-2"
          disabled={!canDecide}
        >
          {DECISIONS.map((d) => {
            const isSelected = decision === d;
            const isDeny = d === "DENY_CLAIM";
            const isApprove = d === "APPROVE_AI";
            const isAmber = d === "OVERRIDE_AMOUNT" || d === "ESCALATE" || d === "REQUEST_INFO";
            return (
              <div
                key={d}
                onClick={() => canDecide && setDecision(d as HITLDecision)}
                className={cn(
                  "flex items-center gap-3 rounded-[1rem] border px-4 py-3 transition-all",
                  canDecide ? "cursor-pointer" : "cursor-not-allowed",
                  isSelected
                    ? isDeny
                      ? "border-red-400 bg-red-950/20"
                      : isApprove
                      ? "border-emerald-400 bg-emerald-950/20"
                      : isAmber
                      ? "border-amber-400 bg-amber-950/20"
                      : "border-cyan-300/30 bg-cyan-300/8"
                    : "border-white/10 bg-white/[0.02] hover:border-white/18 hover:bg-white/[0.04]"
                )}
              >
                <RadioGroupItem value={d} id={d} className="shrink-0" disabled={!canDecide} />
                <Label
                  htmlFor={d}
                  className={cn(
                    "flex-1 text-sm font-semibold tracking-[0.08em] uppercase",
                    canDecide ? "cursor-pointer" : "cursor-not-allowed",
                    !isSelected && "text-white/52",
                    isSelected && isDeny && "text-red-600",
                    isSelected && isApprove && "text-emerald-600",
                    isSelected && isAmber && "text-amber-600"
                  )}
                >
                  {HITL_DECISION_LABELS[d]}
                </Label>
              </div>
            );
          })}

          {/* ── Re-verify with AI — pipeline re-run, not a final HITL decision ── */}
          <div
            onClick={() => canDecide && setDecision(RE_VERIFY_KEY)}
            className={cn(
              "flex items-start gap-3 rounded-[1rem] border px-4 py-3 transition-all",
              canDecide ? "cursor-pointer" : "cursor-not-allowed",
              isReVerify
                ? "border-cyan-400 bg-cyan-950/20"
                : "border-dashed border-white/10 bg-white/[0.015] hover:border-cyan-400/60 hover:bg-cyan-950/10"
            )}
          >
            <RadioGroupItem
              value={RE_VERIFY_KEY}
              id={RE_VERIFY_KEY}
              className="shrink-0 mt-0.5"
              disabled={!canDecide}
            />
            <Label
              htmlFor={RE_VERIFY_KEY}
              className={cn(
                "flex-1 cursor-pointer text-sm font-semibold tracking-[0.08em] uppercase",
                canDecide ? "cursor-pointer" : "cursor-not-allowed",
                !isReVerify && "text-white/52",
                isReVerify && "text-cyan-600"
              )}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className={cn("h-3.5 w-3.5 shrink-0", isReVerify ? "text-cyan-600" : "text-white/35")} />
                {HITL_DECISION_LABELS[RE_VERIFY_KEY]}
              </span>
              <span className="mt-1 block text-[10px] font-medium normal-case tracking-[0.08em] text-white/32 leading-snug">
                Re-run AI pipeline with current policy library — refreshes citations &amp; settlement.
                Claim stays in the review queue for your final decision.
              </span>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Override amount field */}
      {decision === "OVERRIDE_AMOUNT" && (
        <div className="space-y-2">
          <Label className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">Override Amount ({item.currency ?? "INR"})</Label>
          <Input
            type="number"
            min={0.01}
            max={Number(item.total_billed)}
            value={overrideAmount}
            onChange={(e) => setOverrideAmount(e.target.value)}
            placeholder={`0.01 – ${Number(item.total_billed).toLocaleString()}`}
            className={`h-11 rounded-[1rem] border-white/10 bg-white/[0.03] text-sm text-white ${overrideAmountError ? "border-red-500" : ""}`}
            disabled={!canDecide}
          />
          {overrideAmountError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {overrideAmountError}
            </p>
          )}
        </div>
      )}

      {/* Justification — hidden for Re-verify (no human decision text needed) */}
      {!isReVerify && (
        <div className={cn("space-y-2", !canDecide && "opacity-40")}>
          <Label className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">
            Justification{" "}
            <span className="text-white/25">(min 10 chars)</span>
          </Label>
          <Textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Enter clinical or administrative justification…"
            rows={4}
            className="min-h-[124px] resize-none rounded-[1rem] border-white/10 bg-white/[0.03] text-sm text-white"
            disabled={!canDecide}
          />
          {justificationSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {justificationSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setJustification(suggestion)}
                  className="rounded-xl border border-cyan-300/16 bg-cyan-300/8 px-3 py-2 text-left text-[11px] font-semibold leading-5 text-cyan-700 transition hover:border-cyan-300/30 hover:bg-cyan-300/12"
                  disabled={!canDecide}
                  title="Use this justification"
                >
                  {suggestion.length > 64 ? suggestion.slice(0, 61) + "..." : suggestion}
                </button>
              ))}
            </div>
          )}
          <p className="text-right text-xs text-white/32">
            {justification.length} / 10+ chars
          </p>
        </div>
      )}

      {/* Reviewer Notes — optional, max 500 chars */}
      {!isReVerify && (
        <div className={cn("space-y-2", !canDecide && "opacity-40")}>
          <Label className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">
            Reviewer Notes{" "}
            <span className="text-white/25">(optional)</span>
          </Label>
          <Textarea
            value={reviewerNotes}
            onChange={(e) => setReviewerNotes(e.target.value.slice(0, REVIEWER_NOTES_MAX))}
            placeholder="Document your reasoning for this decision..."
            rows={3}
            maxLength={REVIEWER_NOTES_MAX}
            className="min-h-[88px] resize-none rounded-[1rem] border-white/10 bg-white/[0.03] text-sm text-white"
            disabled={!canDecide}
          />
          <p className={cn(
            "text-right text-xs",
            reviewerNotes.length >= REVIEWER_NOTES_MAX ? "text-amber-400" : "text-white/32"
          )}>
            {reviewerNotes.length} / {REVIEWER_NOTES_MAX}
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="sticky bottom-0 z-10 flex gap-3 rounded-[1.1rem] border border-white/8 bg-[#171922]/90 px-1 pt-2 backdrop-blur-xl">
        <Button variant="outline" onClick={onClose} className="h-11 flex-1 rounded-[1rem] border-white/10 bg-white/[0.03] text-white/78 hover:bg-white/[0.06]">
          {canDecide ? "Cancel" : "Close"}
        </Button>
        {canDecide && (
          <Button
            disabled={!valid || loading}
            onClick={handleSubmitClick}
            variant={decision === "DENY_CLAIM" ? "destructive" : "default"}
            className={cn(
              "h-11 flex-1 gap-1.5 rounded-[1rem]",
              isReVerify && "bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-700 dark:hover:bg-cyan-600",
              isConfirmingDeny && "bg-red-700 hover:bg-red-800 ring-2 ring-red-300 ring-offset-2 ring-offset-[#171922]"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isReVerify ? (
              <Sparkles className="h-4 w-4" />
            ) : null}
            {isConfirmingDeny ? "Confirm Denial" : isReVerify ? "Re-verify with AI" : "Submit Decision"}
          </Button>
        )}
      </div>
    </div>
  );
}
