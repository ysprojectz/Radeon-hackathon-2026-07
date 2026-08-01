/**
 * Typed API client for the ACOS backend.
 * All requests go to /api/v1/proxy (rewritten by next.config.ts to avoid exposing backend URL).
 *
 * Auth: credentials:"include" on every fetch() so the browser automatically
 * sends the httpOnly access_token cookie.  No tokens are read from localStorage.
 * On 401, redirects to /login (server has already invalidated / not set the cookie).
 */
import { serverLogout } from "./auth";
import {
  normalizeClaim,
  normalizeSettlement,
  normalizeAuditTrail,
} from "./normalize";
import type {
  ClaimCreate,
  ClaimResponse,
  ClaimListResponse,
  SettlementResponse,
  AuditTrailResponse,
  AuditLogsListResponse,
  HITLDecisionCreate,
  BulkClaimDecision,
  BulkDecisionResponse,
  HITLQueueResponse,
  HITLQueueItem,
  AgentLineComparison,
  HITLAICitation,
  HITLPolicyCitation,
  HITLRegulatoryViolation,
  DashboardKPIs,
  DashboardVolumeResponse,
  ServiceHealthLive,
  AdminReportResponse,
  HealthResponse,
  PolicyResponse,
  PolicyDocumentUploadResponse,
  MemberResponse,
  OCRUploadResult,
  PolicyLibraryEntry,
  PolicyLibraryDocument,
  PolicyLibraryUploadResponse,
  PolicyMetadataResponse,
  IntegrationHealth,
  KubernetesHealth,
  SystemConfig,
  HMSSource,
  HMSSourceCreate,
  HMSTestResult,
  DuplicateClaimInfo,
  ComplianceUpdateRecord,
  ComplianceDriftResult,
  ComplianceVerificationRecord,
  WorkflowSagaRecord,
  WorkflowEventRecord,
  MFAPendingTokenResponse,
  TotpSetupResponseWithBackupCodes,
  Session,
  LoginSessionsResponse,
  AdvanceClaimCreate,
  AdvancePreauthDecisionCreate,
  AdvanceClaimResponse,
  AdvanceClaimListResponse,
  AdvanceDocumentUploadResponse,
  AdvanceDocumentProcessResponse,
  IndiaCashlessReferenceData,
  AccountVerificationStatus,
  CustomerAccountCreate,
  CustomerAccountListResponse,
  CustomerAccountUpdate,
  CustomerAccount,
  GatewaySyncStatus,
  ClaimLifecycleEvent,
  ClaimLifecycleStage,
  ClaimLifecycleSummary,
  OperationsLifecycleParams,
  OperationsLifecycleResponse,
  OperationsLifecycleStageSummary,
  ScreenAccessResponse,
} from "./types";
import { API_BASE } from "./constants";

/**
 * Map backend paths for the active runtime.
 * Local dev uses the Next.js proxy. Production EKS routes /api/* directly to
 * the API service at the ALB, so /api/v1/proxy/* would bypass Next and 404.
 *
 *   /api/v1/health   → /api/v1/proxy/health   (rewrite → {API_BASE}/api/v1/health)
 *   /api/v1/claims   → /api/v1/proxy/claims   (rewrite → {API_BASE}/api/v1/claims)
 */
function toProxyUrl(path: string): string {
  const isLocalDev = API_BASE.includes("localhost") || API_BASE.includes("127.0.0.1");
  if (!isLocalDev) {
    return path;
  }
  return `/api/v1/proxy${path.replace(/^\/api\/v1/, "")}`;
}

// ─── Custom error ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public errorCode?: string
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/** Map HTTP status codes to user-friendly messages. */
const STATUS_FRIENDLY: Record<number, string> = {
  422: "Some fields have invalid values",
  409: "A duplicate claim was detected",
  413: "File too large",
  503: "Service temporarily unavailable — please try again",
};

/** Map Pydantic field paths to user-readable labels. */
const FIELD_LABELS: Record<string, string> = {
  service_date:     "Service Date",
  date_of_service:  "Service Date",
  member_id:        "Member ID",
  member_number:    "Member ID",
  amount:           "Claim Amount",
  total_billed:     "Claim Amount",
  diagnosis_code:   "Diagnosis Code",
  primary_diagnosis_code: "Diagnosis Code",
};

/**
 * Formats any caught error into a single human-readable string.
 * Safe to call with any thrown value — never throws itself.
 */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const friendly = STATUS_FRIENDLY[error.status];
    // For 422 the detail already contains field-level messages from parseApiErrorDetail;
    // prefix with the friendly summary so users see both.
    if (friendly && error.status === 422) {
      const detail = error.detail && error.detail !== `HTTP ${error.status}`
        ? error.detail
        : "";
      return detail ? `${friendly}: ${detail}` : friendly;
    }
    if (friendly) return friendly;
    return error.detail || `Request failed (HTTP ${error.status})`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred";
}

/** Extract and format error detail from a failed API response. */
function formatApiErrorBody(body: unknown, fallback: string): string {
  let detail = fallback;
  try {
    const envelope = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const raw = envelope.detail ?? envelope.error ?? detail;

    // Handle Pydantic v2 validation error arrays
    if (Array.isArray(raw)) {
      detail = raw
        .map((e: { msg?: string; loc?: unknown[] }) => {
          if (!e.msg) return JSON.stringify(e);
          if (Array.isArray(e.loc) && e.loc.length > 1) {
            const fieldKey = String(e.loc[e.loc.length - 1]);
            const label = FIELD_LABELS[fieldKey] ?? e.loc.slice(1).join(".");
            return `${label}: ${e.msg}`;
          }
          return e.msg;
        })
        .join("; ");
    } else if (typeof raw === "object" && raw !== null) {
      // Handle object error format like {message: "...", error: "..."}
      const r = raw as Record<string, unknown>;
      detail = (typeof r.message === "string" ? r.message : null)
            ?? (typeof r.error  === "string" ? r.error  : null)
            ?? JSON.stringify(r);
    } else {
      detail = String(raw);
    }
  } catch {
    // Formatting failed — keep the fallback detail
  }
  return detail;
}

async function parseApiErrorDetail(response: Response, defaultDetail?: string): Promise<string> {
  const fallback = defaultDetail ?? `HTTP ${response.status}`;
  try {
    return formatApiErrorBody(await response.json(), fallback);
  } catch {
    // JSON parse failed — keep the default detail
    return fallback;
  }
}

/** Thrown when a 409 Conflict is returned because the uploaded PDF was already
 *  submitted before. The `originalClaim` contains full details of the first
 *  submission so the UI can show an informative confirmation dialog. */
export class DuplicateClaimError extends Error {
  readonly status = 409;
  constructor(
    public message: string,
    public originalClaim: {
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
  ) {
    super(message);
    this.name = "DuplicateClaimError";
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token:  string;
  refresh_token: string;
  token_type:    string;
  expires_in:    number;
}

/** Exchange email + password for JWT tokens (form-encoded, no auth header).
 *  credentials:"include" is REQUIRED — without it the browser discards Set-Cookie. */
export async function login(email: string, password: string, market?: string): Promise<LoginResponse | MFAPendingTokenResponse> {
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);
  if (market) form.set("market", market);

  const res = await fetch(toProxyUrl("/api/v1/auth/login"), {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/x-www-form-urlencoded" },
    body:        form.toString(),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const raw  = body.detail ?? "Login failed";
    throw new ApiError(res.status, Array.isArray(raw) ? raw.map((e: { msg?: string }) => e.msg).join("; ") : String(raw));
  }
  return res.json() as Promise<LoginResponse | MFAPendingTokenResponse>;
}

/** Fetch the currently-authenticated user profile. */
export async function getMe(): Promise<import("./auth").StoredUser> {
  return apiFetch<import("./auth").StoredUser>("/api/v1/auth/me");
}

/** Switch the active market context — re-issues the access token with the new market claim.
 *  No re-login required. The new market is reflected immediately in the Topbar badge. */
export async function switchMarket(market: string): Promise<void> {
  await apiFetch("/api/v1/auth/switch-market", {
    method: "POST",
    body:   JSON.stringify({ market }),
  });
}

// ─── TOTP Authenticator ───────────────────────────────────────────────────────

export interface TotpHasSetupResponse { configured: boolean; }
export type TotpSetupResponse = TotpSetupResponseWithBackupCodes;
export interface TotpLoginResponse    { access_token: string; token_type: string; expires_in: number; }

/** Check if the email has an authenticator app configured (no user enumeration). */
export async function totpHasSetup(email: string): Promise<TotpHasSetupResponse> {
  const res = await fetch("/api/v1/proxy/auth/totp/has-setup", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify({ email }),
  });
  if (!res.ok) return { configured: false };
  return res.json() as Promise<TotpHasSetupResponse>;
}

/** Generate (or re-show) the QR code PNG for the email.
 *  Returns a base64-encoded PNG and the otpauth:// URI. */
export async function totpSetup(email: string): Promise<TotpSetupResponse> {
  const res = await fetch("/api/v1/proxy/auth/totp/setup", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? "Setup failed");
  }
  return res.json() as Promise<TotpSetupResponse>;
}

