"use client";
import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ChevronDown, ChevronUp, Bot, CheckCircle2, XCircle,
  AlertTriangle, HelpCircle, TrendingUp, Zap, ShieldAlert,
  Brain, Info, BookOpen,
} from "lucide-react";
import { HITLDecisionForm } from "./HITLDecisionForm";
import { SLACountdown } from "./SLACountdown";
import type { HITLQueueItem, AgentLineComparison, HITLAICitation, HITLPolicyCitation, HITLRegulatoryViolation, HITLDecision } from "@/lib/types";
import { fetchCurrentUser } from "@/lib/auth";

// Roles that can submit HITL decisions — must match backend HITL_ROLES
const HITL_DECISION_ROLES = new Set(["ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"]);

interface HITLDecisionPanelProps {
  item: HITLQueueItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onOptimisticSubmit?: (claimRef: string, action: () => Promise<void>) => void;
  shortcutDecision?: { decision: HITLDecision; nonce: number } | null;
}

// ── Verdict Chip ─────────────────────────────────────────────────────────────

function VerdictChip({ verdict }: { verdict: string }) {
  if (verdict === "COVERED")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md border border-emerald-300/20 bg-emerald-300/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
        <CheckCircle2 className="h-2.5 w-2.5" /> COVERED
      </span>
    );
  if (verdict === "EXCLUDED")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md border border-red-300/20 bg-red-300/12 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
        <XCircle className="h-2.5 w-2.5" /> EXCLUDED
      </span>
    );
  if (verdict === "CONDITIONAL")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-300/20 bg-amber-300/12 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
        <AlertTriangle className="h-2.5 w-2.5" /> CONDITIONAL
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-white/60">
      <HelpCircle className="h-2.5 w-2.5" /> AMBIGUOUS
    </span>
  );
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 98 ? "#22c55e" : pct >= 80 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
      <svg width="40" height="40" className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-white/10" />
        <circle
          cx="20" cy="20" r={r} fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-[10px] font-bold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

const DENIAL_REASON_LABELS: Record<string, string> = {
  "EL-001": "member eligibility did not pass",
  "PA-001": "required pre-authorization was missing or invalid",
  "EX-001": "the procedure or diagnosis matched a policy exclusion",
  "WP-001": "the claim appears to fall inside a waiting period",
  "AY-001": "AYUSH coverage requirements were not satisfied",
};

