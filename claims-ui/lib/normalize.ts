/**
 * Response normalizers — guarantee TypeScript-safe objects from raw API JSON.
 *
 * Called once per API response in api.ts so that every component receives
 * objects that satisfy their interface contracts, regardless of whether the
 * backend served data from the in-memory pipeline or the DB fallback.
 */
import type {
  ClaimResponse,
  ClaimLineItemResponse,
  SettlementResponse,
  AuditTrailResponse,
  AuditLogEntry,
  PolicyCitation,
  ClaimStatus,
} from "./types";

// ── Primitive helpers (internal) ─────────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Valid claim statuses ─────────────────────────────────────────────────────

const VALID_STATUSES = new Set<ClaimStatus>([
  "PENDING", "PROCESSING", "SETTLED", "DENIED",
  "HITL_PENDING", "HITL_APPROVED", "HITL_DENIED", "CANCELLED", "ERROR",
]);

function claimStatus(v: unknown): ClaimStatus {
  const s = str(v, "PENDING");
  return VALID_STATUSES.has(s as ClaimStatus) ? (s as ClaimStatus) : "PENDING";
}

// ── Exported normalizers ─────────────────────────────────────────────────────

export function normalizeLineItem(raw: unknown): ClaimLineItemResponse {
  const r = obj(raw);
  return {
    line_number:        num(r.line_number, 1),
    procedure_code:     str(r.procedure_code),
    procedure_desc:     r.procedure_desc != null ? str(r.procedure_desc) : undefined,
    service_category:   str(r.service_category),
    billed_amount:      str(r.billed_amount, "0"),
    allowed_amount:     r.allowed_amount != null ? str(r.allowed_amount) : undefined,
    deductible_applied: r.deductible_applied != null ? str(r.deductible_applied) : undefined,
    copay_amount:       r.copay_amount != null ? str(r.copay_amount) : undefined,
    coinsurance_amount: r.coinsurance_amount != null ? str(r.coinsurance_amount) : undefined,
    plan_paid:          r.plan_paid != null ? str(r.plan_paid) : undefined,
    member_responsibility: r.member_responsibility != null ? str(r.member_responsibility) : undefined,
    is_covered:         r.is_covered != null ? bool(r.is_covered) : undefined,
    denial_code:        r.denial_code != null ? str(r.denial_code) : undefined,
    denial_reason:      r.denial_reason != null ? str(r.denial_reason) : undefined,
    sub_limit_applied:  bool(r.sub_limit_applied),
    sub_limit_name:     r.sub_limit_name != null ? str(r.sub_limit_name) : undefined,
    calculation_steps:  r.calculation_steps != null ? arr(r.calculation_steps) as Record<string, unknown>[] : undefined,
    clause_references:  r.clause_references != null ? arr(r.clause_references) as string[] : undefined,
  };
}

export function normalizePolicyCitation(raw: unknown): PolicyCitation {
  const r = obj(raw);
  return {
    // clause_title (ai_citations) falls back as id label
    clause_id:        r.clause_id != null        ? str(r.clause_id)
                    : r.clause_title != null     ? str(r.clause_title) : undefined,
    clause_reference: r.clause_reference != null ? str(r.clause_reference) : undefined,
    // pipeline sends applicable_clause; ai_citations sends text_excerpt
    clause_text:      r.clause_text != null      ? str(r.clause_text)
                    : r.text_excerpt != null     ? str(r.text_excerpt)
                    : r.applicable_clause != null ? str(r.applicable_clause) : undefined,
    // ai_citations sends clause_title as the human-readable source label
    source:           r.source != null           ? str(r.source)
                    : r.clause_title != null     ? str(r.clause_title) : undefined,
    tier:             r.tier != null ? str(r.tier) as PolicyCitation["tier"] : undefined,
    // pipeline sends ai_confidence instead of relevance_score
    relevance_score:  r.relevance_score != null  ? num(r.relevance_score)
                    : r.ai_confidence != null    ? num(r.ai_confidence) : undefined,
    // pipeline sends coverage_status instead of status
    status:           r.status != null           ? str(r.status)
                    : r.coverage_status != null  ? str(r.coverage_status) : undefined,
  };
}