/** Verify a 6-digit TOTP code with optional mfa_pending_token — issues JWT cookie on success. */
export async function totpLogin(email: string, code: string, mfaPendingToken?: string): Promise<TotpLoginResponse> {
  const body: Record<string, unknown> = { email, code };
  if (mfaPendingToken) {
    body.mfa_pending_token = mfaPendingToken;
  }

  const res = await fetch("/api/v1/proxy/auth/totp/login", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyRes = await res.json().catch(() => ({}));
    throw new ApiError(res.status, bodyRes.detail ?? "Verification failed");
  }
  return res.json() as Promise<TotpLoginResponse>;
}

// ─── Session Management ────────────────────────────────────────────────────

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

/** Fetch all active sessions for the current user. */
export async function listActiveSessions(): Promise<SessionListResponse> {
  return apiFetch<SessionListResponse>("/api/v1/auth/sessions");
}

/** Revoke a specific session (logout from device). */
export async function revokeSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/v1/auth/sessions/${sessionId}/revoke`, {
    method: "POST",
  });
}

// ─── MFA Management ───────────────────────────────────────────────────────

/** Reset a user's TOTP (admin only). */
export async function resetUserMFA(
  email: string,
  action: "reset_secret" | "disable_requirement",
  reason: string
): Promise<{ message: string; action: string }> {
  return apiFetch(`/api/v1/admin/users/${email}/mfa/reset`, {
    method: "POST",
    body: JSON.stringify({ action, reason }),
  });
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = toProxyUrl(path);
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };

  // credentials:"include" ensures the browser sends httpOnly cookies automatically.
  // No localStorage token injection — tokens are managed entirely by the server.
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    // 401 → cookies are invalid; clear server-side session and redirect to /login
    if (res.status === 401 && typeof window !== "undefined") {
      // Don't redirect if already on a public page
      const publicPaths = ["/login", "/landing"];
      if (!publicPaths.some((p) => window.location.pathname.startsWith(p))) {
        serverLogout().finally(() => {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        });
      }
      throw new ApiError(401, "Session expired. Redirecting to login…");
    }

    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const raw = body.detail ?? body.error ?? detail;
      // Pydantic v2 returns detail as an array of {type,loc,msg,input,ctx} objects
      if (Array.isArray(raw)) {
        detail = raw
          .map((e: { msg?: string; loc?: unknown[] }) => {
            if (!e.msg) return JSON.stringify(e);
            if (Array.isArray(e.loc) && e.loc.length > 1) {
              const fieldKey = String(e.loc[e.loc.length - 1]);
              const label = FIELD_LABELS[fieldKey] ?? e.loc.slice(1).join(".");
              return `${label}: ${e.msg}`;
            }
            return e.msg;
          })
          .join("; ");
      } else {
        detail = String(raw);
      }
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, detail);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/v1/health");
}

// ─── Claims ───────────────────────────────────────────────────────────────────

type ApiRecord = Record<string, unknown>;

function recordOf(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ApiRecord
    : {};
}

function stringOf(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstValue(record: ApiRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function firstString(record: ApiRecord, keys: string[], fallback = ""): string {
  const value = firstValue(record, keys);
  return value == null ? fallback : stringOf(value, fallback);
}

function firstNumber(record: ApiRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberOf(record[key]);
    if (value != null) return value;
  }
  return null;
}

function firstArray(record: ApiRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function normalizeLifecycleStatus(value: unknown, fallback = "PENDING"): ClaimLifecycleSummary["status"] {
  const status = stringOf(value, fallback).trim();
  return (status || fallback).toUpperCase() as ClaimLifecycleSummary["status"];
}

function humanizeLifecycleLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Lifecycle";
}

function normalizeLifecycleEvent(raw: unknown, index: number, stageFallback?: string): ClaimLifecycleEvent {
  const event = recordOf(raw);
  const stage = firstString(event, ["stage", "stage_key", "current_stage"], stageFallback ?? "");
  const label = firstString(event, ["label", "event_label", "name"], firstString(event, ["event_type", "state"], stage ? humanizeLifecycleLabel(stage) : `Event ${index + 1}`));
  const payload = recordOf(event.payload);
  return {
    id: firstString(event, ["id", "event_id"], String(index + 1)),
    stage,
    stage_label: firstString(event, ["stage_label"], stage ? humanizeLifecycleLabel(stage) : undefined),
    status: firstValue(event, ["status", "state"]) == null ? undefined : normalizeLifecycleStatus(firstValue(event, ["status", "state"])),
    event_type: firstString(event, ["event_type", "type"], label),
    label,
    description: firstString(event, ["description", "reason", "summary"], firstString(payload, ["summary"], label)),
    timestamp: firstString(event, ["timestamp", "created_at", "updated_at", "occurred_at"], undefined),
    started_at: firstString(event, ["started_at"], undefined) || null,
    completed_at: firstString(event, ["completed_at", "finished_at"], undefined) || null,
    duration_ms: firstNumber(event, ["duration_ms", "elapsed_ms"]),
    age_seconds: firstNumber(event, ["age_seconds", "age_secs"]),
    actor_type: firstString(event, ["actor_type", "actor"], undefined),
    actor_id: firstString(event, ["actor_id"], undefined) || null,
    service_name: firstString(event, ["service_name", "service", "source_service"], undefined),
    blocker: firstString(event, ["blocker", "blocked_reason", "error", "reason"], undefined) || null,
    next_action: firstString(event, ["next_action", "recommended_action"], undefined) || null,
    metadata: recordOf(event.metadata ?? event.event_data ?? event.details_json ?? event.payload),
  };
}

function normalizeLifecycleStage(raw: unknown, index: number): ClaimLifecycleStage {
  const stage = recordOf(raw);
  const key = firstString(stage, ["stage", "stage_key", "id", "name"], `stage_${index + 1}`);
  const label = firstString(stage, ["label", "stage_label", "name"], humanizeLifecycleLabel(key));
  return {
    id: firstString(stage, ["id"], key),
    stage: key,
    label,
    status: normalizeLifecycleStatus(firstValue(stage, ["status", "state"]), "NOT_STARTED"),
    started_at: firstString(stage, ["started_at"], undefined) || null,
    completed_at: firstString(stage, ["completed_at", "finished_at"], undefined) || null,
    updated_at: firstString(stage, ["updated_at"], undefined) || null,
    duration_ms: firstNumber(stage, ["duration_ms", "elapsed_ms"]),
    age_seconds: firstNumber(stage, ["age_seconds", "age_secs"]),
    sla_due_at: firstString(stage, ["sla_due_at", "deadline_at", "due_at"], undefined) || null,
    sla_seconds: firstNumber(stage, ["sla_seconds", "sla_target_seconds"]),
    blocker: firstString(stage, ["blocker", "blocked_reason", "error"], undefined) || null,
    next_action: firstString(stage, ["next_action", "recommended_action"], undefined) || null,
    events: firstArray(stage, ["events"]).map((event, eventIndex) => normalizeLifecycleEvent(event, eventIndex, key)),
    metadata: recordOf(stage.metadata ?? stage.details),
  };
}

function normalizePipelineReportLifecycle(raw: ApiRecord, referenceFallback = ""): ClaimLifecycleSummary | null {
  const report = recordOf(raw.pipeline_stage_report);
  const stageRows = firstArray(report, ["stages"]);
  if (!stageRows.length) return null;
  const stages = stageRows.map(normalizeLifecycleStage);
  const current = [...stages].reverse().find((stage) => stage.status !== "NOT_STARTED") ?? stages[0];
  return {
    claim_reference: firstString(raw, ["claim_reference"], referenceFallback),
    current_stage: current.stage,
    current_stage_label: current.label,
    status: normalizeLifecycleStatus(report.status ?? current.status, stringOf(raw.status, "PENDING")),
    age_seconds: null,
    age_ms: firstNumber(report, ["total_duration_ms"]),
    started_at: firstString(raw, ["date_received"], undefined) || null,
    updated_at: firstString(raw, ["date_adjudicated", "date_settled"], undefined) || null,
    sla_due_at: null,
    sla_status: "UNKNOWN",
    blocker: null,
    next_action: null,
    patient_name: firstString(raw, ["patient_name"], undefined) || null,
    member_number: firstString(raw, ["member_number"], undefined) || null,
    claim_type: firstString(raw, ["claim_type"], undefined) || null,
    market_region: firstString(raw, ["market_region"], undefined) || null,
    currency: firstString(raw, ["currency"], undefined) || null,
    total_billed: raw.total_billed as string | number | null,
    total_settlement: (raw.total_settlement ?? raw.total_settled_amount) as string | number | null,
    claim_status: firstString(raw, ["status"], undefined) || null,
    stages,
    events: stages.flatMap((stage) => stage.events ?? []),
    metadata: recordOf(report),
  };
}

function normalizeClaimLifecycle(raw: unknown, referenceFallback = ""): ClaimLifecycleSummary | null {
  const root = recordOf(raw);
  const nested = recordOf(root.lifecycle ?? root.claim_lifecycle);
  const source = Object.keys(nested).length ? nested : root;
  const pipelineFallback = normalizePipelineReportLifecycle(root, referenceFallback);
  const explicitStage = firstValue(source, ["current_stage", "stage", "stage_key"]);
  const explicitEvents = firstArray(source, ["events", "timeline", "event_stream"]);
  const explicitStages = firstArray(source, ["stages", "stage_summary", "stage_statuses", "expected_stages"]);
  const claimReference = firstString(source, ["claim_reference", "reference"], firstString(root, ["claim_reference"], referenceFallback));

  if (!claimReference && !explicitStage && !explicitEvents.length && !explicitStages.length) {
    return pipelineFallback;
  }

  const stages = explicitStages.length
    ? explicitStages.map(normalizeLifecycleStage)
    : (pipelineFallback?.stages ?? []);
  const events = explicitEvents.length
    ? explicitEvents.map((event, index) => normalizeLifecycleEvent(event, index))
    : (pipelineFallback?.events ?? []);
  const currentStage = firstString(
    source,
    ["current_stage", "stage", "stage_key"],
    pipelineFallback?.current_stage ?? stages.find((stage) => stage.status !== "NOT_STARTED")?.stage ?? "submitted"
  );
  const currentStageLabel = firstString(
    source,
    ["current_stage_label", "stage_label", "label"],
    stages.find((stage) => stage.stage === currentStage)?.label ?? humanizeLifecycleLabel(currentStage)
  );

  return {
    claim_reference: claimReference,
    current_stage: currentStage,
    current_stage_label: currentStageLabel,
    status: normalizeLifecycleStatus(firstValue(source, ["status", "state", "stage_status", "current_stage_status"]), pipelineFallback?.status ?? stringOf(root.status, "PENDING")),
    age_seconds: firstNumber(source, ["age_seconds", "age_secs", "current_stage_age_seconds", "current_age_seconds"]) ?? pipelineFallback?.age_seconds ?? null,
    age_ms: firstNumber(source, ["age_ms", "current_stage_age_ms"]) ?? pipelineFallback?.age_ms ?? null,
    started_at: firstString(source, ["started_at", "created_at", "current_stage_started_at"], pipelineFallback?.started_at ?? firstString(root, ["date_received"], undefined)) || null,
    updated_at: firstString(source, ["updated_at", "lifecycle_updated_at"], pipelineFallback?.updated_at ?? firstString(root, ["date_adjudicated", "date_settled"], undefined)) || null,
    sla_due_at: firstString(source, ["sla_due_at", "deadline_at", "due_at"], pipelineFallback?.sla_due_at ?? undefined) || null,
    sla_status: firstString(
      source,
      ["sla_status"],
      source.is_stuck === true ? "BREACHED" : pipelineFallback?.sla_status ?? "UNKNOWN"
    ) as ClaimLifecycleSummary["sla_status"],
    blocker: firstString(source, ["blocker", "blocked_reason", "stuck_reason"], pipelineFallback?.blocker ?? undefined) || null,
    next_action: firstString(source, ["next_action", "recommended_action"], pipelineFallback?.next_action ?? undefined) || null,
    patient_name: firstString(source, ["patient_name"], firstString(root, ["patient_name"], pipelineFallback?.patient_name ?? undefined)) || null,
    member_number: firstString(source, ["member_number"], firstString(root, ["member_number"], pipelineFallback?.member_number ?? undefined)) || null,
    claim_type: firstString(source, ["claim_type"], firstString(root, ["claim_type"], pipelineFallback?.claim_type ?? undefined)) || null,
    market_region: firstString(source, ["market_region"], firstString(root, ["market_region"], pipelineFallback?.market_region ?? undefined)) || null,
    currency: firstString(source, ["currency"], firstString(root, ["currency"], pipelineFallback?.currency ?? undefined)) || null,
    total_billed: (source.total_billed ?? root.total_billed ?? pipelineFallback?.total_billed ?? null) as string | number | null,
    total_settlement: (source.total_settlement ?? source.total_settled_amount ?? root.total_settlement ?? root.total_settled_amount ?? pipelineFallback?.total_settlement ?? null) as string | number | null,
    claim_status: firstString(source, ["claim_status"], firstString(root, ["status"], pipelineFallback?.claim_status ?? undefined)) || null,
    stages,
    events,
    metadata: recordOf(source.metadata),
  };
}

function normalizeStageSummary(raw: unknown, index: number): OperationsLifecycleStageSummary {
  const stage = recordOf(raw);
  const key = firstString(stage, ["stage", "stage_key", "id", "name"], `stage_${index + 1}`);
  return {
    stage: key,
    label: firstString(stage, ["label", "stage_label", "name"], humanizeLifecycleLabel(key)),
    total: firstNumber(stage, ["total", "count"]) ?? 0,
    in_progress: firstNumber(stage, ["in_progress", "processing"]) ?? 0,
    completed: firstNumber(stage, ["completed", "done"]) ?? 0,
    failed: firstNumber(stage, ["failed", "error"]) ?? 0,
    skipped: firstNumber(stage, ["skipped"]) ?? 0,
    blocked: firstNumber(stage, ["blocked"]) ?? 0,
    stuck: firstNumber(stage, ["stuck"]) ?? 0,
    sla_breached: firstNumber(stage, ["sla_breached", "breached"]) ?? 0,
    avg_age_seconds: firstNumber(stage, ["avg_age_seconds", "average_age_seconds"]),
  };
}

function deriveStageSummary(claims: ClaimLifecycleSummary[]): OperationsLifecycleStageSummary[] {
  const byStage = new Map<string, OperationsLifecycleStageSummary>();
  for (const claim of claims) {
    const stageKey = claim.current_stage || "unknown";
    const current = byStage.get(stageKey) ?? {
      stage: stageKey,
      label: claim.current_stage_label || humanizeLifecycleLabel(stageKey),
      total: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
      stuck: 0,
      sla_breached: 0,
      avg_age_seconds: null,
    };
    current.total += 1;
    if (/COMPLETE|SETTLED|PAID|APPROVED/.test(claim.status)) current.completed += 1;
    else if (/FAIL|ERROR|DENIED/.test(claim.status)) current.failed += 1;
    else if (/SKIP/.test(claim.status)) current.skipped += 1;
    else current.in_progress += 1;
    if (/BLOCK/.test(claim.status) || claim.blocker) current.blocked += 1;
    if (/STUCK/.test(claim.status)) current.stuck += 1;
    if (/BREACH/.test(claim.sla_status ?? "") || /SLA/.test(claim.status)) current.sla_breached += 1;
    byStage.set(stageKey, current);
  }
  return Array.from(byStage.values());
}

function normalizeOperationsLifecycle(raw: unknown): OperationsLifecycleResponse {
  const root = recordOf(raw);
  const summary = recordOf(root.summary ?? root.metrics);
  const claims = firstArray(root, ["claims", "operations", "items", "records"])
    .map((item) => normalizeClaimLifecycle(item))
    .filter((item): item is ClaimLifecycleSummary => Boolean(item));
  const stageSummary = firstArray(root, ["stage_summary", "stages", "stage_cards"])
    .map(normalizeStageSummary)
    .filter((stage) => stage.total > 0 || stage.in_progress > 0 || stage.completed > 0 || stage.failed > 0 || stage.skipped > 0 || stage.blocked > 0 || stage.stuck > 0 || stage.sla_breached > 0);
  const derivedStageSummary = stageSummary.length ? stageSummary : deriveStageSummary(claims);
  return {
    generated_at: firstString(root, ["generated_at", "updated_at"], undefined),
    total_claims: firstNumber(root, ["total_claims", "total"]) ?? firstNumber(summary, ["total_claims", "total"]) ?? claims.length,
    stuck_count: firstNumber(root, ["stuck_count"]) ?? firstNumber(summary, ["stuck_count", "stuck"]) ?? claims.filter((claim) => /STUCK/.test(claim.status)).length,
    blocked_count: firstNumber(root, ["blocked_count"]) ?? firstNumber(summary, ["blocked_count", "blocked"]) ?? claims.filter((claim) => claim.blocker || /BLOCK/.test(claim.status)).length,
    sla_breached_count: firstNumber(root, ["sla_breached_count"]) ?? firstNumber(summary, ["sla_breached_count", "sla_breached"]) ?? claims.filter((claim) => /BREACH/.test(claim.sla_status ?? "") || /SLA/.test(claim.status)).length,
    stage_summary: derivedStageSummary,
    claims,
    page: firstNumber(root, ["page"]) ?? undefined,
    page_size: firstNumber(root, ["page_size"]) ?? undefined,
    total: firstNumber(root, ["total"]) ?? undefined,
  };
}

export interface GetClaimsParams {
  status?: string;
  market_region?: string;
  page?: number;
  page_size?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  service_date_from?: string;
  service_date_to?: string;
  received_date_from?: string;
  received_date_to?: string;
}

export async function getClaims(
  params: GetClaimsParams = {}
): Promise<ClaimListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.market_region) qs.set("market_region", params.market_region);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.search) qs.set("search", params.search);
  if (params.sort_by) qs.set("sort_by", params.sort_by);
  if (params.sort_order) qs.set("sort_order", params.sort_order);
  if (params.service_date_from) qs.set("service_date_from", params.service_date_from);
  if (params.service_date_to) qs.set("service_date_to", params.service_date_to);
  if (params.received_date_from) qs.set("received_date_from", params.received_date_from);
  if (params.received_date_to) qs.set("received_date_to", params.received_date_to);
  const query = qs.toString();
  const raw = await apiFetch<{ claims: unknown[]; total: number; page: number; page_size: number }>(
    `/api/v1/claims${query ? `?${query}` : ""}`
  );
  return {
    ...raw,
    claims: (raw.claims ?? []).map((item) => ({
      ...normalizeClaim(item),
      lifecycle: normalizeClaimLifecycle(item),
    })),
  };
}

export async function getClaim(reference: string): Promise<ClaimResponse> {
  const raw = await apiFetch<Record<string, unknown>>(`/api/v1/claims/${reference}`);
  return {
    ...normalizeClaim(raw),
    lifecycle: normalizeClaimLifecycle(raw, reference),
  };
}

export async function getClaimAudit(
  reference: string
): Promise<AuditTrailResponse> {
  // API returns { claim_reference, audit_trail: [...], total_entries, chain_integrity }
  // Normalize to the AuditTrailResponse shape expected by components.
  const raw = await apiFetch<{
    claim_reference: string;
    audit_trail: unknown[];
    total_entries: number;
    chain_integrity: unknown;
  }>(`/api/v1/claims/${reference}/audit`);
  return normalizeAuditTrail({
    claim_reference: raw.claim_reference,
    entries: raw.audit_trail ?? [],
    total_entries: raw.total_entries ?? (raw.audit_trail ?? []).length,
    chain_valid: !!(raw.chain_integrity),
  });
}

export async function getOperationsLifecycle(
  params: OperationsLifecycleParams = {}
): Promise<OperationsLifecycleResponse> {
  const qs = new URLSearchParams();
  if (params.stage) qs.set("stage", params.stage);
  if (params.status) qs.set("state", params.status);
  if (params.market_region) qs.set("market_region", params.market_region);
  if (params.search) qs.set("search", params.search);
  if (params.only_stuck) qs.set("stuck_only", "true");
  if (params.only_sla_breached) qs.set("only_sla_breached", "true");
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const query = qs.toString();
  const raw = await apiFetch<unknown>(`/api/v1/operations/lifecycle${query ? `?${query}` : ""}`);
  return normalizeOperationsLifecycle(raw);
}

export async function getClaimLifecycle(reference: string): Promise<ClaimLifecycleSummary> {
  const raw = await apiFetch<unknown>(`/api/v1/claims/${encodeURIComponent(reference)}/lifecycle`);
  return normalizeClaimLifecycle(raw, reference) ?? {
    claim_reference: reference,
    current_stage: "unknown",
    current_stage_label: "Unknown",
    status: "PENDING",
    age_seconds: null,
    age_ms: null,
    started_at: null,
    updated_at: null,
    sla_due_at: null,
    sla_status: "UNKNOWN",
    blocker: null,
    next_action: null,
    stages: [],
    events: [],
  };
}

export async function getClaimSettlement(
  reference: string
): Promise<SettlementResponse | null> {
  // API returns { claim_reference, settlement: {...}|null, line_items: [...],
  //               policy_citations: [...], ai_citations: [...] }
  // Flatten to a single SettlementResponse object, or null if no settlement data.
  const raw = await apiFetch<{
    claim_reference:   string;
    settlement:        Record<string, unknown> | null;
    line_items:        unknown[];
    policy_citations?: unknown[];
    ai_citations?:     unknown[];
  }>(`/api/v1/claims/${reference}/settlement`);
  const merged = {
    ...(raw.settlement ?? {}),
    claim_reference:  raw.claim_reference,
    line_items:       raw.line_items       ?? [],
    // Top-level citation arrays must be forwarded so normalizeSettlement can merge them
    policy_citations: raw.policy_citations ?? [],
    ai_citations:     raw.ai_citations     ?? [],
  };
  return normalizeSettlement(merged);
}

export async function submitClaimJSON(
  payload: ClaimCreate,
  options?: { signal?: AbortSignal }
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>("/api/v1/claims", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
}

export async function registerAdvanceClaim(
  payload: AdvanceClaimCreate
): Promise<AdvanceClaimResponse> {
  return apiFetch<AdvanceClaimResponse>("/api/v1/claims/advance/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadAdvanceClaimDocuments(
  files: File[]
): Promise<AdvanceDocumentUploadResponse> {
  const form = new FormData();
  form.append("market_region", "INDIA");
  files.forEach((file) => form.append("files", file));

  const res = await fetch("/api/v1/proxy/claims/advance/documents", {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // keep fallback below
    }
    throw new ApiError(res.status, formatApiErrorBody(body, `HTTP ${res.status}`));
  }

  const data = await res.json() as AdvanceDocumentUploadResponse;
  return {
    ...data,
    documents: data.documents.map((doc) => ({
      ...doc,
      document_url: toProxyUrl(doc.document_url),
    })),
  };
}

export async function processAdvanceClaimDocuments(
  documentUrls: string[]
): Promise<AdvanceDocumentProcessResponse> {
  return apiFetch<AdvanceDocumentProcessResponse>("/api/v1/claims/advance/documents/process", {
    method: "POST",
    body: JSON.stringify({ document_urls: documentUrls }),
  });
}

export async function listAdvanceClaims(params: { skip?: number; limit?: number } = {}): Promise<AdvanceClaimListResponse> {
  const qs = new URLSearchParams();
  if (params.skip !== undefined) qs.set("skip", String(params.skip));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiFetch<AdvanceClaimListResponse>(`/api/v1/claims/advance${query ? `?${query}` : ""}`);
}

export async function getAdvanceClaim(reference: string): Promise<AdvanceClaimResponse> {
  return apiFetch<AdvanceClaimResponse>(`/api/v1/claims/advance/${encodeURIComponent(reference)}`);
}

export async function submitAdvancePreauthDecision(
  reference: string,
  payload: AdvancePreauthDecisionCreate
): Promise<AdvanceClaimResponse> {
  return apiFetch<AdvanceClaimResponse>(
    `/api/v1/claims/advance/${encodeURIComponent(reference)}/preauth/decision`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function getAdvanceClaimReferenceData(): Promise<IndiaCashlessReferenceData> {
  return apiFetch<IndiaCashlessReferenceData>("/api/v1/claims/advance/reference-data");
}

// ─── Customer payout accounts ─────────────────────────────────────────────

export interface GetCustomerAccountsParams {
  page?: number;
  page_size?: number;
  market_region?: string;
  verification_status?: AccountVerificationStatus | "ALL";
  member_number?: string;
  search?: string;
}

export async function getCustomerAccounts(
  params: GetCustomerAccountsParams = {}
): Promise<CustomerAccountListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.market_region && params.market_region !== "ALL") qs.set("market_region", params.market_region);
  if (params.verification_status && params.verification_status !== "ALL") qs.set("verification_status", params.verification_status);
  if (params.member_number) qs.set("member_number", params.member_number);
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();
  return apiFetch<CustomerAccountListResponse>(`/api/v1/accounts${query ? `?${query}` : ""}`);
}

export async function createCustomerAccount(payload: CustomerAccountCreate): Promise<CustomerAccount> {
  return apiFetch<CustomerAccount>("/api/v1/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCustomerAccount(id: string, payload: CustomerAccountUpdate): Promise<CustomerAccount> {
  return apiFetch<CustomerAccount>(`/api/v1/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function verifyCustomerAccount(
  id: string,
  verification_status: AccountVerificationStatus,
  notes?: string
): Promise<CustomerAccount> {
  return apiFetch<CustomerAccount>(`/api/v1/accounts/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ status: verification_status, notes }),
  });
}

export async function runCustomerAccountBankVerification(id: string): Promise<CustomerAccount> {
  return apiFetch<CustomerAccount>(`/api/v1/accounts/${id}/bank-verification`, {
    method: "POST",
  });
}

export async function updateCustomerAccountGatewaySync(
  id: string,
  gateway: "stripe" | "paytm" | "cashfree",
  status: GatewaySyncStatus,
  error?: string
): Promise<CustomerAccount> {
  return apiFetch<CustomerAccount>(`/api/v1/accounts/${id}/gateway-sync`, {
    method: "POST",
    body: JSON.stringify({ gateway, status, error }),
  });
}

// ─── Payment Gateway ───────────────────────────────────────────────────────────

import type {
  GatewayConfig,
  GatewayName,
  GatewayTestResult,
  GatewayPayout,
  GatewayPayoutListResponse,
  GatewayEnvironment,
} from "./types";

export async function getGatewayConfigs(): Promise<{ gateways: GatewayConfig[] }> {
  return apiFetch<{ gateways: GatewayConfig[] }>("/api/v1/gateway/config");
}

export async function getGatewayConfig(gateway: GatewayName): Promise<GatewayConfig> {
  return apiFetch<GatewayConfig>(`/api/v1/gateway/config/${gateway}`);
}

export async function saveStripeConfig(body: {
  environment: GatewayEnvironment;
  is_enabled: boolean;
  stripe_publishable_key?: string;
  stripe_secret_key?: string;
  stripe_webhook_secret?: string;
  stripe_account_id?: string;
}): Promise<GatewayConfig> {
  return apiFetch<GatewayConfig>("/api/v1/gateway/config/stripe", {
    method: "PUT",
    body:   JSON.stringify(body),
  });
}

export async function savePaytmConfig(body: {
  environment: GatewayEnvironment;
  is_enabled: boolean;
  paytm_merchant_id?: string;
  paytm_merchant_key?: string;
  paytm_subwallet_guid?: string;
  paytm_website?: string;
  paytm_industry_type?: string;
  paytm_channel_id?: string;
}): Promise<GatewayConfig> {
  return apiFetch<GatewayConfig>("/api/v1/gateway/config/paytm", {
    method: "PUT",
    body:   JSON.stringify(body),
  });
}

export async function saveCashfreeConfig(body: {
  environment: GatewayEnvironment;
  is_enabled: boolean;
  cashfree_client_id?: string;
  cashfree_client_secret?: string;
}): Promise<GatewayConfig> {
  return apiFetch<GatewayConfig>("/api/v1/gateway/config/cashfree", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function testGatewayConnection(gateway: GatewayName): Promise<GatewayTestResult> {
  return apiFetch<GatewayTestResult>(`/api/v1/gateway/config/${gateway}/test`, { method: "POST" });
}

export async function createCashfreeOrder(body: {
  order_amount: number;
  order_currency: string;
  order_id: string;
  customer_id: string;
  customer_phone: string;
  return_url: string;
}): Promise<{
  order_id: string;
  payment_session_id?: string;
  order_status?: string;
  cf_order_id?: string;
}> {
  return apiFetch("/api/v1/gateway/cashfree/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getCashfreeOrderPayments(orderId: string): Promise<unknown> {
  return apiFetch(`/api/v1/gateway/cashfree/orders/${encodeURIComponent(orderId)}/payments`);
}

export async function initiateGatewayPayout(body: {
  account_id:       string;
  gateway:          "stripe" | "paytm";
  amount_minor:     number;
  currency:         string;
  claim_reference?: string;
  description?:     string;
}): Promise<GatewayPayout> {
  return apiFetch<GatewayPayout>("/api/v1/gateway/payouts", {
    method: "POST",
    body:   JSON.stringify(body),
  });
}

export async function getGatewayPayouts(params?: {
  page?: number;
  page_size?: number;
  gateway?: GatewayName;
  status?: string;
}): Promise<GatewayPayoutListResponse> {
  const qs = new URLSearchParams();
  if (params?.page)      qs.set("page",      String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  if (params?.gateway)   qs.set("gateway",   params.gateway);
  if (params?.status)    qs.set("status",    params.status);
  const q = qs.toString();
  return apiFetch<GatewayPayoutListResponse>(`/api/v1/gateway/payouts${q ? `?${q}` : ""}`);
}

// ─── (original file continues) ────────────────────────────────────────────────

export async function uploadClaimPDF(
  file: File,
  overrides: {
    member_number?: string;
    provider_code?: string;
    market_region?: string;
    policy_number?: string;
    confirm_duplicate?: boolean;
  } = {},
  onProgress?: (progress: { step: string; status: string; message: string; progress: number; details?: Record<string, unknown> }) => void
): Promise<OCRUploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (overrides.member_number)
    form.append("member_number", overrides.member_number);
  if (overrides.provider_code)
    form.append("provider_code", overrides.provider_code);
  if (overrides.market_region)
    form.append("market_region", overrides.market_region);
  if (overrides.policy_number)
    form.append("policy_number", overrides.policy_number);
  if (overrides.confirm_duplicate)
    form.append("confirm_duplicate", "true");

  const url = "/api/v1/proxy/claims/upload";
  const res = await fetch(url, { method: "POST", credentials: "include", body: form });
  
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
      const detail = body && typeof body === "object"
        ? (body as { detail?: { duplicate?: boolean; message?: string; original_claim?: DuplicateClaimInfo } }).detail
        : undefined;
      if (res.status === 409 && detail?.duplicate === true) {
        throw new DuplicateClaimError(
          detail.message ?? "Duplicate document detected.",
          detail.original_claim as DuplicateClaimInfo
        );
      }
    } catch (thrown) {
      if (thrown instanceof DuplicateClaimError) throw thrown;
    }

    const detail = formatApiErrorBody(body, `HTTP ${res.status}`);
    throw new ApiError(res.status, detail);
  }

  // Helper to normalize the raw claim response with OCR metadata
  const normalizeResult = (raw: Record<string, unknown>): OCRUploadResult => {
    if (raw.claim_reference) {
      const meta = (raw._ocr_metadata ?? {}) as Record<string, unknown>;
      const rawConf = typeof meta.ocr_confidence === "number" ? meta.ocr_confidence : 0;
      const extracted =
        (meta.extracted_fields as Record<string, unknown> | undefined) ??
        (raw.extracted_fields as Record<string, unknown> | undefined) ??
        {};
      const confidences =
        (meta.field_confidences as Record<string, unknown> | undefined) ??
        (raw.field_confidences as Record<string, unknown> | undefined) ??
        {};
      return {
        overall_confidence: rawConf / 100,
        extracted_fields: extracted,
        field_confidences: confidences,
        claim: raw as unknown as import("./types").ClaimResponse,
      } as OCRUploadResult;
    }
    return raw as unknown as OCRUploadResult;
  };

  // Handle streaming response if Content-Type is text/event-stream
  const contentType = res.headers.get("Content-Type");
  if (contentType?.includes("text/event-stream")) {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Response body is null");
    
    const decoder = new TextDecoder();
    let result: OCRUploadResult | null = null;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.step === "COMPLETED" && data.status === "done") {
              result = normalizeResult(data.result);
            } else if (data.step === "ERROR") {
              throw new ApiError(400, data.message);
            } else if (onProgress) {
              onProgress(data);
            }
          } catch (e) {
            if (e instanceof ApiError) throw e;
            console.error("Failed to parse SSE event", e);
          }
        }
      }
    }
    if (!result) throw new Error("Upload completed without a result object");
    return result;
  }

  const raw = await res.json() as Record<string, unknown>;
  return normalizeResult(raw);
}


// ─── HITL ─────────────────────────────────────────────────────────────────────

export async function getHITLQueue(page?: number, limit?: number, marketRegion?: string): Promise<HITLQueueResponse> {
  // API returns items with different field names than the frontend type:
  //   hitl_reason      → trigger_reason
  //   confidence_score → ai_confidence (0-100 → normalised to 0-1)
  //   total_settlement → ai_settlement_amount
  //   claim_reference  → id (no separate id field)
  const query = new URLSearchParams();
  if (page) query.set("page", String(page));
  if (limit) query.set("limit", String(limit));
  if (marketRegion && marketRegion !== "ALL") query.set("market_region", marketRegion);
  const raw = await apiFetch<{
    items: Array<Record<string, unknown>>;
    total: number;
    pending_count: number;
    overdue_count: number;
  }>(`/api/v1/hitl/queue${query.size ? `?${query.toString()}` : ""}`);

  const fallbackSLA = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  function resolveHitlPriority(item: Record<string, unknown>): number {
    const rawPriority = Number(
      item.priority ??
      item.hitl_priority ??
      item.priority_order ??
      item.review_priority
    );

    if (Number.isFinite(rawPriority) && rawPriority >= 1) {
      return rawPriority;
    }

    const triggerReason = String(
      item.hitl_reason ??
      item.trigger_reason ??
      item.hitl_status ??
      ""
    ).toUpperCase();
    const rawConfidence = Number(item.confidence_score ?? 0);

    if (["REGULATORY_VIOLATION", "LOW_CONFIDENCE", "POLICY_AMBIGUITY"].includes(triggerReason)) {
      return 1;
    }

    if (
      [
        "HIGH_VALUE",
        "MEDIUM_CONFIDENCE",
        "AGENT_DISAGREEMENT",
        "AGENT_CONFLICT",
        "INCOMPLETE_PROCESSING",
      ].includes(triggerReason)
    ) {
      return 2;
    }

    if (Number.isFinite(rawConfidence)) {
      if (rawConfidence <= 80) return 1;
      if (rawConfidence <= 95) return 2;
    }

    return 3;
  }

  const items = (raw.items ?? []).map((item) => ({
    id: item.claim_reference as string,
    claim_reference: item.claim_reference as string,
    claim_type: item.claim_type as string,
    patient_name: item.patient_name as string,
    provider_name: item.provider_name as string,
    total_billed: item.total_billed as string,
    ai_settlement_amount: (item.total_settlement ?? item.total_allowed ?? "0") as string,
    // API returns 0-100; frontend multiplies by 100 again, so store as 0-1
    ai_confidence: item.confidence_score
      ? String(parseFloat(item.confidence_score as string) / 100)
      : "0",
    trigger_reason: (item.hitl_reason ?? item.hitl_status ?? "REVIEW") as string,
    status: (item.hitl_status ?? item.status) as string,
    priority: resolveHitlPriority(item),
    hitl_sla_hours: item.hitl_sla_hours != null ? Number(item.hitl_sla_hours) : undefined,
    hitl_priority_reason: item.hitl_priority_reason as string | undefined,
    assigned_to: item.assigned_to as string | undefined,
    agent_assignments: (
      item.agent_assignments ??
      item.agent_lane_assignments ??
      []
    ) as HITLQueueItem["agent_assignments"],
    agent_lane_assignments: (
      item.agent_lane_assignments ??
      item.agent_assignments ??
      []
    ) as HITLQueueItem["agent_lane_assignments"],
    sla_deadline: (item.sla_deadline as string) ?? fallbackSLA,
    created_at: (item.created_at ?? item.date_received ?? item.service_date ?? new Date().toISOString()) as string,
    pending_days_since: Number(item.pending_days_since ?? 0),
    market_region: item.market_region as string | undefined,
    currency: item.currency as string | undefined,
    // Enriched fields from backend for HITL review
    ai_flags: item.ai_flags as string[] | undefined,
    regulatory_compliance: item.regulatory_compliance as boolean | null | undefined,
    regulatory_violations: item.regulatory_violations as HITLRegulatoryViolation[] | undefined,
    regulatory_citations: item.regulatory_citations as HITLAICitation[] | undefined,
    ai_citations: item.ai_citations as HITLAICitation[] | undefined,
    policy_citations: item.policy_citations as HITLPolicyCitation[] | undefined,
    agent_agreement_score: item.agent_agreement_score as number | null | undefined,
    agent_line_comparisons: item.agent_line_comparisons as AgentLineComparison[] | undefined,
    line_items: item.line_items as HITLQueueItem["line_items"] | undefined,
  })) as HITLQueueItem[];

  return {
    items,
    total: raw.total ?? items.length,
    pending_count: raw.pending_count ?? items.length,
    overdue_count: raw.overdue_count ?? 0,
  };
}

export async function submitHITLDecision(
  reference: string,
  body: HITLDecisionCreate,
  idempotencyKey?: string,
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/api/v1/hitl/${reference}/decide`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export async function bulkHITLDecision(
  claimIds: string[],
  decision: BulkClaimDecision,
): Promise<BulkDecisionResponse> {
  return apiFetch<BulkDecisionResponse>("/api/v1/claims/bulk-decision", {
    method: "POST",
    body: JSON.stringify({ claim_ids: claimIds, decision }),
  });
}

export async function reAdjudicateClaim(reference: string): Promise<{
  claim_reference: string;
  message: string;
  ai_settlement_amount: string | null;
  confidence_score: string | null;
  policy_citations_count: number;
  ai_citations_count: number;
}> {
  return apiFetch(`/api/v1/hitl/${reference}/re-adjudicate`, {
    method: "POST",
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardKPIs(
  dateFrom?: string,
  dateTo?: string,
  marketRegion?: string,
  displayCurrency?: string,
): Promise<DashboardKPIs> {
  const params = new URLSearchParams();
  if (dateFrom) params.append("date_from", dateFrom);
  if (dateTo) params.append("date_to", dateTo);
  if (marketRegion) params.append("market_region", marketRegion);
  if (displayCurrency) params.append("display_currency", displayCurrency);

  const qs = params.toString();
  return apiFetch<DashboardKPIs>(
    `/api/v1/dashboard/kpis${qs ? `?${qs}` : ""}`
  );
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export async function getPolicies(
  market_region?: string
): Promise<PolicyResponse[]> {
  // API returns { policies: [...], total: N } — unwrap to array
  const qs = market_region ? `?market_region=${market_region}` : "";
  const raw = await apiFetch<{ policies: PolicyResponse[]; total: number }>(
    `/api/v1/policies${qs}`
  );
  return (raw.policies ?? []).map((p) => ({
    ...p,
    status: p.status ?? "ACTIVE",
    created_at: p.created_at ?? p.effective_date,
  }));
}

export async function getPolicy(
  policyNumber: string
): Promise<PolicyResponse> {
  const raw = await apiFetch<PolicyResponse>(`/api/v1/policies/${policyNumber}`);
  return {
    ...raw,
    status: raw.status ?? "ACTIVE",
    created_at: raw.created_at ?? raw.effective_date,
  };
}

export async function uploadPolicyDocument(
  policyId: string,
  file: File
): Promise<PolicyDocumentUploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const url = `/api/v1/proxy/policies/${policyId}/document`;
  const res = await fetch(url, { method: "POST", credentials: "include", body: form });
  if (!res.ok) {
    const detail = await parseApiErrorDetail(res);
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<PolicyDocumentUploadResponse>;
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function getMember(
  memberNumber: string
): Promise<MemberResponse> {
  return apiFetch<MemberResponse>(`/api/v1/members/${memberNumber}`);
}

// ─── Admin — Users ────────────────────────────────────────────────────────────

import type { AdminUser } from "./types";

export async function adminListUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/v1/admin/users");
}

export async function adminCreateUser(body: {
  email: string;
  full_name: string;
  role: string;
  market_region: string;
  password: string;
}): Promise<AdminUser> {
  return apiFetch<AdminUser>("/api/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminUpdateUser(
  email: string,
  patch: Partial<Pick<AdminUser, "full_name" | "role" | "market_region" | "is_active">>
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function adminResetPassword(
  email: string,
  newPassword: string
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(
    `/api/v1/admin/users/${encodeURIComponent(email)}/reset-password`,
    { method: "POST", body: JSON.stringify({ new_password: newPassword }) }
  );
}

export async function adminDeleteUser(email: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/users/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

// ─── Admin — Config ───────────────────────────────────────────────────────────

export async function adminGetConfig(): Promise<SystemConfig> {
  return apiFetch<SystemConfig>("/api/v1/admin/config");
}

export async function adminUpdateConfig(
  patch: Partial<SystemConfig>
): Promise<SystemConfig> {
  return apiFetch<SystemConfig>("/api/v1/admin/config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function getMyScreenAccess(): Promise<ScreenAccessResponse> {
  return apiFetch<ScreenAccessResponse>("/api/v1/auth/screen-access");
}

/**
 * Test Membership Sync connection for a region
 */
export async function adminTestMembershipSync(region: string): Promise<{
  ok: boolean;
  status_code?: number;
  detail: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response_preview?: any;
  response_body?: string;
}> {
  return apiFetch(`/api/v1/admin/config/membership-sync/test?region=${region}`, {
    method: "POST",
  });
}

// ── HMS Integration ──────────────────────────────────────────────────────────

export async function adminGetHealth(): Promise<IntegrationHealth> {
  return apiFetch<IntegrationHealth>("/api/v1/admin/health");
}

export async function adminGetKubernetesHealth(): Promise<KubernetesHealth> {
  return apiFetch<KubernetesHealth>("/api/v1/admin/kubernetes/health");
}

// ─── Admin — Compliance Automation ───────────────────────────────────────────

export async function adminListComplianceUpdates(market?: string): Promise<ComplianceUpdateRecord[]> {
  const qs = new URLSearchParams();
  if (market) qs.set("market", market);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const response = await apiFetch<{ updates: ComplianceUpdateRecord[] }>(`/api/v1/admin/compliance/updates${query}`);
  return response.updates;
}

export async function adminIngestComplianceUpdate(body: {
  market: string;
  regulatory_body: string;
  source: string;
  effective_date: string;
  clauses: Record<string, unknown>[];
  notes?: string;
}): Promise<ComplianceUpdateRecord> {
  const response = await apiFetch<{ success: boolean; update: ComplianceUpdateRecord }>(
    "/api/v1/admin/compliance/updates/ingest",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return response.update;
}

export async function adminGetComplianceDrift(market: string): Promise<ComplianceDriftResult> {
  return apiFetch<ComplianceDriftResult>(`/api/v1/admin/compliance/drift?market=${encodeURIComponent(market)}`);
}

export async function adminRunComplianceVerification(market?: string): Promise<ComplianceVerificationRecord> {
  const query = market ? `?market=${encodeURIComponent(market)}` : "";
  return apiFetch<ComplianceVerificationRecord>(`/api/v1/admin/compliance/verifications/run${query}`, {
    method: "POST",
  });
}

export async function adminListComplianceVerifications(limit = 20): Promise<ComplianceVerificationRecord[]> {
  const response = await apiFetch<{ verifications: ComplianceVerificationRecord[] }>(
    `/api/v1/admin/compliance/verifications?limit=${limit}`
  );
  return response.verifications;
}

// ─── Admin — Workflow Operations ─────────────────────────────────────────────

export async function adminListWorkflowSagas(params?: {
  status_filter?: string;
  limit?: number;
}): Promise<WorkflowSagaRecord[]> {
  const qs = new URLSearchParams();
  if (params?.status_filter) qs.set("status_filter", params.status_filter);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  const response = await apiFetch<{ items: WorkflowSagaRecord[] }>(`/api/v1/admin/workflows/sagas${query}`);
  return response.items;
}

export async function adminGetWorkflowEvents(claimReference: string): Promise<WorkflowEventRecord[]> {
  const response = await apiFetch<{ claim_reference: string; events: WorkflowEventRecord[] }>(
    `/api/v1/admin/workflows/${encodeURIComponent(claimReference)}/events`
  );
  return response.events;
}

// ─── Admin — Policy Library ───────────────────────────────────────────────────

export async function policyLibraryList(params?: {
  market?:      string;
  policy_type?: string;
  insurer?:     string;
}): Promise<PolicyLibraryEntry[]> {
  const qs = new URLSearchParams();
  if (params?.market)      qs.set("market",      params.market);
  if (params?.policy_type) qs.set("policy_type", params.policy_type);
  if (params?.insurer)     qs.set("insurer",      params.insurer);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<PolicyLibraryEntry[]>(`/api/v1/admin/policy-library${query}`);
}

export async function policyLibraryGet(policyId: string): Promise<PolicyLibraryDocument> {
  return apiFetch<PolicyLibraryDocument>(`/api/v1/admin/policy-library/${policyId}`);
}

export async function policyLibraryUpload(
  file: File,
  meta: {
    market:         string;
    policy_type:    string;
    insurer_name:   string;
    policy_name:    string;
    effective_date: string;
    version?:       string;
  }
): Promise<PolicyLibraryUploadResponse> {
  const form = new FormData();
  form.append("file",           file);
  form.append("market",         meta.market);
  form.append("policy_type",    meta.policy_type);
  form.append("insurer_name",   meta.insurer_name);
  form.append("policy_name",    meta.policy_name);
  form.append("effective_date", meta.effective_date);
  if (meta.version) form.append("version", meta.version);

  const url = "/api/v1/proxy/admin/policy-library/upload";
  const res = await fetch(url, { method: "POST", credentials: "include", body: form });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const raw = body.detail ?? body.error ?? detail;
      detail = Array.isArray(raw)
        ? raw.map((e: { msg?: string }) => e.msg).join("; ")
        : String(raw);
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<PolicyLibraryUploadResponse>;
}

export async function policyLibraryExtractMetadata(file: File): Promise<PolicyMetadataResponse> {
  const form = new FormData();
  form.append("file", file);
  const url = "/api/v1/proxy/admin/policy-library/extract-metadata";
  const res = await fetch(url, { method: "POST", credentials: "include", body: form });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const raw = body.detail ?? body.error ?? detail;
      detail = Array.isArray(raw) ? raw.map((e: { msg?: string }) => e.msg).join("; ") : String(raw);
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<PolicyMetadataResponse>;
}

export async function policyLibraryDelete(policyId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/policy-library/${policyId}`, {
    method: "DELETE",
  });
}

/** Download the original policy PDF document. Returns a Blob for client-side download.
 *  Throws 404 ApiError if no PDF is available (old policies uploaded pre-PDF storage). */
export async function policyLibraryDownloadDocument(policyId: string): Promise<Blob> {
  const url = toProxyUrl(`/api/v1/admin/policy-library/${policyId}/document`);
  const res = await fetch(url, { method: "GET", credentials: "include" });
  if (!res.ok) {
    const detail = await parseApiErrorDetail(res, "Document not available");
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}

// ─── Admin — Reports ──────────────────────────────────────────────────────────

export async function getAdminReport(params: {
  category?:      string;
  date_from?:     string;  // YYYY-MM-DD
  date_to?:       string;  // YYYY-MM-DD
  market_region?: string;
  page?:          number;
  page_size?:     number;
}): Promise<AdminReportResponse> {
  const qs = new URLSearchParams();
  if (params.category)      qs.set("category",      params.category);
  if (params.date_from)     qs.set("date_from",     params.date_from);
  if (params.date_to)       qs.set("date_to",       params.date_to);
  if (params.market_region) qs.set("market_region", params.market_region);
  if (params.page)          qs.set("page",          String(params.page));
  if (params.page_size)     qs.set("page_size",     String(params.page_size));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<AdminReportResponse>(`/api/v1/admin/reports${query}`);
}

// ─── Admin — Audit Logs ───────────────────────────────────────────────────────

export interface GetAuditLogsParams {
  reference?:  string;
  event_type?: string;
  actor_type?: string;
  date_from?:  string; // YYYY-MM-DD
  date_to?:    string; // YYYY-MM-DD
  page?:       number;
  page_size?:  number;
}

export async function getAuditLogs(
  params: GetAuditLogsParams = {}
): Promise<AuditLogsListResponse> {
  const qs = new URLSearchParams();
  if (params.reference)  qs.set("reference",  params.reference);
  if (params.event_type) qs.set("event_type", params.event_type);
  if (params.actor_type) qs.set("actor_type", params.actor_type);
  if (params.date_from)  qs.set("date_from",  params.date_from);
  if (params.date_to)    qs.set("date_to",    params.date_to);
  if (params.page)       qs.set("page",       String(params.page));
  if (params.page_size)  qs.set("page_size",  String(params.page_size));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<AuditLogsListResponse>(`/api/v1/admin/audit-logs${query}`);
}

// ─── Login Sessions ───────────────────────────────────────────────────────────

export interface GetLoginSessionsParams {
  email?: string;
  active_only?: boolean;
  page?: number;
  page_size?: number;
}

export async function getLoginSessions(
  params: GetLoginSessionsParams = {}
): Promise<LoginSessionsResponse> {
  const qs = new URLSearchParams();
  if (params.email)       qs.set("email",       params.email);
  if (params.active_only) qs.set("active_only", "true");
  if (params.page)        qs.set("page",        String(params.page));
  if (params.page_size)   qs.set("page_size",   String(params.page_size));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<LoginSessionsResponse>(`/api/v1/admin/login-sessions${query}`);
}

// ─── Claims — Document URL ────────────────────────────────────────────────────

/**
 * Returns the URL to embed or download the stored PDF for a claim.
 *
 * Uses Next.js API route (/api/v1/claims/[reference]/document) instead of
 * direct proxy because iframes don't send authentication headers.
 * The API route runs server-side with access to httpOnly cookies,
 * fetches the PDF from backend with proper auth, and streams it to the client.
 */
export function getClaimDocumentUrl(reference: string): string {
  return `/api/v1/claims/${encodeURIComponent(reference)}/document`;
}

// ─── Dashboard — Volume ───────────────────────────────────────────────────────

/** Get daily claims / fraud / settled counts for the last N days (default 14). */
export async function getDashboardVolume(
  days = 14,
  dateFrom?: string,
  dateTo?: string,
  marketRegion?: string,
  displayCurrency?: string,
): Promise<DashboardVolumeResponse> {
  const params = new URLSearchParams();

  if (dateFrom && dateTo) {
    params.append("date_from", dateFrom);
    params.append("date_to", dateTo);
  } else {
    params.append("days", days.toString());
  }

  if (marketRegion) params.append("market_region", marketRegion);
  if (displayCurrency) params.append("display_currency", displayCurrency);

  const qs = params.toString();
  return apiFetch<DashboardVolumeResponse>(
    `/api/v1/dashboard/volume${qs ? `?${qs}` : ""}`
  );
}

// ─── Health — Live service status ────────────────────────────────────────────

/** Get live API / DB / Redis / Intelligence AI Agent health for the dashboard strip. */
export async function getServiceHealth(): Promise<ServiceHealthLive> {
  return apiFetch<ServiceHealthLive>("/api/v1/health/live");
}

// ─── Admin — HMS Integrations ─────────────────────────────────────────────────

/** List all registered HMS integration sources (secrets masked). */
export async function adminListHMSSources(): Promise<HMSSource[]> {
  return apiFetch<HMSSource[]>("/api/v1/admin/hms-sources");
}

/** Register a new HMS source. Returns the created record (secrets masked). */
export async function adminCreateHMSSource(body: HMSSourceCreate): Promise<HMSSource> {
  return apiFetch<HMSSource>("/api/v1/admin/hms-sources", {
    method: "POST",
    body:   JSON.stringify(body),
  });
}

/** Update an HMS source (partial patch — pass only fields to change). */
export async function adminUpdateHMSSource(
  sourceId: string,
  patch: Partial<Pick<HMSSource, "name" | "enabled" | "market_region" | "pull_base_url" | "claim_pull_path" | "pull_auth_header" | "webhook_secret">>
): Promise<HMSSource> {
  return apiFetch<HMSSource>(`/api/v1/admin/hms-sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body:   JSON.stringify(patch),
  });
}

/** Remove an HMS source registration. */
export async function adminDeleteHMSSource(sourceId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/hms-sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
}

/** Test pull connectivity for an HMS source. */
export async function adminTestHMSSource(sourceId: string): Promise<HMSTestResult> {
  return apiFetch<HMSTestResult>(
    `/api/v1/admin/hms-sources/${encodeURIComponent(sourceId)}/test`,
    { method: "POST" }
  );
}

// ─── Self-Service Profile ─────────────────────────────────────────────────────

/** Update own profile (name, contact_number). */
export async function updateProfile(data: { full_name?: string; contact_number?: string }): Promise<{ message: string; updated_fields: string[] }> {
  return apiFetch("/api/v1/auth/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Change own password. Requires current password. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}
