/**
 * TypeScript interfaces mirroring the backend Pydantic schemas.
 * All monetary values come as strings from JSON (Decimal serialisation).
 */

// ═══════════════════════════════════════════
// CLAIM TYPES
// ═══════════════════════════════════════════

export interface ClaimLineItemCreate {
  line_number: number;
  procedure_code: string;
  procedure_desc?: string;
  service_category: string;
  billed_amount: string | number;
  units?: string | number;
  days?: number;
  modifier_codes?: string[];
  diagnosis_pointers?: number[];
}

export interface AdvanceClaimCreate {
  claim_type: string;
  market_region?: string;
  currency?: string;
  member_number: string;
  patient_name: string;
  patient_dob: string;
  provider_code: string;
  provider_name: string;
  network_tier?: string;
  admission_date: string;
  discharge_date?: string;
  primary_diagnosis_code: string;
  primary_diagnosis_desc?: string;
  secondary_diagnosis_codes?: string[];
  line_items: ClaimLineItemCreate[];
  treating_doctor: string;
  treating_hospital_reg?: string;
  estimated_total: string | number;
  supporting_docs?: string[];
  is_emergency?: boolean;
  source_channel?: string;
  bank_account_holder?: string;
  account_holder_name?: string;
  account_type?: CustomerAccountType;
  bank_name?: string;
  iban?: string;
  swift_bic?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_vpa?: string;
  upi_provider?: string;
}

export interface AdvancePreauthDecisionCreate {
  decision: "APPROVE" | "APPROVE_PARTIAL" | "REJECT" | "REQUEST_INFO";
  coverage_percentage?: number;
  estimated_plan_payment?: string | number;
  notes: string;
  reviewer_notes?: string;
}

export interface AdvanceClaimResponse {
  id: string;
  claim_reference: string;
  preauth_reference: string;
  status: string;
  preauth_status: string;
  coverage_decision: string;
  estimated_coverage?: string | number | null;
  estimated_member_responsibility?: string | number | null;
  estimated_plan_payment?: string | number | null;
  estimated_deductible_applied?: string | number | null;
  estimated_copay?: string | number | null;
  confidence_score?: string | number | null;
  preauth_letter_url?: string | null;
  needs_hntl: boolean;
  hitl_deadline?: string | null;
  date_created: string;
  date_decision?: string | null;
  supporting_docs?: string[] | null;
  // India cashless pipeline fields
  abha_address?: string | null;
  consent_verified?: boolean | null;
  fwa_anomaly_score?: string | number | null;
  irdai_violations?: string | string[] | null;
  fhir_resource_id?: string | null;
  bpmn_process_instance_id?: string | null;
}