function extractLegacyReasonValue(reason: string | null | undefined, key: "denial_code" | "confidence") {
  if (!reason) return undefined;
  const match = reason.match(new RegExp(`${key}=([^),]+)`));
  const raw = match?.[1]?.replace(/^['"]|['"]$/g, "").trim();
  if (!raw || raw === "None" || raw === "null" || raw === "?") return undefined;
  return raw;
}

function buildReadableDisagreement(c: AgentLineComparison) {
  const existing = c.disagreement_reason?.trim();
  if (existing && !existing.startsWith("Rules:")) return existing;

  const denialCode = extractLegacyReasonValue(existing, "denial_code");
  const confidence = extractLegacyReasonValue(existing, "confidence");
  const confidenceText = confidence ? ` Confidence reported by the policy review: ${confidence}.` : "";

  const rulesText = c.rules_verdict === "COVERED"
    ? "Rules check marked this line as covered because no denial rule blocked payment."
    : denialCode
    ? `Rules check denied this line under ${denialCode}: ${DENIAL_REASON_LABELS[denialCode] ?? "a coverage rule failed"}.`
    : "Rules check denied this line because a coverage rule failed.";

  const llmText =
    c.llm_verdict === "COVERED"
      ? `Policy review found clause evidence supporting coverage for this line.${confidenceText}`
      : c.llm_verdict === "EXCLUDED"
      ? `Policy review found clause evidence that appears to exclude this line.${confidenceText}`
      : c.llm_verdict === "CONDITIONAL"
      ? `Policy review found this line may be payable only if policy conditions are satisfied, such as authorization, documentation, network, limit, or eligibility requirements.${confidenceText}`
      : `Policy review could not clearly confirm whether this line is covered or excluded from the available clause evidence.${confidenceText}`;

  let impactText = "Manual review should reconcile the two agent results before settlement.";
  if (c.rules_verdict === "COVERED" && c.llm_verdict === "EXCLUDED") {
    impactText = "Manual review is required because the rules path would pay the line, while the policy-language analysis suggests it may be excluded.";
  } else if (c.rules_verdict === "COVERED" && c.llm_verdict === "CONDITIONAL") {
    impactText = "Manual review should confirm the policy condition before payment.";
  } else if (c.rules_verdict === "COVERED" && c.llm_verdict === "AMBIGUOUS") {
    impactText = "Manual review should confirm the applicable policy clause before payment.";
  } else if (c.rules_verdict === "EXCLUDED" && c.llm_verdict === "COVERED") {
    impactText = "Manual review is required because the rules path would deny the line, while the policy-language analysis indicates it may be covered.";
  } else if (c.rules_verdict === "EXCLUDED" && c.llm_verdict === "CONDITIONAL") {
    impactText = "Manual review should decide whether the failed rule is final or whether missing evidence or an override could make the line payable.";
  } else if (c.rules_verdict === "EXCLUDED" && c.llm_verdict === "AMBIGUOUS") {
    impactText = "Manual review should validate the denial before finalizing it.";
  }

  return `${rulesText} ${llmText} ${impactText}`;
}

// ── Recommendation Confidence Panel ──────────────────────────────────────────

const TRIGGER_META: Record<string, {
  label: string;
  detail: string;
  factors: string[];
  icon: React.ReactNode;
  scheme: "red" | "amber" | "blue" | "purple";
}> = {
  AGENT_CONFLICT: {
    label: "Coverage Conflict Detected",
    detail: "Rules and policy review produced strongly conflicting verdicts. Confidence is suppressed until a reviewer resolves the conflict.",
    factors: [
      "Rules and policy review disagree on coverage for one or more line items",
      "Agreement score fell below the 80% conflict threshold",
      "Automatic settlement was blocked to prevent incorrect payment",
    ],
    icon: <XCircle className="h-4 w-4" />,
    scheme: "red",
  },
  AGENT_DISAGREEMENT: {
    label: "Coverage Review Mismatch",
    detail: "Coverage reviews partially disagree. Confidence reflects the uncertainty between the two verdicts.",
    factors: [
      "Partial mismatch between rules and policy review verdicts",
      "Agreement score between 80% and 97% — below the auto-settle threshold",
      "Human review required to confirm the correct interpretation",
    ],
    icon: <AlertTriangle className="h-4 w-4" />,
    scheme: "amber",
  },
  POLICY_AMBIGUITY: {
    label: "Policy Clause Ambiguity",
    detail: "Policy review found one or more clauses that could be interpreted multiple ways. Confidence is reduced when policy language is ambiguous.",
    factors: [
      "Policy clause wording does not clearly cover or exclude the procedure",
      "Multiple conflicting clauses may apply to this claim type",
      "The claim requires reviewer interpretation of policy intent",
    ],
    icon: <HelpCircle className="h-4 w-4" />,
    scheme: "amber",
  },
  REGULATORY_VIOLATION: {
    label: "Regulatory Compliance Issue",
    detail: "A mandatory government or regulatory rule may have been violated. Regulatory compliance is required before settlement and directly lowers confidence.",
    factors: [
      "Tier 1 (government mandate) compliance check failed",
      "Regulatory requirements override standard policy analysis",
      "Legal review is mandatory — this cannot be auto-settled",
    ],
    icon: <ShieldAlert className="h-4 w-4" />,
    scheme: "red",
  },
  LOW_CONFIDENCE: {
    label: "Low Confidence",
    detail: "The overall confidence score fell below the 80% threshold. This indicates the review was uncertain about the correct coverage decision.",
    factors: [
      "Insufficient matching policy clauses found for the claim type",
      "Procedure code or diagnosis may be uncommon or uncategorised",
      "Incomplete claim data reduced the model's certainty",
    ],
    icon: <TrendingUp className="h-4 w-4" />,
    scheme: "amber",
  },
  MEDIUM_CONFIDENCE: {
    label: "Medium Confidence on High-Value Claim",
    detail: "Confidence is below 95% and the claim exceeds the high-value threshold. Extra verification is required due to financial risk.",
    factors: [
      "Confidence between 80% and 95%",
      "Claim value exceeds the high-value review threshold",
      "Financial risk warrants additional scrutiny before settlement",
    ],
    icon: <Info className="h-4 w-4" />,
    scheme: "blue",
  },
  HIGH_VALUE: {
    label: "High-Value Claim",
    detail: "All claims above the high-value threshold require mandatory review regardless of confidence, as a financial control measure.",
    factors: [
      "Claim total exceeds the high-value review threshold",
      "Mandatory review policy applies regardless of confidence",
      "Financial controls require human authorisation for large settlements",
    ],
    icon: <Info className="h-4 w-4" />,
    scheme: "blue",
  },
  INCOMPLETE_PROCESSING: {
    label: "Incomplete Processing",
    detail: "One or more processing components failed during claim adjudication. The system cannot auto-settle incomplete processing — human review is mandatory.",
    factors: [
      "Validation detected a component failure in rules, coverage review, policy references, or settlement",
      "Confidence score capped at 75% due to incomplete processing",
      "Auto-settlement blocked — this is a safety measure to prevent incorrect payment",
    ],
    icon: <XCircle className="h-4 w-4" />,
    scheme: "red",
  },
};

const SCHEME_STYLES = {
  red:    { wrap: "bg-red-50 border-red-200", icon: "text-red-600", title: "text-red-700", detail: "text-red-700/85", bullet: "bg-red-500" },
  amber:  { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-600", title: "text-amber-700", detail: "text-amber-700/85", bullet: "bg-amber-500" },
  blue:   { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-600", title: "text-blue-700", detail: "text-blue-700/85", bullet: "bg-blue-500" },
  purple: { wrap: "bg-fuchsia-50 border-fuchsia-200", icon: "text-fuchsia-600", title: "text-fuchsia-700", detail: "text-fuchsia-700/85", bullet: "bg-fuchsia-500" },
};

function AIReasoningPanel({ item }: { item: HITLQueueItem }) {
  const [expanded, setExpanded] = useState(true);
  const reason = item.trigger_reason;
  const confidencePct = Math.round(Number(item.ai_confidence) * 100);
  const meta = reason ? TRIGGER_META[reason] : null;

  const confColor =
    confidencePct >= 80 ? "#22c55e"
    : confidencePct >= 60 ? "#f59e0b"
    : "#ef4444";

  const confLabel =
    confidencePct >= 95 ? "HIGH"
    : confidencePct >= 80 ? "MODERATE"
    : confidencePct >= 60 ? "LOW"
    : "VERY LOW";

  return (
    <div className="mb-5 overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.018))] shadow-[0_10px_26px_rgba(0,0,0,0.2)]">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2.5">
          <Brain className="h-4 w-4 shrink-0 text-white/35" />
          <span className="text-sm font-bold text-white">Recommendation Confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ color: confColor, backgroundColor: `${confColor}18` }}
          >
            {confLabel} · {confidencePct}%
          </span>
          {expanded
            ? <ChevronUp className="h-4 w-4 shrink-0 text-white/35" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-white/35" />}
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-white/8 border-t border-white/8">
          {/* Confidence gauge */}
          <div className="bg-white/[0.025] px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/35">
              <span className="font-semibold uppercase tracking-wider">Overall Confidence</span>
              <span className="font-bold tabular-nums" style={{ color: confColor }}>{confidencePct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${confidencePct}%`, backgroundColor: confColor }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-white/22">
              <span>0% — No confidence</span>
              <span>80% — Auto approval target</span>
              <span>100%</span>
            </div>
          </div>

          {/* Trigger reason explanation */}
          {meta && (() => {
            const s = SCHEME_STYLES[meta.scheme];
            return (
              <div className={cn("mx-3 my-3 rounded-[1rem] border px-3.5 py-3", s.wrap)}>
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-0.5 shrink-0", s.icon)}>{meta.icon}</span>
                  <div className="min-w-0">
                    <p className={cn("text-[11px] font-bold uppercase tracking-wide mb-1", s.title)}>
                      Review reason: {meta.label}
                    </p>
                    <p className={cn("text-[11px] leading-snug mb-2.5", s.detail)}>
                      {meta.detail}
                    </p>
                    <div className="space-y-1">
                      <p className={cn("text-[9px] font-bold uppercase tracking-widest opacity-70", s.title)}>
                        Contributing Factors
                      </p>
                      {meta.factors.map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className={cn("mt-1.5 h-1 w-1 rounded-full shrink-0", s.bullet)} />
                          <p className={cn("text-[11px] leading-snug", s.detail)}>{f}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* No meta — unknown reason */}
          {!meta && reason && (
            <div className="px-4 py-3">
              <p className="text-[11px] text-white/45">
                Routed for review — reason: <span className="font-mono font-semibold text-white">{reason}</span>
              </p>
            </div>
          )}

          {/* Dual-agent score summary if available */}
          {item.agent_agreement_score != null && (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <span className="text-[11px] font-medium text-white/45">Review agreement</span>
              </div>
              <span
                className="text-[11px] font-bold tabular-nums"
                style={{
                  color: item.agent_agreement_score >= 0.98 ? "#22c55e"
                    : item.agent_agreement_score >= 0.80 ? "#f59e0b"
                    : "#ef4444",
                }}
              >
                {Math.round(item.agent_agreement_score * 100)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Coverage Comparison Panel ────────────────────────────────────────────────

function AgentComparisonPanel({ item }: { item: HITLQueueItem }) {
  const score = item.agent_agreement_score;
  const comparisons = item.agent_line_comparisons;
  const [expanded, setExpanded] = useState((score ?? 1) < 0.98);

  if (score === null || score === undefined || !comparisons || comparisons.length === 0) return null;

  const pct = Math.round(score * 100);

  const headerGradient =
    pct >= 98
      ? "from-emerald-50 to-emerald-50/30 dark:from-emerald-950/30 dark:to-transparent border-emerald-200/30 dark:border-emerald-800/30"
      : pct >= 80
      ? "from-amber-50 to-amber-50/30 dark:from-amber-950/30 dark:to-transparent border-amber-200/30 dark:border-amber-800/30"
      : "from-red-50 to-red-50/30 dark:from-red-950/30 dark:to-transparent border-red-200/30 dark:border-red-800/30";

  const statusLabel = pct >= 98 ? "VERIFIED" : pct >= 80 ? "PARTIAL MATCH" : "CONFLICT";
  const statusColor =
    pct >= 98
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20"
      : pct >= 80
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/20"
      : "bg-red-500/15 text-red-700 dark:text-red-400 ring-red-500/20";

  const disagreementCount = comparisons.filter((c: AgentLineComparison) => c.agreement < 1.0).length;

  return (
    <div className={cn("mb-5 overflow-hidden rounded-[1.25rem] border bg-gradient-to-br", headerGradient)}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-3">
          <ScoreRing score={score} />
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-white/35" />
              <span className="text-sm font-bold text-white">Coverage Cross-Check</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ring-1", statusColor)}>
                {statusLabel}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-white/45">
              {comparisons.length} line{comparisons.length !== 1 ? "s" : ""} compared
              {disagreementCount > 0 && (
                <span className="ml-1.5 font-medium text-red-600">
                  · {disagreementCount} disagreement{disagreementCount !== 1 ? "s" : ""}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pct < 98 && !expanded && (
            <span className="text-[10px] text-white/32">tap to review</span>
          )}
          {expanded
            ? <ChevronUp className="h-4 w-4 shrink-0 text-white/35" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-white/35" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/8 bg-black/12 backdrop-blur-sm">
          {/* Score progress bar */}
          <div className="px-4 pt-3 pb-1">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/35">
              <span className="font-medium">Agreement Score</span>
              <span className="font-bold tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: pct >= 98 ? "#22c55e" : pct >= 80 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[2fr_2fr_2fr_1fr] gap-2 border-b border-white/8 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-white/25">
            <span>Procedure</span>
            <span>Rules</span>
            <span>Policy Review</span>
            <span className="text-right">Match</span>
          </div>

          {/* Line rows */}
          <div className="divide-y divide-white/8">
            {comparisons.map((lc: AgentLineComparison) => {
              const agrPct = Math.round(lc.agreement * 100);
              const rowBg =
                agrPct === 100
                  ? ""
                  : agrPct >= 50
                  ? "bg-amber-300/[0.06]"
                  : "bg-red-300/[0.07]";
              const matchColor =
                agrPct === 100
                  ? "text-emerald-600 dark:text-emerald-400"
                  : agrPct >= 50
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400";

              return (
                <div
                  key={lc.line_number}
                  className={cn(
                    "grid grid-cols-[2fr_2fr_2fr_1fr] gap-2 items-center px-4 py-2.5 text-xs",
                    rowBg
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {agrPct < 100 && (
                      <span className={cn("shrink-0 h-1.5 w-1.5 rounded-full", agrPct >= 50 ? "bg-amber-400" : "bg-red-500")} />
                    )}
                    <div>
                      <span className="font-mono text-[11px] font-semibold">{lc.procedure_code}</span>
                      <span className="block text-[9px] text-white/28">#{lc.line_number}</span>
                    </div>
                  </div>
                  <VerdictChip verdict={lc.rules_verdict} />
                  <VerdictChip verdict={lc.llm_verdict} />
                  <span className={cn("text-right text-[11px] font-bold tabular-nums", matchColor)}>
                    {agrPct}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* Disagreement reasons */}
          {comparisons.some((c: AgentLineComparison) => c.disagreement_reason) && (
            <div className="space-y-1.5 border-t border-white/8 px-4 py-2.5">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/25">Review Details</p>
              {comparisons
                .filter((c: AgentLineComparison) => c.disagreement_reason)
                .map((c: AgentLineComparison) => (
                  <p key={c.line_number} className="border-l-2 border-red-300/30 pl-2 text-[11px] leading-snug text-white/55">
                    <span className="font-mono font-semibold text-white">{c.procedure_code}</span>: {buildReadableDisagreement(c)}
                  </p>
                ))}
            </div>
          )}

          {/* Footer legend */}
          <div className="flex items-center gap-3 border-t border-white/8 bg-white/[0.025] px-4 py-2">
            <Zap className="h-3 w-3 shrink-0 text-white/35" />
            <p className="text-[10px] leading-tight text-white/42">
              <span className="font-semibold text-white">Rules</span>: Deterministic coverage checks (R1-R11)
              <span className="mx-1.5 opacity-40">·</span>
              <span className="font-semibold text-white">Policy review</span>: Clause-based coverage analysis
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Coverage Review Flags Panel ──────────────────────────────────────────────

const FLAG_META: Record<string, { label: string; color: string }> = {
  POLICY_AMBIGUITY:          { label: "Policy Ambiguity",          color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" },
  REGULATORY_VIOLATION:      { label: "Regulatory Violation",      color: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700" },
  WAITING_PERIOD_ISSUE:      { label: "Waiting Period Issue",       color: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700" },
  EXCLUSION_APPLIED:         { label: "Exclusion Applied",          color: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700" },
  HIGH_VALUE:                { label: "High Value Claim",           color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700" },
  PRE_AUTH_MISSING:          { label: "Pre-Auth Missing",           color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" },
  NETWORK_TIER_PENALTY:      { label: "Network Tier Penalty",       color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700" },
  ROOM_RENT_CAP_APPLIED:     { label: "Room Rent Cap Applied",      color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700" },
  COORDINATION_OF_BENEFITS:  { label: "Coordination of Benefits",   color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700" },
  SUBLIMIT_APPLIED:          { label: "Sub-Limit Applied",          color: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700" },
  AGENT_CONFLICT:            { label: "Agent Conflict",             color: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700" },
};

function CoverageFlagsPanel({ item }: { item: HITLQueueItem }) {
  const flags = item.ai_flags ?? [];
  const regCompliance = item.regulatory_compliance;
  if (flags.length === 0 && regCompliance == null) return null;
  return (
    <div className="mb-5 overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.018))] shadow-[0_10px_26px_rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-2.5 border-b border-white/8 bg-white/[0.025] px-4 py-3">
        <Zap className="h-4 w-4 shrink-0 text-white/35" />
        <span className="text-sm font-bold text-white">Coverage Review Flags</span>
        {regCompliance === false && (
          <span className="ml-auto rounded-full border border-red-300/20 bg-red-300/12 px-2 py-0.5 text-[10px] font-bold text-red-700">
            ✕ Regulatory Non-Compliant
          </span>
        )}
        {regCompliance === true && (
          <span className="ml-auto rounded-full border border-emerald-300/20 bg-emerald-300/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            ✓ Regulatory Compliant
          </span>
        )}
      </div>
      {flags.length > 0 ? (
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {flags.map((flag, i) => {
            const meta = FLAG_META[flag];
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold",
                  meta?.color ?? "border-white/10 bg-white/[0.05] text-white/60"
                )}
              >
                {meta?.label ?? flag.replace(/_/g, " ")}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-3 text-[11px] italic text-white/35">No analysis flags raised.</div>
      )}
    </div>
  );
}

// ── Regulatory Violations Panel ───────────────────────────────────────────────

function RegulatoryViolationsPanel({ item }: { item: HITLQueueItem }) {
  const violations = item.regulatory_violations ?? [];
  if (violations.length === 0) return null;
  return (
    <div className="mb-5 overflow-hidden rounded-[1.25rem] border border-red-300/18 bg-red-300/[0.07] shadow-[0_10px_26px_rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-2.5 border-b border-red-300/18 px-4 py-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" />
        <span className="text-sm font-bold text-red-700">
          Regulatory Violations ({violations.length})
        </span>
        <span className="ml-auto rounded-full bg-red-300/16 px-2 py-0.5 text-[10px] font-bold text-red-700">
          Tier 1 — Mandatory Review
        </span>
      </div>
      <div className="divide-y divide-red-300/12">
        {violations.map((v: HITLRegulatoryViolation, i: number) => (
          <div key={i} className="px-4 py-3 space-y-1">
            {v.clause_reference && (
              <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-red-700">
                {String(v.clause_reference)}
              </p>
            )}
            {v.description && (
              <p className="text-[11px] leading-snug text-red-700/82">{String(v.description)}</p>
            )}
            {v.severity && (
              <span className="inline-block rounded bg-red-300/18 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">
                {String(v.severity)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Policy Citations Panel ────────────────────────────────────────────────────

function PolicyCitationsPanel({ item }: { item: HITLQueueItem }) {
  const [expanded, setExpanded] = useState(false);
  const aiCitations  = item.ai_citations     ?? [];
  const polCitations = item.policy_citations ?? [];
  if (aiCitations.length === 0 && polCitations.length === 0) return null;

  const tierBadge = (tier?: string) => {
    if (tier === "REGIONAL") return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700">T1 REG</span>;
    if (tier === "COMPANY")  return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700">T2 CO</span>;
    return null;
  };

  const coverageBadge = (status?: string) => {
    if (!status) return null;
    const s = status.toUpperCase();
    if (s === "COVERED")     return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">COVERED</span>;
    if (s === "EXCLUDED")    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">EXCLUDED</span>;
    if (s === "CONDITIONAL") return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">CONDITIONAL</span>;
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">{s}</span>;
  };

  return (
    <div className="mb-5 overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.018))] shadow-[0_10px_26px_rgba(0,0,0,0.2)]">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 shrink-0 text-white/35" />
          <span className="text-sm font-bold text-white">Policy Clause Evidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/35">
            {aiCitations.length} clause{aiCitations.length !== 1 ? "s" : ""} cited
            {polCitations.length > 0 && ` · ${polCitations.length} line analysis`}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-white/35" /> : <ChevronDown className="h-4 w-4 text-white/35" />}
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-white/8 border-t border-white/8">
          {/* Per-line coverage analysis */}
          {polCitations.length > 0 && (
            <div className="px-4 py-3">
              <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-white/25">
                Line Coverage Review
              </p>
              <div className="space-y-2">
                {polCitations.map((pc: HITLPolicyCitation, i: number) => (
                  <div key={i} className="space-y-1 rounded-[0.9rem] border border-white/8 bg-black/15 px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {pc.line_number != null && (
                        <span className="text-[9px] font-mono font-bold text-white/35">Line #{pc.line_number}</span>
                      )}
                      {coverageBadge(pc.coverage_status)}
                      {pc.ai_confidence != null && (
                        <span className="ml-auto text-[9px] text-white/35">
                          Score: <span className="font-bold">{Math.round(Number(pc.ai_confidence) * 100)}%</span>
                        </span>
                      )}
                    </div>
                    {pc.applicable_clause && (
                      <p className="text-[10px] leading-snug text-white/76">
                        <span className="font-semibold">Clause: </span>{pc.applicable_clause}
                      </p>
                    )}
                    {pc.deduction_type && (
                      <p className="text-[10px] text-white/45">
                        <span className="font-semibold">Deduction: </span>{pc.deduction_type.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full clause citations from coverage review */}
          {aiCitations.length > 0 && (
            <div className="px-4 py-3">
              <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-white/25">
                Referenced Clauses
              </p>
              <div className="space-y-2">
                {aiCitations.map((c: HITLAICitation, i: number) => (
                  <div key={i} className="space-y-1.5 rounded-[0.9rem] border border-white/8 bg-black/15 px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.clause_reference && (
                        <span className="font-mono text-[10px] font-bold text-white">{c.clause_reference}</span>
                      )}
                      {tierBadge(c.tier)}
                      {c.relevance_score != null && (
                        <span className="ml-auto text-[9px] text-white/35">
                          relevance <span className="font-bold">{Math.round(Number(c.relevance_score) * 100)}%</span>
                        </span>
                      )}
                    </div>
                    {c.clause_title && (
                      <p className="text-[10px] font-semibold text-white/82">{c.clause_title}</p>
                    )}
                    {c.text_excerpt && (
                      <p className="border-l-2 border-white/10 pl-2 text-[10px] italic leading-snug text-white/45">
                        &ldquo;{c.text_excerpt}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── All Policy Clauses Analyzed (Filtered) ───────────────────────────────────

function FilteredClausesPanel({ item }: { item: HITLQueueItem }) {
  const [expanded, setExpanded] = useState(false);
  // Look for filtered_clauses or all_clauses in the API response
  const filteredClauses = (item as unknown as Record<string, unknown>).filtered_clauses as Array<{ text?: string; clause_reference?: string }> | undefined;
  const allClauses = (item as unknown as Record<string, unknown>).all_clauses as Array<{ text?: string; clause_reference?: string }> | undefined;
  const clauses = filteredClauses ?? allClauses;

  return (
    <div className="mb-5 overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.018))] shadow-[0_10px_26px_rgba(0,0,0,0.2)]">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 shrink-0 text-white/35" />
          <span className="text-sm font-bold text-white">All Policy Clauses Analyzed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/35">
            {clauses ? `${clauses.length} clause${clauses.length !== 1 ? "s" : ""}` : "No data"}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-white/35" /> : <ChevronDown className="h-4 w-4 text-white/35" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/8">
          {!clauses || clauses.length === 0 ? (
            <div className="px-4 py-4 text-[11px] italic text-white/35">
              No additional clauses data available
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {clauses.map((clause, i) => (
                <div key={i} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {clause.clause_reference && (
                      <span className="font-mono text-[10px] font-bold text-white/60">
                        {String(clause.clause_reference)}
                      </span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-[9px] font-bold text-white/40 uppercase tracking-wide">
                      low relevance
                    </span>
                  </div>
                  {clause.text && (
                    <p className="text-[11px] leading-snug text-white/45 line-clamp-2">
                      {String(clause.text)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Read-Only Access Notice ───────────────────────────────────────────────────

function ReadOnlyNotice({ role }: { role: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[1.15rem] border border-amber-300/18 bg-amber-300/[0.08] px-4 py-4">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div>
        <p className="text-sm font-semibold text-amber-700">View Only</p>
        <p className="mt-0.5 text-xs leading-snug text-amber-700/82">
          Your role (<span className="font-mono font-bold text-amber-700">{role}</span>) can view this claim but cannot submit decisions.
          Decision authority is restricted to <span className="font-semibold">Admin</span>,{" "}
          <span className="font-semibold">Senior Adjuster</span>, and{" "}
          <span className="font-semibold">Medical Director</span>.
        </p>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function HITLDecisionPanel({
  item,
  open,
  onOpenChange,
  onSuccess,
  onOptimisticSubmit,
  shortcutDecision,
}: HITLDecisionPanelProps) {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUserRole(u?.role ?? null);
      setRoleLoaded(true);
    });
  }, []);

  const canDecide = roleLoaded ? HITL_DECISION_ROLES.has(userRole ?? "") : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sheet-native-glass w-full overflow-y-auto border-l border-white/8 text-white sm:max-w-[min(96vw,1320px)]">
        <SheetHeader className="mb-0 border-b border-white/8 px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-[1.05rem] font-bold text-white">
            <TrendingUp className="h-4 w-4 text-white/45" />
            Review Decision
          </SheetTitle>
        </SheetHeader>
        {item && (
          <div className="space-y-5 px-6 py-5">
            <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-[1.2rem] border border-cyan-300/18 bg-[#10131c]/92 px-4 py-3 shadow-[0_16px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SLACountdown slaDeadline={item.sla_deadline} className="text-[#ffffff]" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100/70">Due Time Watch</p>
                  <p className="truncate font-mono text-sm font-bold text-[#ffffff]">{item.claim_reference}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/55">
                  P{item.priority}
                </span>
                {item.hitl_sla_hours && (
                  <span className="rounded-full border border-cyan-300/16 bg-cyan-300/8 px-2.5 py-1 text-cyan-200">
                    {item.hitl_sla_hours}h target
                  </span>
                )}
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/45">
                  {new Date(item.sla_deadline).toLocaleString()}
                </span>
              </div>
            </div>
            {/* Recommendation confidence — shown for all trigger reasons */}
            <AIReasoningPanel item={item} />
            {/* Coverage flags — actual flags raised for this specific claim */}
            <CoverageFlagsPanel item={item} />
            {/* Regulatory Violations — Tier 1 compliance failures */}
            <RegulatoryViolationsPanel item={item} />
            {/* Policy Clause Evidence — cited clauses + per-line coverage analysis */}
            <PolicyCitationsPanel item={item} />
            {/* All policy clauses analyzed — including low-relevance ones not directly cited */}
            <FilteredClausesPanel item={item} />
            {/* Coverage cross-check table — only shown when comparison data is present */}
            <AgentComparisonPanel item={item} />
            {/* Only show access notice once role is confirmed */}
            {roleLoaded && !canDecide && userRole && (
              <div className="mb-5">
                <ReadOnlyNotice role={userRole} />
              </div>
            )}
            {/* Render form only after role is resolved to avoid flash */}
            {roleLoaded && (
              <HITLDecisionForm
                item={item}
                canDecide={canDecide}
                roleLoaded={roleLoaded}
                onSuccess={() => {
                  onSuccess();
                  onOpenChange(false);
                }}
                onClose={() => onOpenChange(false)}
                onOptimisticSubmit={onOptimisticSubmit}
                shortcutDecision={shortcutDecision}
              />
            )}
            {/* Loading skeleton while fetching role */}
            {!roleLoaded && (
              <div className="space-y-3 animate-pulse">
                <div className="h-24 rounded-xl bg-white/6" />
                <div className="h-32 rounded-xl bg-white/6" />
                <div className="h-20 rounded-xl bg-white/6" />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