export function normalizeClaim(raw: unknown): ClaimResponse {
  const r = obj(raw);
  return {
    id:                          str(r.id),
    claim_reference:             str(r.claim_reference),
    status:                      claimStatus(r.status),
    claim_type:                  str(r.claim_type),
    market_region:               str(r.market_region),
    currency:                    str(r.currency),
    member_number:               str(r.member_number),
    patient_name:                str(r.patient_name),
    provider_name:               str(r.provider_name),
    provider_code:               str(r.provider_code),
    network_tier:                str(r.network_tier),
    service_date:                str(r.service_date),
    admission_date:              r.admission_date != null ? str(r.admission_date) : undefined,
    discharge_date:              r.discharge_date != null ? str(r.discharge_date) : undefined,
    primary_diagnosis_code:      str(r.primary_diagnosis_code),
    primary_diagnosis_desc:      r.primary_diagnosis_desc != null ? str(r.primary_diagnosis_desc) : undefined,
    total_billed:                str(r.total_billed, "0"),
    total_allowed:               r.total_allowed != null ? str(r.total_allowed) : undefined,
    total_settlement:            r.total_settlement != null ? str(r.total_settlement) : undefined,
    total_member_responsibility: r.total_member_responsibility != null ? str(r.total_member_responsibility) : undefined,
    confidence_score:            r.confidence_score != null ? str(r.confidence_score) : undefined,
    processing_time_ms:          r.processing_time_ms != null ? num(r.processing_time_ms) : undefined,
    preauth_number:              r.preauth_number != null ? str(r.preauth_number) : undefined,
    line_items:                  arr(r.line_items).map(normalizeLineItem),
    date_received:               str(r.date_received),
    date_adjudicated:            r.date_adjudicated != null ? str(r.date_adjudicated) : undefined,
    date_settled:                r.date_settled != null ? str(r.date_settled) : undefined,
    // Duplicate detection
    is_duplicate:                r.is_duplicate != null ? bool(r.is_duplicate) : undefined,
    duplicate_of_ref:            r.duplicate_of_ref != null ? str(r.duplicate_of_ref) : undefined,
    duplicate_remarks:           r.duplicate_remarks != null ? str(r.duplicate_remarks) : undefined,
    // Verification flags
    member_verified:             r.member_verified != null ? bool(r.member_verified) : undefined,
    provider_verified:           r.provider_verified != null ? bool(r.provider_verified) : undefined,
    policy_verified:             r.policy_verified != null ? bool(r.policy_verified) : undefined,
    // AI citations & policy docs
    ai_citations:                r.ai_citations != null ? arr(r.ai_citations) as ClaimResponse["ai_citations"] : undefined,
    policy_documents_used:       r.policy_documents_used != null ? arr(r.policy_documents_used) as ClaimResponse["policy_documents_used"] : undefined,
    // Completeness & validation
    completeness:                r.completeness != null ? r.completeness as ClaimResponse["completeness"] : undefined,
    validation_warnings:         r.validation_warnings != null ? arr(r.validation_warnings) as string[] : undefined,
    validation_signals:          r.validation_signals != null ? r.validation_signals as ClaimResponse["validation_signals"] : undefined,
    pipeline_stage_report:       r.pipeline_stage_report != null ? r.pipeline_stage_report as ClaimResponse["pipeline_stage_report"] : undefined,
    agent_status_metrics:        r.agent_status_metrics != null ? r.agent_status_metrics as ClaimResponse["agent_status_metrics"] : undefined,
    routing_decision:            r.routing_decision != null ? r.routing_decision as ClaimResponse["routing_decision"] : undefined,
    hitl_priority:               r.hitl_priority != null ? num(r.hitl_priority) : undefined,
    hitl_sla_hours:              r.hitl_sla_hours != null ? num(r.hitl_sla_hours) : undefined,
    hitl_priority_reason:        r.hitl_priority_reason != null ? str(r.hitl_priority_reason) : undefined,
    calculated_confidence:       r.calculated_confidence != null ? str(r.calculated_confidence) : undefined,
    confidence_cap:              r.confidence_cap != null ? r.confidence_cap as ClaimResponse["confidence_cap"] : undefined,
    // OCR extracted data
    ocr_extracted_data:          r.ocr_extracted_data != null ? r.ocr_extracted_data as ClaimResponse["ocr_extracted_data"] : undefined,
  };
}