export interface AdvanceClaimListResponse {
  claims: AdvanceClaimResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdvanceDocumentUploadItem {
  original_filename: string;
  document_url: string;
  document_hash: string;
  file_size_bytes: number;
  content_type?: string | null;
}

export interface AdvanceDocumentUploadResponse {
  upload_id: string;
  documents: AdvanceDocumentUploadItem[];
}

export type AdvanceDocumentProcessStatus = "READY" | "NEEDS_INPUT";

export interface AdvanceDocumentProcessResponse {
  status: AdvanceDocumentProcessStatus;
  message: string;
  extracted_fields: Partial<AdvanceClaimCreate> & {
    line_items?: ClaimLineItemCreate[];
    estimated_total?: string | number | null;
    provider_state?: string;
    provider_city?: string;
  };
  field_confidences: Record<string, number>;
  missing_fields: string[];
  low_confidence_fields: string[];
  documents_processed: string[];
  overall_confidence?: number | null;
}

export interface IndiaHospitalReference {
  code: string;
  name: string;
  state: string;
  city: string;
  tier: string;
  aliases?: string[];
}

export interface IndiaDoctorReference {
  name: string;
  specialty: string;
  state?: string;
  hospital_codes?: string[];
}

export interface IndiaDiagnosisReference {
  code: string;
  desc: string;
  aliases?: string[];
}

export interface IndiaProcedureReference {
  code: string;
  name: string;
  category: string;
}

export interface IndiaBankReference {
  name: string;
  ifsc_prefix?: string;
  upi_handles?: string[];
}

export interface IndiaCashlessReferenceData {
  version: string;
  hospitals: IndiaHospitalReference[];
  treatment_doctors: IndiaDoctorReference[];
  primary_diagnoses: IndiaDiagnosisReference[];
  procedures: IndiaProcedureReference[];
  banks: IndiaBankReference[];
}

export interface ClaimCreate {
  claim_type: string;
  market_region: string;
  currency: string;
  member_number: string;
  patient_name: string;
  patient_dob: string; // ISO date
  provider_code: string;
  provider_name: string;
  network_tier?: string;
  service_date: string; // ISO date
  admission_date?: string;
  discharge_date?: string;
  primary_diagnosis_code: string;
  primary_diagnosis_desc?: string;
  secondary_diagnosis_codes?: string[];
  preauth_number?: string;
  preauth_approved?: boolean;
  line_items: ClaimLineItemCreate[];
  source_channel?: string;
  bank_account_holder?: string;
  account_holder_name?: string;
  account_type?: CustomerAccountType;
  bank_name?: string;
  iban?: string;
  swift_bic?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_vpa?: string;
  upi_provider?: string;
}

export interface ClaimLineItemResponse {
  line_number: number;
  procedure_code: string;
  procedure_desc?: string;
  service_category: string;
  billed_amount: string;
  allowed_amount?: string;
  deductible_applied?: string;
  copay_amount?: string;
  coinsurance_amount?: string;
  plan_paid?: string;
  member_responsibility?: string;
  is_covered?: boolean;
  denial_code?: string;
  denial_reason?: string;
  sub_limit_applied: boolean;
  sub_limit_name?: string;
  proportionate_deduction_applied?: boolean;
  proportionate_ratio?: string;
  calculation_steps?: Record<string, unknown>[];
  clause_references?: string[];
}

export interface OcrExtractedField {
  value: string;
  confidence: number;
}

export interface OcrExtractedData {
  // Insurer / policy
  insurer_name?:      OcrExtractedField | string;
  policy_number?:     OcrExtractedField | string;
  policy_name?:       OcrExtractedField | string;
  policy_name_hint?:  string;
  // Patient / member
  emirates_id?:       OcrExtractedField;
  gender?:            OcrExtractedField;
  member_nationality?: OcrExtractedField;
  emirate?:           OcrExtractedField;
  patient_address?:   OcrExtractedField;
  contact_number?:    OcrExtractedField;
  email_address?:     OcrExtractedField;
  // Coverage
  coverage_start?:    OcrExtractedField;
  coverage_end?:      OcrExtractedField;
  group_sponsor?:     OcrExtractedField;
  pre_auth_number?:   OcrExtractedField;
  pre_auth_status?:   OcrExtractedField;
  // Provider / physician
  hospital_name?:      OcrExtractedField;
  treating_physician?: OcrExtractedField;
  physician_license?:  OcrExtractedField;
  hospital_address?:   OcrExtractedField;
  hospital_license?:   OcrExtractedField;
  // Metadata
  _ocr_metadata?: {
    _ocr_engine?: string;
    _ocr_confidence?: number;
    _ocr_document_hash?: string;
    _ocr_market_detection_conf?: number;
    _ocr_low_confidence_fields?: string[];
  };
  [key: string]: OcrExtractedField | string | undefined | Record<string, unknown>;
}

/** Returned inside a 409 DuplicateClaimError when the same PDF is re-uploaded */
export interface DuplicateClaimInfo {
  claim_reference:   string;
  patient_name:      string | null;
  member_number:     string | null;
  status:            string;
  date_received:     string;
  total_billed:      string;
  hitl_trigger:      string | null;
  rejection_reason:  string | null;
  original_filename: string | null;
  is_duplicate:      boolean;
  duplicate_of_ref:  string | null;
}

export type ComponentStatus = "COMPLETED" | "SKIPPED" | "FAILED" | "NOT_STARTED";

export interface ComponentCompleteness {
  status: ComponentStatus;
  error: string | null;
  items_evaluated?: number;
  citations_found?: number;
  citations_count?: number;
  line_items_calculated?: number;
}

export interface ProcessingCompleteness {
  all_completed: boolean;
  any_failed: boolean;
  any_skipped: boolean;
  completion_percentage: number;
  components: {
    rules_engine: ComponentCompleteness;
    ai_reasoning: ComponentCompleteness;
    policy_citations: ComponentCompleteness;
    settlement_calculation: ComponentCompleteness;
  };
  failure_reasons: string[];
}

export interface ConfidenceCap {
  applied: boolean;
  reason: "AI_REASONING_SKIPPED" | "COMPONENT_FAILURE" | string | null;
  limit: number | null;
  before: number | null;
  after: number;
}

export interface ClaimResponse {
  id: string;
  claim_reference: string;
  status: ClaimStatus;
  // Duplicate document detection fields
  is_duplicate?:      boolean;
  duplicate_of_ref?:  string | null;
  duplicate_remarks?: string | null;
  is_advance_claim?: boolean;
  claim_type: string;
  market_region: string;
  currency: string;
  member_number: string;
  patient_name: string;
  provider_name: string;
  provider_code: string;
  network_tier: string;
  service_date: string;
  admission_date?: string;
  discharge_date?: string;
  primary_diagnosis_code: string;
  primary_diagnosis_desc?: string;
  total_billed: string;
  total_allowed?: string;
  total_settlement?: string;
  total_settled_amount?: string;
  total_member_responsibility?: string;
  confidence_score?: string;
  calculated_confidence?: string;  // Raw confidence before completeness cap
  confidence_cap?: ConfidenceCap;
  processing_time_ms?: number;
  preauth_number?: string;
  line_items: ClaimLineItemResponse[];
  date_received: string;
  date_adjudicated?: string;
  date_settled?: string;
  // OCR extended fields (contact, address, physician, pre-auth, insurer, etc.)
  ocr_extracted_data?: OcrExtractedData;
  // Pre-production verification flags
  member_verified?: boolean;
  provider_verified?: boolean;
  policy_verified?: boolean;
  // AI citations and policy documents (for claim detail view)
  ai_citations?: Array<{
    clause_reference: string;
    clause_title: string;
    text_excerpt: string;
    relevance_score: number;
    tier: "REGIONAL" | "COMPANY";
  }>;
  policy_documents_used?: PolicyDocumentUsed[];
  // Universal completeness validation results
  completeness?: ProcessingCompleteness;
  validation_warnings?: string[];
  validation_signals?: Record<string, unknown>;
  pipeline_stage_report?: {
    status?: string;
    completed_stages?: number;
    total_stages?: number;
    total_duration_ms?: number;
    stages?: Array<{
      stage: string;
      label: string;
      status: string;
      duration_ms: number;
      summary?: string;
      details?: Record<string, unknown>;
    }>;
  };
  lifecycle?: ClaimLifecycleSummary | null;
  agent_status_metrics?: Record<string, {
    label?: string;
    status?: string;
    duration_ms?: number;
    confidence?: number | null;
    details?: Record<string, unknown>;
  }>;
  routing_decision?: Record<string, unknown>;
  hitl_priority?: number;
  hitl_sla_hours?: number;
  hitl_priority_reason?: string;
  agent_agreement_score?:    number | null;
  agent_disagreement_items?: number[];
  agent_line_comparisons?:   Array<Record<string, unknown>>;
  hitl_reason?:              string | null;
}

export interface ClaimListResponse {
  claims: ClaimResponse[];
  total: number;
  page: number;
  page_size: number;
}

export type ClaimStatus =
  | "PENDING"
  | "PROCESSING"
  | "SETTLED"
  | "DENIED"
  | "HITL_PENDING"
  | "HITL_APPROVED"
  | "HITL_DENIED"
  | "CANCELLED"
  | "ERROR";

export type ClaimLifecycleStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "IN_PROGRESS"
  | "PROCESSING"
  | "WAITING"
  | "BLOCKED"
  | "STUCK"
  | "SLA_BREACHED"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED"
  | (string & {});

export interface ClaimLifecycleEvent {
  id?: string;
  stage?: string;
  stage_label?: string;
  status?: ClaimLifecycleStatus;
  event_type?: string;
  label?: string;
  description?: string;
  timestamp?: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  age_seconds?: number | null;
  actor_type?: string;
  actor_id?: string | null;
  service_name?: string;
  blocker?: string | null;
  next_action?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaimLifecycleStage {
  id?: string;
  stage: string;
  label: string;
  status: ClaimLifecycleStatus;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  duration_ms?: number | null;
  age_seconds?: number | null;
  sla_due_at?: string | null;
  sla_seconds?: number | null;
  blocker?: string | null;
  next_action?: string | null;
  events?: ClaimLifecycleEvent[];
  metadata?: Record<string, unknown>;
}

export interface ClaimLifecycleSummary {
  claim_reference: string;
  current_stage: string;
  current_stage_label: string;
  status: ClaimLifecycleStatus;
  age_seconds?: number | null;
  age_ms?: number | null;
  started_at?: string | null;
  updated_at?: string | null;
  sla_due_at?: string | null;
  sla_status?: "ON_TRACK" | "AT_RISK" | "BREACHED" | "UNKNOWN" | (string & {});
  blocker?: string | null;
  next_action?: string | null;
  patient_name?: string | null;
  member_number?: string | null;
  claim_type?: string | null;
  market_region?: string | null;
  currency?: string | null;
  total_billed?: string | number | null;
  total_settlement?: string | number | null;
  claim_status?: string | null;
  stages: ClaimLifecycleStage[];
  events: ClaimLifecycleEvent[];
  metadata?: Record<string, unknown>;
}

export interface OperationsLifecycleStageSummary {
  stage: string;
  label: string;
  total: number;
  in_progress: number;
  completed: number;
  failed: number;
  skipped: number;
  blocked: number;
  stuck: number;
  sla_breached: number;
  avg_age_seconds?: number | null;
}

export interface OperationsLifecycleResponse {
  generated_at?: string;
  total_claims: number;
  stuck_count: number;
  blocked_count: number;
  sla_breached_count: number;
  stage_summary: OperationsLifecycleStageSummary[];
  claims: ClaimLifecycleSummary[];
  page?: number;
  page_size?: number;
  total?: number;
}

export interface OperationsLifecycleParams {
  stage?: string;
  status?: string;
  market_region?: string;
  search?: string;
  only_stuck?: boolean;
  only_sla_breached?: boolean;
  page?: number;
  page_size?: number;
}

// ═══════════════════════════════════════════
// SETTLEMENT TYPES
// ═══════════════════════════════════════════

export interface PolicyCitation {
  clause_id?: string;
  clause_reference?: string;
  clause_text?: string;
  source?: string;
  tier?: "REGIONAL" | "COMPANY";
  relevance_score?: number;
  status?: string;
}

export interface PolicyDocumentUsed {
  policy_id: string;
  tier: "NATIONAL" | "COMPANY";
  policy_name: string;
  insurer_name: string;
  clauses_referenced: number;
  has_pdf: boolean;
}

export interface SettlementResponse {
  id: string;
  claim_reference: string;
  currency: string;
  total_billed: string;
  total_allowed: string;
  total_deductible: string;
  total_copay: string;
  total_coinsurance_member: string;
  total_plan_payment: string;
  total_member_responsibility: string;
  total_vat?: string;
  total_gst?: string;
  total_tds?: string;
  net_payout?: string;
  confidence_score: string;
  model_version: string;
  rules_engine_version: string;
  was_hitl_reviewed: boolean;
  hitl_override_amount?: string;
  hitl_justification?: string;
  calculation_breakdown: Record<string, unknown>;
  policy_citations: PolicyCitation[];
  policy_documents_used?: PolicyDocumentUsed[];
  line_items: ClaimLineItemResponse[];
  created_at: string;
}

// ═══════════════════════════════════════════
// POLICY TYPES
// ═══════════════════════════════════════════

export interface PolicyResponse {
  id: string;
  policy_number: string;
  policy_name: string;
  carrier_name: string;
  tier: string;
  market_region: string;
  currency: string;
  effective_date: string;
  termination_date?: string;
  annual_limit: string;
  status: string;
  benefit_summary?: Record<string, unknown>;
  created_at: string;
  // Extended: clause count from document extraction
  clauses_count?: number;
}

export interface PolicyDocumentUploadResponse {
  policy_id: string;
  policy_number: string;
  document_hash: string;
  page_count: number;
  clauses_extracted: number;
  clauses_inserted: number;
  ocr_engine_used: string;
  llm_model_used: string;
  processing_time_ms: number;
  warnings: string[];
  message: string;
}

// ═══════════════════════════════════════════
// MEMBER TYPES
// ═══════════════════════════════════════════

export interface MemberResponse {
  id: string;
  member_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  nationality?: string;
  market_region: string;
  policy_id?: string;
  group_number?: string;
  coverage_start: string;
  coverage_end?: string;
  is_active: boolean;
  deductible_met: string;
  oop_met: string;
}

// ═══════════════════════════════════════════
// HITL TYPES
// ═══════════════════════════════════════════

export type HITLDecision =
  | "APPROVE_AI"
  | "OVERRIDE_AMOUNT"
  | "DENY_CLAIM"
  | "ESCALATE"
  | "REQUEST_INFO";

/** Per-line comparison between Agent A (Rules Engine) and Agent B (Intelligence AI Agent). */
export interface AgentLineComparison {
  line_number:          number;
  procedure_code:       string;
  rules_verdict:        "COVERED" | "EXCLUDED";
  llm_verdict:          "COVERED" | "EXCLUDED" | "CONDITIONAL" | "AMBIGUOUS";
  agreement:            number;  // 0.0 – 1.0
  disagreement_reason?: string | null;
}

export interface HITLAICitation {
  clause_reference?: string;
  clause_title?:     string;
  text_excerpt?:     string;
  relevance_score?:  number;
  tier?:             "REGIONAL" | "COMPANY" | string;
}

export interface HITLPolicyCitation {
  line_number?:      number;
  coverage_status?:  string;
  applicable_clause?: string;
  deduction_type?:   string;
  ai_confidence?:    number;
}

export interface HITLRegulatoryViolation {
  clause_reference?: string;
  description?:      string;
  severity?:         string;
  [key: string]:     unknown;
}

export interface HITLAgentAssignment {
  agent_id: string;
  label: string;
  role?: string;
  task?: string;
  status: string;
  priority?: number;
  parallel_group?: string;
  source_agent_id?: string | null;
  duration_ms?: number | null;
  confidence?: number | null;
}

export interface HITLQueueItem {
  id: string;
  claim_reference: string;
  claim_type: string;
  patient_name: string;
  provider_name: string;
  total_billed: string;
  ai_settlement_amount: string;
  ai_confidence: string;
  trigger_reason: string;
  status: string;
  priority: number;
  hitl_sla_hours?: number;
  hitl_priority_reason?: string;
  assigned_to?: string;
  agent_assignments?: HITLAgentAssignment[];
  agent_lane_assignments?: HITLAgentAssignment[];
  sla_deadline: string;
  created_at: string;
  pending_days_since?: number;
  // Joined from claim
  market_region?: string;
  currency?: string;
  // Dual-agent cross-validation (present when enabled)
  agent_agreement_score?:    number | null;
  agent_disagreement_items?: number[];
  agent_line_comparisons?:   AgentLineComparison[];
  // Line items (for comparison panel procedure code lookup)
  line_items?: Array<{
    line_number:         number;
    procedure_code:      string;
    service_category?:   string;
    is_covered?:         boolean;
    ai_coverage_status?: string;
  }>;
  // ── Intelligence AI Agent analysis fields (enriched by HITL queue endpoint) ──
  ai_flags?:               string[];
  regulatory_compliance?:  boolean | null;
  regulatory_violations?:  HITLRegulatoryViolation[];
  regulatory_citations?:   HITLAICitation[];
  ai_citations?:           HITLAICitation[];
  policy_citations?:       HITLPolicyCitation[];
}

export interface HITLDecisionCreate {
  decision: HITLDecision;
  override_amount?: string;
  justification: string;
  reviewer_notes?: string;
}

export type BulkClaimDecision = "SETTLED" | "DENIED";

export interface BulkDecisionResponse {
  message: string;
  updated_count?: number;
}

export interface HITLQueueResponse {
  items: HITLQueueItem[];
  total: number;
  pending_count: number;
  overdue_count: number;
}

// ═══════════════════════════════════════════
// AUDIT TYPES
// ═══════════════════════════════════════════

export interface AuditLogEntry {
  id: string;
  event_type: string;
  timestamp: string;
  actor_type: string;
  actor_id?: string;
  description: string;
  event_data: Record<string, unknown>;
  service_name: string;
  entry_hash: string;
}

export interface AuditTrailResponse {
  claim_reference: string;
  entries: AuditLogEntry[];
  chain_valid: boolean;
  total_entries: number;
}

// Global audit log list (across all claims, admin viewer)
export interface AuditLogListEntry extends AuditLogEntry {
  claim_reference?: string;
}

export interface AuditLogsListResponse {
  entries: AuditLogListEntry[];
  total: number;
  page: number;
  page_size: number;
}

// ═══════════════════════════════════════════
// DASHBOARD TYPES
// ═══════════════════════════════════════════

export interface PipelineStages {
  ingestion:   number;
  processing:  number;
  risk_review: number;
  settled:     number;
  denied:      number;
}

export interface DashboardVolumeDay {
  date:    string;  // YYYY-MM-DD
  claims:  number;
  fraud:   number;
  settled: number;
  amount:  number;  // total billed in the requested display currency
}

export interface DashboardVolumeResponse {
  days:       DashboardVolumeDay[];
  total_days: number;
}

export interface ServiceHealthLive {
  api:   boolean;
  db:    boolean;
  redis: boolean;
  llm:   boolean;
}

export interface ReliabilityMetricsSnapshot {
  idempotency_replays: number;
  idempotency_conflicts: number;
  dead_letters_recorded: number;
  audit_fields_protected: number;
  idempotency_cache_entries?: number;
  dead_letters_in_memory?: number;
  open_dead_letters?: number;
  in_progress_requests?: number;
}

export interface DashboardKPIs {
  total_claims: number;
  claims_today: number;
  avg_processing_time_ms: number;
  auto_adjudication_rate: number;
  avg_confidence_score: number;
  total_settled_amount: string;
  display_currency?: string;
  pending_hitl_count: number;
  overdue_hitl_count: number;
  denial_rate: number;
  top_denial_reasons: Array<{ reason: string; count: number }>;
  claims_by_status: Record<string, number>;
  claims_by_market: Record<string, number>;
  /** Whether PostgreSQL is connected (returned by backend) */
  db_available?: boolean;
  // ── New: pipeline flow, fraud prevention, SLA ──────────────────────────────
  pipeline_stages?:       PipelineStages;
  fraud_prevented_today?: string;
  total_fraud_prevented?: string;
  sla_compliance_rate?:   number;  // 0 – 100
  sla_target_ms?:         number;
  avg_processing_ms?:     number;
  reliability_metrics?:   ReliabilityMetricsSnapshot;
  compliance_drift?:      Record<string, boolean>;
  native_observability?: {
    stage_averages_ms?: Record<string, number>;
    stage_status_counts?: Record<string, Record<string, number>>;
    agent_status_counts?: Record<string, number>;
    validation_signal_rates?: Record<string, number>;
    hitl_priority_distribution?: Record<string, number>;
    sla_breach_risk_count?: number;
  };
}

// ─── Dashboard Filters ────────────────────────────────────────────────────────

export type DashboardPeriod = "T" | "W" | "M" | "Y" | "C";

export interface DashboardFilters {
  period: DashboardPeriod;
  customFrom?: string;  // YYYY-MM-DD
  customTo?: string;    // YYYY-MM-DD
}

// ═══════════════════════════════════════════
// COMMON TYPES
// ═══════════════════════════════════════════

export interface HealthResponse {
  service: string;
  status: string;
  version: string;
  uptime_seconds: number;
}

/** Shape of raw API error JSON — distinct from the ApiError class in api.ts */
export interface ApiErrorResponse {
  status: number;
  error: string;
  detail: string;
}

// OCR upload result (from POST /claims/upload)
export interface OCRUploadResult {
  ocr_text?: string;
  extracted_fields?: {
    member_number?: string;
    patient_name?: string;
    service_date?: string;
    provider_code?: string;
    provider_name?: string;
    total_billed?: string;
    currency?: string;
    market_region?: string;
    claim_type?: string;
    primary_diagnosis_code?: string;
    primary_diagnosis_desc?: string;
    line_items?: Array<{
      procedure_code?: string;
      procedure_desc?: string;
      service_category?: string;
      billed_amount?: string;
    }>;
    [key: string]: unknown;
  };
  field_confidences?: Record<string, number>;
  overall_confidence?: number;
  page_count?: number;
  // When pre-adjudicated immediately
  claim?: ClaimResponse;
  settlement?: SettlementResponse;
}

// ═══════════════════════════════════════════
// ADMIN TYPES
// ═══════════════════════════════════════════

export interface AdminUser {
  id:            string;
  email:         string;
  full_name:     string;
  role:          string;
  market_region: string;
  is_active:     boolean;
  mfa_required?: boolean;
  mfa_enabled?:  boolean;
}

export interface AccessGroupPolicy {
  id: string;
  name: string;
  description: string;
  roleScope: string[];
  marketScope: string[];
  screenAccess: string[];
  isActive: boolean;
}

export interface ScreenAccessResponse {
  allowed_screen_ids: string[];
  allowed_hrefs: string[];
}

export interface SystemConfig {
  access_token_ttl_minutes:  number;
  refresh_token_ttl_days:    number;
  enable_swagger_ui:         boolean;
  enable_demo_endpoints:     boolean;
  llm_model:                 string;
  groq_api_key:              string | null;
  anthropic_api_key:         string | null;
  cors_allowed_origins:      string[];
  enable_db_persistence:     boolean;
  redis_url:                 string;
  rate_limit_adjudication:   string;
  rate_limit_standard:       string;
  rate_limit_health:         string;
  // Adjudication confidence thresholds
  hitl_low_confidence_threshold:    number;
  hitl_medium_confidence_threshold: number;
  hitl_medium_value_threshold:      number;
  hitl_high_value_threshold:        number;
  confidence_weight_t1:             number;
  confidence_weight_t2:             number;
  // Dual-Agent Cross-Validation
  dual_agent_enabled:                  boolean;
  dual_agent_agreement_threshold:      number;
  dual_agent_conflict_threshold:       number;
  // Intelligence AI Agent master control
  llm_enabled:                         boolean;
  // Per-provider toggles
  groq_enabled:                        boolean;
  anthropic_enabled:                   boolean;
  anthropic_model:                     string;
  openai_enabled:                      boolean;
  openai_api_key:                      string | null;
  openai_model:                        string;
  // Backup Intelligence AI Agent
  nvidia_enabled:                      boolean;
  nvidia_api_key:                      string | null;
  nvidia_model:                        string;
  // Rules Engine Configurable Parameters
  re_gcc_copay_in_network_pct:         number;
  re_gcc_copay_out_of_network_pct:     number;
  re_gcc_copay_direct_billing_pct:     number;
  re_gcc_drg_threshold:                number;
  re_preauth_penalty_pct:              number;
  // Rules Engine Configurable Parameters — India Market
  re_india_room_rent_limit_pct:        number;
  re_india_ayush_min_days:             number;
  re_india_domiciliary_min_days:       number;
  // Claim Approval
  claim_auto_approve_threshold:        number;
  claim_auto_approve_max_amount:       number;
  claim_auto_approve_thresholds_by_market?: Record<string, { currency: string; max_amount: number }>;
  claim_approval_llm_model:            string;
  chat_assistant_enabled?:             boolean;
  chat_assistant_roles?:               string[];
  chat_assistant_markets?:             string[];
  chat_assistant_variant?:             string;
  sla_settings_by_market?:             Record<string, { enabled: boolean; hours: number }>;
  // Tax / VAT rates
  vat_rate_uae:                        number;
  vat_rate_ksa:                        number;
  gst_rate_india:                      number;
  india_consumables_gst_pct?:          number;
  india_tds_rate_pct?:                 number;
  india_zonal_copay_pct?:              number;
  re_india_icu_rent_limit_pct?:        number;
  // Membership Sync
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  membership_sync_configs?:            Record<string, any>;
  // Auth / MFA
  mfa_required_for_admins:             boolean;
  access_groups?:                      AccessGroupPolicy[];
}

// ═══════════════════════════════════════════
// POLICY LIBRARY TYPES
// ═══════════════════════════════════════════

/** Index entry returned by GET /api/v1/admin/policy-library */
export interface PolicyLibraryEntry {
  id:              string;
  market:          string;
  policy_type:     "NATIONAL" | "COMPANY";
  insurer_name:    string;
  policy_name:     string;
  effective_date:  string;
  version:         string;
  source_filename: string;
  uploaded_by:     string;
  uploaded_at:     string;
  clauses_count:   number;
  // Document storage fields (present if PDF was saved)
  document_path?:      string;
  document_hash?:      string;
  file_size_bytes?:    number;
}

/** Full document returned by GET /api/v1/admin/policy-library/{id} */
export interface PolicyLibraryDocument extends PolicyLibraryEntry {
  clauses: PolicyLibraryClause[];
}

export interface PolicyLibraryClause {
  clause_type:           string;
  section_reference:     string;
  title:                 string;
  full_text:             string;
  structured_data:       Record<string, unknown>;
  applicable_claim_types: string[] | null;
  is_active:             boolean;
}

/** Response from POST /api/v1/admin/policy-library/upload */
export interface PolicyLibraryUploadResponse {
  policy_id:          string;
  policy_name:        string;
  market:             string;
  policy_type:        string;
  insurer_name:       string;
  effective_date:     string;
  version:            string;
  clauses_extracted:  number;
  page_count:         number;
  document_hash:      string;
  ocr_engine_used:    string;
  llm_model_used:     string;
  llm_available:      boolean;
  processing_time_ms: number;
  warnings:           string[];
}

/** A single extracted metadata field with confidence score */
export interface MetadataField {
  value:      string | null;
  confidence: number;   // 0.0 – 1.0
  source:     "extracted" | "inferred" | "missing";
}

/** Response from POST /api/v1/admin/policy-library/extract-metadata */
export interface PolicyMetadataResponse {
  is_insurance_document:  boolean;
  document_confidence:    number;
  insurer_name:           MetadataField;
  policy_name:            MetadataField;
  effective_date:         MetadataField;  // YYYY-MM-DD
  version:                MetadataField;
  market:                 MetadataField;
  policy_type:            MetadataField;  // NATIONAL | COMPANY
  missing_fields:         string[];
  warnings:               string[];
  page_count:             number;
}

// ═══════════════════════════════════════════
// ADMIN REPORTS TYPES
// ═══════════════════════════════════════════

export interface ReportColumn {
  key:   string;
  label: string;
}

export interface AdminReportResponse {
  category:      string;
  date_anchor?:  string | null;
  total_records: number;
  page:          number;
  page_size:     number;
  records:       Record<string, string>[];
  columns:       ReportColumn[];
}

// ═══════════════════════════════════════════
// HMS INTEGRATION TYPES
// ═══════════════════════════════════════════

export interface HMSSource {
  id:               string;
  name:             string;
  enabled:          boolean;
  market_region:    string;
  pull_base_url:    string;
  claim_pull_path:  string;
  pull_auth_header: string;   // masked on the wire
  webhook_secret:   string;   // masked on the wire
  registered_at:    string;
  last_event_at:    string | null;
  total_events:     number;
}

export interface HMSSourceCreate {
  name:             string;
  market_region:    string;
  pull_base_url:    string;
  claim_pull_path:  string;
  pull_auth_header: string;
  webhook_secret:   string;
  enabled:          boolean;
}

export interface HMSTestResult {
  reachable:   boolean;
  status_code: number | null;
  latency_ms:  number;
  detail:      string;
}

export interface IntegrationCheck {
  status:      "up" | "down" | "not_configured" | "unknown" | "error";
  latency_ms?: number;
  detail?:     string;
  configured?: boolean;
  host?:       string;
}

export interface IntegrationHealth {
  checks: {
    postgresql: IntegrationCheck;
    redis:      IntegrationCheck;
    groq:       IntegrationCheck;
    anthropic:  IntegrationCheck;
    nvidia?:    IntegrationCheck;
  };
  timestamp: number;
}

export type KubernetesServiceStatus = "up" | "degraded" | "down" | "not_found" | "not_configured" | "error";

export interface KubernetesServicePort {
  name?: string | null;
  port?: number | string | null;
  target_port?: number | string | null;
  node_port?: number | string | null;
  protocol?: string | null;
}

export interface KubernetesServiceHealth {
  key: string;
  name: string;
  group: string;
  namespace?: string | null;
  workload_type?: "deployment" | "sidecar" | string | null;
  status: KubernetesServiceStatus;
  detail?: string;
  deployment?: string | null;
  service?: string | null;
  service_type?: string | null;
  cluster_ip?: string | null;
  ports: KubernetesServicePort[];
  desired_replicas: number;
  ready_replicas: number;
  available_replicas: number;
  updated_replicas: number;
  pod_count: number;
  running_pods: number;
  waiting_pods: number;
  restarts: number;
  age?: string | null;
}

export interface KubernetesHealth {
  configured: boolean;
  namespace: string;
  status: KubernetesServiceStatus;
  detail?: string;
  summary: {
    total: number;
    up: number;
    degraded: number;
    down: number;
    not_found: number;
    not_configured?: number;
    restarts: number;
  };
  services: KubernetesServiceHealth[];
  timestamp: number;
}

// ═══════════════════════════════════════════
// COMPLIANCE & WORKFLOW OPERATIONS
// ═══════════════════════════════════════════

export interface ReliabilitySnapshot {
  idempotency_replays?:      number;
  idempotency_conflicts?:    number;
  dead_letters_recorded?:    number;
  audit_fields_protected?:   number;
  idempotency_cache_entries?: number;
  dead_letters_in_memory?:   number;
  open_dead_letters?:        number;
  in_progress_requests?:     number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface ComplianceUpdateRecord {
  id:              string;
  market:          string;
  regulatory_body: string;
  source:          string;
  effective_date:  string;
  clause_count:    number;
  clauses_hash:    string;
  notes:           string;
  uploaded_by:     string;
  uploaded_at:     string;
  clauses?:        Record<string, unknown>[];
}

export interface ComplianceDriftResult {
  market:          string;
  has_update:      boolean;
  expected_hash?:  string | null;
  current_hash:    string;
  drift_detected:  boolean;
  latest_update?:  ComplianceUpdateRecord | null;
}

export interface ComplianceVerificationRecord {
  id:                string;
  market:            string;
  verification_type: string;
  result_status:     string;
  details: {
    drift_results?: ComplianceDriftResult[];
    reliability?:  ReliabilitySnapshot;
    [key: string]: unknown;
  };
  verified_by?:      string;
  verified_at:       string;
}

export interface WorkflowSagaRecord {
  claim_reference: string;
  tenant_id:       string;
  saga_status:     string;
  current_step:    string;
  trace_id?:       string | null;
  source_channel?: string | null;
  last_error?:     string | null;
  started_at:      string;
  updated_at:      string;
}

export interface WorkflowEventRecord {
  event_sequence:  number;
  event_type:      string;
  event_timestamp: string;
  event_payload:   Record<string, unknown>;
  source_service:  string;
  trace_id?:       string | null;
  correlation_id?: string | null;
  event_hash:      string;
}

// ═══════════════════════════════════════════
// MFA & AUTHENTICATION TYPES
// ═══════════════════════════════════════════

export interface MFAPendingTokenResponse {
  status: "MFA_REQUIRED";
  mfa_pending_token: string;
  expires_in: number; // seconds
  message: string;
}

export interface TotpSetupResponseWithBackupCodes {
  qr_b64: string;
  uri: string;
  is_new: boolean;
  backup_codes?: string[]; // Only returned on first setup
}

export interface Session {
  id: string;
  user_email: string;
  device_id: string;
  ip_address: string;
  device_type: string; // "browser", "mobile", "api"
  created_at: string; // ISO timestamp
  last_seen: string; // ISO timestamp
  is_active: boolean;
  device_name?: string;
  os_name?: string;
  browser_name?: string;
  browser_version?: string;
  location?: string; // "City, Country"
}

export interface MFAStatus {
  required: boolean;
  enabled: boolean;
  type: string; // "TOTP"
  mfa_verified_at?: string; // ISO timestamp
  backup_codes_remaining?: number;
}

export interface LoginSession {
  id:               string;
  user_email:       string;
  user_role:        string;
  ip_address:       string;
  browser_name:     string | null;
  browser_version:  string | null;
  os_name:          string | null;
  device_type:      "desktop" | "mobile" | "tablet" | "bot" | "other" | null;
  country:          string | null;
  city:             string | null;
  market:           string | null;
  location?:         string | null;
  session_status?:   "ACTIVE" | "TERMINATED" | "BROKEN" | "RESTARTED";
  status_reason?:    string | null;
  session_jti?:      string | null;
  login_at:         string;
  logout_at:        string | null;
  is_active:        boolean;
}

export interface LoginSessionsResponse {
  sessions: LoginSession[];
  total: number;
  page: number;
  page_size: number;
}

// ═══════════════════════════════════════════
// MULTI-AGENT ORCHESTRATOR TYPES
// ═══════════════════════════════════════════

/** Agent types available in the orchestrator */
export type AgentType =
  | "MARKET_DETECTOR"
  | "VALIDATION"
  | "OCR"
  | "RULES_ENGINE"
  | "AI"
  | "SETTLEMENT"
  | "CALCULATION"
  | "DUAL_VALIDATION"
  | "HITL"
  | "AUDIT";

/** Status of an individual agent */
export type AgentStatusType =
  | "IDLE"
  | "INITIALIZING"
  | "READY"
  | "PROCESSING"
  | "WAITING"
  | "ERROR"
  | "SHUTDOWN"
  | "idle"
  | "initializing"
  | "ready"
  | "processing"
  | "waiting"
  | "error"
  | "shutdown";

/** Agent configuration */
export interface AgentConfig {
  agent_id: string;
  agent_name: string;
  agent_type: AgentType;
  max_concurrent_tasks: number;
  timeout: number;
  retries: number;
  priority: number;
  model_name: string;
  temperature: number;
  max_tokens: number;
}

/** Metrics for a single agent */
export interface AgentMetrics {
  agent_id: string;
  agent_name: string;
  agent_type: AgentType;
  status: AgentStatusType;
  total_tasks: number;
  successful_tasks: number;
  failed_tasks: number;
  total_processing_time?: number;
  total_processing_time_ms?: number;
  avg_processing_time_ms?: number;
  success_rate: number;
  current_tasks?: number;
  current_load?: number;
  max_concurrent?: number;
  recent_errors?: string[];
}

/** Health status of all agents */
export interface AgentHealthResponse {
  status: string;
  timestamp: string;
  orchestrator?: { status: string; [key: string]: unknown };
  pools?: Record<string, {
    status: string;
    agents: Array<{
      agent_id: string;
      status: AgentStatusType;
      available: boolean;
      current_load: number;
      max_capacity: number;
      healthy?: boolean;
    }>;
    utilization?: number;
    [key: string]: unknown;
  }>;
}

/** Detailed metrics for all agent pools */
export interface AgentMetricsResponse {
  timestamp: string;
  orchestrator: {
    status: string;
    uptime_seconds: number;
    total_claims: number;
    successful_claims: number;
    failed_claims: number;
    avg_processing_time_ms: number;
    total_processing_time_ms: number;
    success_rate: number;
    queue_size: number;
    active_tasks: number;
    in_progress_claims: number;
    overall_utilization: number;
  };
  pools: Record<string, {
    pool_type: string;
    count: number;
    total_load: number;
    max_capacity: number;
    utilization: number;
    agents: AgentMetrics[];
  }>;
}

/** Queue status for HITL tasks */
export interface AgentQueueStatus {
  queue: Array<{
    task_id: string;
    claim_reference: string;
    priority: number;
    status: string;
    created_at: string;
    sla_deadline: string;
    assigned_agent?: string;
  }>;
  metrics: {
    in_progress_tasks?: number;
    priority_distribution?: Record<number, number>;
    sla_compliance?: {
      within_sla: number;
      overdue: number;
      average_response_time: number;
    };
    [key: string]: unknown;
  };
  timestamp: string;
}

/** List of all agents with their status */
export interface AgentListResponse {
  agents: Array<{
    agent_id: string;
    agent_name: string;
    agent_type: AgentType;
    status: AgentStatusType;
    metrics: AgentMetrics;
  }>;
  total_agents: number;
}

/** Status of a specific task */
export interface TaskStatus {
  task_id: string;
  claim_reference: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "TIMEOUT";
  progress: number; // 0-100
  result: unknown | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  processing_time_ms: number | null;
  agent_id: string | null;
  agent_type: AgentType | null;
  pipeline_stage: string | null;
}

/** Request to process a claim through the multi-agent pipeline */
export interface ClaimAgentProcessRequest {
  claim_reference: string;
  claim_data: {
    member_number?: string;
    policy_number?: string;
    patient_name?: string;
    provider_name?: string;
    provider_code?: string;
    service_date?: string;
    total_billed?: number | string;
    claim_type?: string;
    market_region?: string;
    network_tier?: string;
    policy_tier?: string;
    currency?: string;
    primary_diagnosis_code?: string;
    line_items?: Array<{
      line_number?: number;
      procedure_code?: string;
      billed_amount?: number | string;
    }>;
  };
  priority?: number;
  async?: boolean;
  callback_url?: string;
}

/** Response from processing a claim through the multi-agent pipeline */
export interface ClaimAgentProcessResponse {
  claim_reference: string;
  task_id: string;
  status: string;
  results: PipelineResult;
  processing_time_ms: number;
  confidence_score: number;
  routing_decision: {
    action: "AUTO_SETTEL" | "HITL_REVIEW" | "DENY";
    reason: string;
    priority: number;
    recommended_reviewer?: string;
  };
  validation_gate: {
    signals_passed: number;
    total_signals: number;
    signal_details: Record<string, { passed: boolean; score: number; message?: string }>;
    passed: boolean;
  };
  rules_engine: {
    rules_evaluated: number;
    rules_passed: number;
    rules_failed: number;
    violations: Array<{
      rule_code: string;
      rule_name: string;
      passed: boolean;
      message: string;
      severity: "CRITICAL" | "WARNING" | "INFO";
      deduction_amount?: number;
    }>;
    total_deductions: number;
  };
  ai_analysis: {
    model_used: string;
    analysis: string;
    citations: Array<{
      clause_reference: string;
      clause_title: string;
      text_excerpt: string;
      relevance_score: number;
    }>;
    policy_violations: Array<{
      code: string;
      description: string;
      severity: string;
      action: string;
    }>;
  };
  dual_validation: {
    model_a: string;
    model_b: string;
    agreement_score: number;
    disagreement_areas: string[];
    disagreement_score: number;
    recommendation: string;
  };
  settlement: {
    total_settlement: number;
    copay_amount: number;
    vat_gst_rate: number;
    vat_gst_amount: number;
    final_settlement: number;
    member_responsibility: number;
    line_items: Array<{
      line_number: number;
      procedure_code: string;
      billed_amount: number;
      allowed_amount: number;
      copay: number;
      vat: number;
      final_amount: number;
    }>;
  };
  audit_trail: {
    audit_hash: string;
    previous_hash: string;
    entries: Array<{
      timestamp: string;
      event: string;
      data: Record<string, unknown>;
    }>;
  };
  error?: string;
  timestamp: string;
}

/** Pipeline stage results aggregated */
export interface PipelineResult {
  stage: string;
  results: unknown;
  processing_time_ms: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  error?: string;
  agent_id: string;
  agent_type: AgentType;
  confidence_score: number;
}

/** Processing completeness with agent stages */
export interface AgentProcessingCompleteness {
  all_completed: boolean;
  any_failed: boolean;
  any_skipped: boolean;
  completion_percentage: number;
  stages: {
    validation: ComponentCompleteness;
    ocr: ComponentCompleteness;
    rules_engine: ComponentCompleteness;
    ai_reasoning: ComponentCompleteness;
    dual_validation: ComponentCompleteness;
    settlement_calculation: ComponentCompleteness;
    confidence_scoring: ComponentCompleteness;
    audit_trail: ComponentCompleteness;
  };
  agent_results: Record<string, PipelineResult>;
}

/** Agent pool load balancing strategy */
export type LoadBalancingStrategy =
  | "round_robin"
  | "least_loaded"
  | "priority"
  | "random";

/** Orchestrator configuration */
export interface OrchestratorConfig {
  agent_pools: {
    VALIDATION: number;
    OCR: number;
    RULES_ENGINE: number;
    AI: number;
    SETTLEMENT: number;
    CALCULATION: number;
    DUAL_VALIDATION: number;
    HITL: number;
    AUDIT: number;
  };
  primary_model: string;
  fallback_models: string[];
  load_balancing_strategy: LoadBalancingStrategy;
  max_concurrent_tasks_per_agent: number;
  task_timeout_seconds: number;
  retry_attempts: number;
}

// ═══════════════════════════════════════════
// AGENT PROCESSING STATUS FOR CLAIMS
// ═══════════════════════════════════════════

/** Extended claim response with multi-agent processing metadata */
export interface ClaimResponseWithAgent extends ClaimResponse {
  agent_processing?: {
    task_id: string;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    progress: number;
    current_stage: string;
    stages_completed: string[];
    pipeline_results: Record<string, PipelineResult>;
    agent_confidence_scores: Record<AgentType, number>;
    routing_decision: {
      action: string;
      reason: string;
      priority: number;
    };
    processing_started_at: string;
    processing_completed_at: string;
    total_processing_time_ms: number;
  };
}

// ═══════════════════════════════════════════
// CUSTOMER PAYOUT ACCOUNT TYPES
// ═══════════════════════════════════════════

export type AccountVerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "FAILED" | "BLOCKED";
export type GatewaySyncStatus = "NOT_SYNCED" | "SYNCING" | "SYNCED" | "SYNC_FAILED";
export type AccountCaptureSource = "OCR_AUTO" | "OCR_REVIEWED" | "MANUAL" | "ADVANCE_PROCESSING" | "PATIENT_PORTAL";
export type CustomerAccountType = "SAVINGS" | "CURRENT" | "CHECKING" | "NRE" | "NRO" | "WALLET" | "UPI" | "OTHER";

export interface AccountVerificationAttempt {
  id: string;
  provider: string;
  environment: GatewayEnvironment;
  status: AccountVerificationStatus;
  status_reason?: string | null;
  rail_type?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  account_holder_name?: string | null;
  holder_match_score?: number | null;
  provider_reference?: string | null;
  created_at: string;
}

export interface CustomerAccount {
  id: string;
  tenant_id: string;
  member_number: string;
  claim_reference?: string | null;
  patient_name: string;
  market_region: string;
  account_holder_name: string;
  account_type: CustomerAccountType;
  bank_name?: string | null;
  iban?: string | null;
  swift_bic?: string | null;
  account_number_last4?: string | null;
  ifsc_code?: string | null;
  upi_vpa?: string | null;
  upi_provider?: string | null;
  capture_source: AccountCaptureSource;
  ocr_confidence?: number | null;
  is_primary: boolean;
  verification_status: AccountVerificationStatus;
  verified_at?: string | null;
  verified_by?: string | null;
  gateway_summary: string;
  stripe_sync_status: GatewaySyncStatus;
  paytm_sync_status: GatewaySyncStatus;
  cashfree_sync_status: GatewaySyncStatus;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  notes?: string | null;
  latest_verification_attempt?: AccountVerificationAttempt | null;
}

export interface CustomerAccountCreate {
  member_number: string;
  claim_reference?: string;
  patient_name: string;
  market_region: string;
  account_holder_name: string;
  account_type: CustomerAccountType;
  bank_name?: string;
  iban?: string;
  swift_bic?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_vpa?: string;
  upi_provider?: string;
  capture_source?: AccountCaptureSource;
  ocr_confidence?: number;
  is_primary?: boolean;
  notes?: string;
}

export type CustomerAccountUpdate = Partial<Omit<CustomerAccountCreate, "member_number" | "patient_name" | "market_region" | "capture_source">> & {
  verification_status?: AccountVerificationStatus;
};

export interface CustomerAccountListResponse {
  accounts: CustomerAccount[];
  total: number;
  page: number;
  page_size: number;
  summary: Record<AccountVerificationStatus, number>;
}

// ─── Payment Gateway ───────────────────────────────────────────────────────────

export type GatewayName        = "stripe" | "paytm" | "cashfree";
export type GatewayEnvironment = "sandbox" | "preproduction" | "production";
export type GatewayTestStatus  = "ok" | "failed" | null;
export type PayoutStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface GatewayConfig {
  tenant_id:   string;
  gateway:     GatewayName;
  environment: GatewayEnvironment;
  is_enabled:  boolean;
  is_ready:    boolean;

  // Stripe — values masked ("••••••••") in API responses
  stripe_publishable_key?: string;
  stripe_secret_key?:      string;
  stripe_webhook_secret?:  string;
  stripe_account_id?:      string;

  // PayTM
  paytm_merchant_id?:    string;
  paytm_merchant_key?:   string;
  paytm_subwallet_guid?: string;
  paytm_website?:        string;
  paytm_industry_type?:  string;
  paytm_channel_id?:     string;

  // Cashfree verification suite
  cashfree_client_id?: string;
  cashfree_client_secret?: string;

  last_tested_at?:   string | null;
  last_test_status?: GatewayTestStatus;
  last_test_error?:  string | null;
  updated_at?:       string;
}

export interface GatewayTestResult {
  gateway: GatewayName;
  ok:      boolean;
  detail:  string;
  account?: { id: string; country: string; email: string };
}

export interface GatewayPayout {
  id:              string;
  tenant_id:       string;
  account_id:      string;
  gateway:         GatewayName;
  amount_minor:    number;
  currency:        string;
  claim_reference: string | null;
  status:          PayoutStatus;
  gateway_txn_id:  string | null;
  gateway_ref:     string | null;
  failure_reason:  string | null;
  initiated_at:    string;
  completed_at:    string | null;
  initiated_by:    string | null;
}

export interface GatewayPayoutListResponse {
  payouts:   GatewayPayout[];
  total:     number;
  page:      number;
  page_size: number;
}
