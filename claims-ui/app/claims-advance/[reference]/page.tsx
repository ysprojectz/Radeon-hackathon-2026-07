"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileUp,
  IndianRupee,
  Loader2,
  ShieldCheck,
  XCircle,
  AlertCircle,
  ExternalLink,
  Activity,
  AlertTriangle,
  Send,
} from "lucide-react";
import { getAdvanceClaim, submitAdvancePreauthDecision } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { GraphTrace } from "@/components/india/GraphTrace";
import { fetchCurrentUser, type StoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AdvanceClaimResponse, AdvancePreauthDecisionCreate } from "@/lib/types";
import { toast } from "sonner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function currency(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return `INR ${Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function statusTone(status: string) {
  if (["APPROVED", "APPROVED_PARTIAL", "AUTO_APPROVED"].includes(status))
    return "border-[var(--status-success)]/25 bg-[var(--status-success)]/10 text-[var(--status-success)]";
  if (["PENDING_HITL", "PENDING_REVIEW", "HITL_PENDING", "REQUEST_INFO", "INFO_REQUESTED"].includes(status))
    return "border-[var(--status-warning)]/25 bg-[var(--status-warning)]/10 text-[var(--status-warning)]";
  if (["DENIED", "REJECTED"].includes(status))
    return "border-[var(--status-danger)]/25 bg-[var(--status-danger)]/10 text-[var(--status-danger)]";
  return "border-[var(--border-subtle)] bg-[var(--acos-surface-strong)] text-text-secondary";
}

function StatusIcon({ status }: { status: string }) {
  if (["APPROVED", "APPROVED_PARTIAL", "AUTO_APPROVED"].includes(status))
    return <CheckCircle2 className="h-5 w-5 text-[var(--status-success)]" />;
  if (["DENIED", "REJECTED"].includes(status))
    return <XCircle className="h-5 w-5 text-[var(--status-danger)]" />;
  return <Clock className="h-5 w-5 text-[var(--status-warning)]" />;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[var(--border-subtle)] last:border-0">
      <span className="text-xs font-semibold uppercase tracking-widest text-text-muted shrink-0">
        {label}
      </span>
      <span className="text-sm font-semibold text-text-primary text-right">{value}</span>
    </div>
  );
}

function advanceDocumentHref(url: string) {
  if (url.startsWith("/api/v1/proxy/")) return url;
  if (url.startsWith("/api/v1/")) return url.replace("/api/v1/", "/api/v1/proxy/");
  return url;
}

function canDecidePreauth(user: StoredUser | null) {
  return user ? ["ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"].includes(user.role) : false;
}

function AbhaStatusSection({
  abhaAddress,
  consentVerified,
}: {
  abhaAddress: string | null | undefined;
  consentVerified: boolean | null | undefined;
}) {
  if (!abhaAddress && consentVerified == null) return null;

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="ui-eyebrow text-text-muted">ABDM</p>
          <h2 className="text-sm font-bold text-text-primary">ABHA Status</h2>
        </div>
      </div>
      <div>
        <MetaRow label="ABHA Address" value={abhaAddress || "Not captured"} />
        <MetaRow
          label="Consent Status"
          value={consentVerified == null ? "Not available" : consentVerified ? "Verified" : "Pending"}
        />
      </div>
    </section>
  );
}

// ── IRDAI Compliance Section ──────────────────────────────────────────────────