export function normalizeSettlement(raw: unknown): SettlementResponse | null {
  if (raw == null) return null;
  const r = obj(raw);

  // If there's no meaningful monetary data, return null so the UI shows
  // "Settlement details not yet available" instead of a blank breakdown.
  const monetaryKeys = [
    "total_billed", "total_allowed", "total_deductible", "total_copay",
    "total_coinsurance_member", "total_plan_payment", "total_member_responsibility",
  ] as const;
  const hasData = monetaryKeys.some((k) => {
    const v = str(r[k], "0").trim();
    return v !== "" && v !== "0" && v !== "0.00" && v !== "0.0";
  });
  if (!hasData) return null;

  return {
    id:                          str(r.id),
    claim_reference:             str(r.claim_reference),
    currency:                    str(r.currency),
    total_billed:                str(r.total_billed, "0"),
    total_allowed:               str(r.total_allowed, "0"),
    total_deductible:            str(r.total_deductible, "0"),
    total_copay:                 str(r.total_copay, "0"),
    total_coinsurance_member:    str(r.total_coinsurance_member, "0"),
    total_plan_payment:          str(r.total_plan_payment, "0"),
    total_member_responsibility: str(r.total_member_responsibility, "0"),
    total_vat:                   r.total_vat != null ? str(r.total_vat, "0") : undefined,
    total_gst:                   r.total_gst != null ? str(r.total_gst, "0") : undefined,
    total_tds:                   r.total_tds != null ? str(r.total_tds, "0") : undefined,
    net_payout:                  r.net_payout != null ? str(r.net_payout, "0") : undefined,
    confidence_score:            str(r.confidence_score, "0"),
    model_version:               str(r.model_version),
    rules_engine_version:        str(r.rules_engine_version),
    was_hitl_reviewed:           bool(r.was_hitl_reviewed),
    hitl_override_amount:        r.hitl_override_amount != null ? str(r.hitl_override_amount) : undefined,
    hitl_justification:          r.hitl_justification != null ? str(r.hitl_justification) : undefined,
    calculation_breakdown:       obj(r.calculation_breakdown) as Record<string, unknown>,
    // Merge policy_citations + ai_citations — both carry clause data with different
    // field names. ai_citations has richer data (text_excerpt, tier, relevance_score).
    // Filter out entries with no meaningful content after normalization.
    policy_citations: [
      ...arr(r.policy_citations).map(normalizePolicyCitation),
      ...arr(r.ai_citations).map(normalizePolicyCitation),
    ].filter((c) => !!(c.clause_text || c.clause_reference || c.clause_id)),
    policy_documents_used:       r.policy_documents_used != null ? arr(r.policy_documents_used) as SettlementResponse["policy_documents_used"] : undefined,
    line_items:                  arr(r.line_items).map(normalizeLineItem),
    created_at:                  str(r.created_at),
  };
}

export function normalizeAuditTrail(raw: unknown): AuditTrailResponse {
  const r = obj(raw);
  const entries = arr(r.entries).map((e): AuditLogEntry => {
    const entry = obj(e);
    return {
      id:           str(entry.id),
      event_type:   str(entry.event_type),
      timestamp:    str(entry.timestamp),
      actor_type:   str(entry.actor_type),
      actor_id:     entry.actor_id != null ? str(entry.actor_id) : undefined,
      description:  str(entry.description),
      event_data:   obj(entry.event_data) as Record<string, unknown>,
      service_name: str(entry.service_name),
      entry_hash:   str(entry.entry_hash),
    };
  });
  return {
    claim_reference: str(r.claim_reference),
    entries,
    total_entries:   num(r.total_entries, entries.length),
    chain_valid:     bool(r.chain_valid),
  };
}