function IrdaiComplianceSection({ violations }: { violations: string | string[] | null | undefined }) {
  const violationList: string[] = (() => {
    if (!violations) return [];
    if (Array.isArray(violations)) return violations;
    try {
      const parsed = JSON.parse(violations as string);
      return Array.isArray(parsed) ? parsed : [String(violations)];
    } catch {
      return [String(violations)];
    }
  })();

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            violationList.length > 0
              ? "border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
              : "border-[var(--status-success)]/20 bg-[var(--status-success)]/10 text-[var(--status-success)]"
          )}
        >
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div>
          <p className="ui-eyebrow text-text-muted">Compliance</p>
          <h2 className="text-sm font-bold text-text-primary">IRDAI Compliance</h2>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase",
            violationList.length > 0
              ? "border-[var(--status-danger)]/25 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
              : "border-[var(--status-success)]/25 bg-[var(--status-success)]/10 text-[var(--status-success)]"
          )}
        >
          {violationList.length > 0 ? `${violationList.length} Violation${violationList.length > 1 ? "s" : ""}` : "Pass"}
        </span>
      </div>

      {violationList.length > 0 ? (
        <ul className="space-y-2">
          {violationList.map((v, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-xl border border-[var(--status-danger)]/15 bg-[var(--status-danger)]/8 px-3 py-2.5"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-danger)]" />
              <span className="text-xs font-medium text-[var(--status-danger)]">{v}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">All IRDAI mandate clauses satisfied.</p>
      )}
    </section>
  );
}

// ── FWA Score Display ─────────────────────────────────────────────────────────

function FwaScoreDisplay({ score }: { score: string | number | null | undefined }) {
  if (score == null) return null;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;

  const pct = Math.round(numeric * 100);
  const isHigh = numeric > 0.5;

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            isHigh
              ? "border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
              : "border-[var(--status-warning)]/20 bg-[var(--status-warning)]/10 text-[var(--status-warning)]"
          )}
        >
          <Activity className="h-4 w-4" />
        </span>
        <div>
          <p className="ui-eyebrow text-text-muted">Fraud Detection</p>
          <h2 className="text-sm font-bold text-text-primary">FWA Anomaly Score</h2>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase",
            isHigh
              ? "border-[var(--status-danger)]/25 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
              : "border-[var(--status-warning)]/25 bg-[var(--status-warning)]/10 text-[var(--status-warning)]"
          )}
        >
          {isHigh ? "Anomaly" : "Normal"}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Anomaly Score</span>
          <span className={cn("font-mono font-bold", isHigh ? "text-[var(--status-danger)]" : "text-[var(--status-warning)]")}> 
            {numeric.toFixed(4)}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--acos-surface-strong)]">
          <div
            className={cn("h-full rounded-full transition-all", isHigh ? "bg-[var(--status-danger)]" : "bg-[var(--status-warning)]")}
            style={{ width: `${Math.min(pct, 100)}%` }}
            role="progressbar"
            aria-label="FWA anomaly score bar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <p className="text-xs text-text-muted">
          {isHigh
            ? "High anomaly score — routed to manual review."
            : "Score within normal range."}
        </p>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdvanceClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const reference = params.reference as string;

  const [claim, setClaim] = useState<AdvanceClaimResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<AdvancePreauthDecisionCreate["decision"]>("APPROVE");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [partialAmount, setPartialAmount] = useState("");
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const loadClaim = useCallback(async (targetReference: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdvanceClaim(targetReference);
      setClaim(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load record");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!reference) return;
    void loadClaim(reference);
  }, [loadClaim, reference]);

  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  async function handleDecisionSubmit() {
    if (!claim) return;

    const notes = decisionNotes.trim();
    const reviewer = reviewerNotes.trim();
    if (notes.length < 10) {
      setDecisionError("Decision notes must be at least 10 characters.");
      return;
    }

    if (decision === "APPROVE_PARTIAL") {
      const amount = Number(partialAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setDecisionError("Enter a valid approved amount for partial approval.");
        return;
      }
    }

    setDecisionLoading(true);
    setDecisionError(null);
    try {
      await submitAdvancePreauthDecision(claim.claim_reference, {
        decision,
        notes,
        ...(reviewer ? { reviewer_notes: reviewer } : {}),
        ...(decision === "APPROVE_PARTIAL" ? { estimated_plan_payment: partialAmount } : {}),
      });
      toast.success(`Pre-auth decision recorded for ${claim.claim_reference}`);
      setDecisionNotes("");
      setReviewerNotes("");
      setPartialAmount("");
      await loadClaim(claim.claim_reference);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit decision";
      setDecisionError(message);
      toast.error(message);
    } finally {
      setDecisionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading pre-authorization…</span>
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div className="acos-page">
        <PageHeader title="Pre Auth Claim Detail" />
        <div className="glass-card flex items-center gap-3 border-[var(--status-danger)]/20 bg-[var(--status-danger)]/8 p-5">
          <AlertCircle className="h-5 w-5 shrink-0 text-[var(--status-danger)]" />
          <p className="text-sm font-medium text-[var(--status-danger)]">
            {error ?? "Record not found."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/claims-advance")}
          className="ui-button-secondary inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pre Auth Claim
        </button>
      </div>
    );
  }

  const estimatedTotal =
    claim.estimated_plan_payment ??
    claim.estimated_coverage ??
    0;

  return (
    <div className="acos-page">
      {/* Header */}
      <PageHeader
        title="Pre Auth Claim Detail"
        actions={
          <button
            type="button"
            onClick={() => router.push("/claims-advance")}
            className="ui-button-secondary inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            All Pre Auth Claims
          </button>
        }
      />

      {/* Hero card */}
      <section className="glass-card overflow-hidden p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="ui-eyebrow text-brand-primary/70">Pre Auth Claim</p>
            <h1 className="text-2xl font-black tracking-normal text-text-primary sm:text-3xl">
              {claim.claim_reference}
            </h1>
            <p className="font-mono text-sm text-text-muted">{claim.preauth_reference}</p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            {/* Status badge */}
            <div className="flex items-center gap-2">
              <StatusIcon status={claim.preauth_status} />
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider",
                  statusTone(claim.preauth_status)
                )}
              >
                {claim.preauth_status.replace(/_/g, " ")}
              </span>
            </div>

            {/* Estimated plan payment */}
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                Estimated Plan Payment
              </p>
              <p className="font-mono text-xl font-black text-brand-primary">
                {currency(estimatedTotal)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main grid */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Left — details */}
        <div className="space-y-5">
          {/* Financial breakdown */}
          <section className="glass-card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                <IndianRupee className="h-4 w-4" />
              </span>
              <div>
                <p className="ui-eyebrow text-text-muted">Financial</p>
                <h2 className="text-sm font-bold text-text-primary">Coverage Estimate</h2>
              </div>
            </div>
            <div>
              <MetaRow label="Estimated Coverage" value={currency(claim.estimated_coverage)} />
              <MetaRow label="Plan Payment" value={currency(claim.estimated_plan_payment)} />
              <MetaRow label="Member Responsibility" value={currency(claim.estimated_member_responsibility)} />
              <MetaRow label="Deductible Applied" value={currency(claim.estimated_deductible_applied)} />
              <MetaRow label="Copay" value={currency(claim.estimated_copay)} />
              {claim.confidence_score != null && (
                <MetaRow
                  label="Confidence"
                  value={
                    <span className="font-mono">
                      {(Number(claim.confidence_score) * 100).toFixed(1)}%
                    </span>
                  }
                />
              )}
            </div>
          </section>

          {/* Dates & status */}
          <section className="glass-card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] text-text-secondary">
                <Calendar className="h-4 w-4" />
              </span>
              <div>
                <p className="ui-eyebrow text-text-muted">Timeline</p>
                <h2 className="text-sm font-bold text-text-primary">Dates & Decisions</h2>
              </div>
            </div>
            <div>
              <MetaRow
                label="Registered"
                value={new Date(claim.date_created).toLocaleString()}
              />
              {claim.date_decision && (
                <MetaRow
                  label="Decision Date"
                  value={new Date(claim.date_decision).toLocaleString()}
                />
              )}
              {claim.hitl_deadline && (
                <MetaRow
                  label="Review Due"
                  value={
                    <span className="text-[var(--status-warning)]">
                      {new Date(claim.hitl_deadline).toLocaleString()}
                    </span>
                  }
                />
              )}
              <MetaRow
                label="Coverage Decision"
                value={
                  <span className={cn("font-semibold", statusTone(claim.coverage_decision))}>
                    {claim.coverage_decision.replace(/_/g, " ")}
                  </span>
                }
              />
              <MetaRow
                label="Manual Review Required"
                value={claim.needs_hntl ? "Yes" : "No"}
              />
            </div>
          </section>

          <AbhaStatusSection
            abhaAddress={claim.abha_address}
            consentVerified={claim.consent_verified}
          />

          {/* IRDAI compliance section */}
          <IrdaiComplianceSection violations={claim.irdai_violations} />

          {/* FWA anomaly score */}
          <FwaScoreDisplay score={claim.fwa_anomaly_score} />

          {/* Pre-auth letter link */}
          {claim.preauth_letter_url && (
            <section className="glass-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--status-success)]/20 bg-[var(--status-success)]/10 text-[var(--status-success)]">
                  <FileCheck2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="ui-eyebrow text-text-muted">Document</p>
                  <h2 className="text-sm font-bold text-text-primary">Pre Auth Letter</h2>
                </div>
              </div>
              <a
                href={advanceDocumentHref(claim.preauth_letter_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--status-success)]/20 bg-[var(--status-success)]/10 px-4 py-2.5 text-sm font-semibold text-[var(--status-success)] transition-colors hover:bg-[var(--status-success)]/18"
              >
                <ExternalLink className="h-4 w-4" />
                Open Pre Auth Letter
              </a>
            </section>
          )}

          {claim.supporting_docs && claim.supporting_docs.length > 0 && (
            <section className="glass-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                  <FileUp className="h-4 w-4" />
                </span>
                <div>
                  <p className="ui-eyebrow text-brand-primary/70">Pre Auth Claim</p>
                  <h2 className="text-sm font-bold text-text-primary">Supporting Documents</h2>
                </div>
                <span className="ml-auto rounded-full border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-2.5 py-1 text-[10px] font-bold uppercase text-text-muted">
                  {claim.supporting_docs.length} file{claim.supporting_docs.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {claim.supporting_docs.map((url, index) => (
                  <a
                    key={`${url}-${index}`}
                    href={advanceDocumentHref(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-brand-primary/25 hover:bg-[var(--acos-surface-strong)]"
                  >
                    <span className="truncate font-mono text-xs">
                      Document {index + 1}
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-brand-primary" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Graph trace — event trail from graph service */}
          <section className="glass-card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="ui-eyebrow text-brand-primary/70">Pre Auth Claim</p>
                <h2 className="text-sm font-bold text-text-primary">Event Trail & Recommendation Notes</h2>
              </div>
            </div>
            <GraphTrace claimId={claim.id} />
          </section>
        </div>

        {/* Right sidebar — quick facts */}
        <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
          {/* References */}
          <section className="glass-card p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-text-muted">
              References
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Claim Reference
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-brand-primary">
                  {claim.claim_reference}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Pre Auth Reference
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-text-primary">
                  {claim.preauth_reference}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Record ID
                </p>
                <p className="mt-0.5 font-mono text-xs text-text-muted break-all">
                  {claim.id}
                </p>
              </div>
            </div>
          </section>

          {/* Status summary */}
          <section className="glass-card p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-text-muted">
              Status Summary
            </p>
            <div className="space-y-2">
              {[
                { label: "Pre Auth Status", value: claim.preauth_status },
                { label: "Coverage Decision", value: claim.coverage_decision },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-2.5"
                >
                  <span className="text-xs text-text-muted">{label}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                      statusTone(value)
                    )}
                  >
                    {value.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {canDecidePreauth(currentUser) && (
            <section className="glass-card p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-text-muted">
                Reviewer Decision
              </p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "APPROVE", label: "Approve" },
                    { value: "APPROVE_PARTIAL", label: "Approve Partial" },
                    { value: "REQUEST_INFO", label: "Request Info" },
                    { value: "REJECT", label: "Reject" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setDecision(option.value as AdvancePreauthDecisionCreate["decision"]);
                        setDecisionError(null);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
                        decision === option.value
                          ? "border-brand-primary/40 bg-brand-primary/15 text-brand-primary"
                          : "border-[var(--border-subtle)] bg-[var(--acos-surface)] text-text-secondary hover:border-[var(--border-strong)] hover:text-text-primary"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {decision === "APPROVE_PARTIAL" && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    placeholder="Approved plan payment"
                    className="h-10 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--acos-surface)] px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-primary/50"
                  />
                )}

                <textarea
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Decision notes"
                  rows={4}
                  className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--acos-surface)] px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-primary/50"
                />

                <textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Reviewer notes (optional)"
                  rows={3}
                  className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--acos-surface)] px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-primary/50"
                />

                {decisionError && (
                  <div className="rounded-xl border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/8 px-3 py-2 text-xs font-medium text-[var(--status-danger)]">
                    {decisionError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDecisionSubmit}
                  disabled={decisionLoading || !claim.needs_hntl}
                  className="ui-button-primary inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
                >
                  {decisionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {claim.needs_hntl ? "Submit Decision" : "Decision Closed"}
                </button>
              </div>
            </section>
          )}

          {/* Quick actions */}
          <section className="glass-card p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-text-muted">
              Actions
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => router.push("/claims-advance")}
                className="ui-button-secondary w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                Back to All Pre Auth Claims
              </button>
              <button
                type="button"
                onClick={() => router.push("/submit")}
                className="ui-button-secondary w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                Submit New Claim
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
