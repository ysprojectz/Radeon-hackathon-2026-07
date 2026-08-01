export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const PRODUCT_SHORT_NAME = "ACOS";
export const PRODUCT_FULL_NAME = "Autonomous Claims Operating System";
export const PRODUCT_DISPLAY_NAME = `${PRODUCT_SHORT_NAME} — ${PRODUCT_FULL_NAME}`;
export const PRODUCT_MARKETING_TAGLINE = "AI-powered autonomous claims operations";
export const PRODUCT_ASSISTANT_NAME = "COPILOT";

// ─── Status display ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  PENDING:       "Pending",
  PROCESSING:    "Processing",
  SETTLED:       "Paid",
  DENIED:        "Denied",
  HITL_PENDING:  "Flagged",
  HITL_APPROVED: "Approved",
  HITL_DENIED:   "Rejected",
  CANCELLED:     "Cancelled",
  ERROR:         "Error",
};

// ─── Market / Region ─────────────────────────────────────────────────────────

export const MARKET_LABELS: Record<string, string> = {
  UAE: "UAE",
  INDIA: "India",
  KSA: "Saudi Arabia",
  BAHRAIN: "Bahrain",
  OMAN: "Oman",
  QATAR: "Qatar",
  KUWAIT: "Kuwait",
};

export const MARKET_FLAGS: Record<string, string> = {
  UAE: "🇦🇪",
  INDIA: "🇮🇳",
  KSA: "🇸🇦",
  BAHRAIN: "🇧🇭",
  OMAN: "🇴🇲",
  QATAR: "🇶🇦",
  KUWAIT: "🇰🇼",
};

export const MARKET_CURRENCY: Record<string, string> = {
  UAE: "AED",
  INDIA: "INR",
  KSA: "SAR",
  BAHRAIN: "BHD",
  OMAN: "OMR",
  QATAR: "QAR",
  KUWAIT: "KWD",
};

export const CURRENCY_LABELS: Record<string, string> = {
  USD: "USD",
  AED: "AED",
  INR: "INR",
  SAR: "SAR",
  BHD: "BHD",
  OMR: "OMR",
  QAR: "QAR",
  KWD: "KWD",
};

// FX rates: 1 unit of currency = X USD
export const USD_FX_RATES: Record<string, number> = {
  USD: 1.0,
  AED: 0.272294,
  INR: 0.0120,
  SAR: 0.266667,
  BHD: 2.65,
  OMR: 2.60,
  QAR: 0.274725,
  KWD: 3.25,
};

// ─── HITL trigger reasons ────────────────────────────────────────────────────

export const HITL_TRIGGER_LABELS: Record<string, string> = {
  LOW_CONFIDENCE: "Low Confidence",
  HIGH_VALUE: "High Value",
  REGULATORY_VIOLATION: "Regulatory Issue",
  MANUAL_REVIEW: "Manual Review",
  AGENT_CONFLICT: "Coverage Conflict",
  AGENT_DISAGREEMENT: "Coverage Mismatch",
  REVIEW: "Review Required",
};

export const HITL_TRIGGER_COLORS: Record<string, string> = {
  LOW_CONFIDENCE: "bg-yellow-100 text-yellow-800",
  HIGH_VALUE: "bg-orange-100 text-orange-800",
  REGULATORY_VIOLATION: "bg-red-100 text-red-800",
  MANUAL_REVIEW: "bg-purple-100 text-purple-800",
  AGENT_CONFLICT: "bg-amber-100 text-amber-800",
  AGENT_DISAGREEMENT: "bg-amber-100 text-amber-800",
  REVIEW: "bg-blue-100 text-blue-800",
};

// ─── HITL decision labels ────────────────────────────────────────────────────

export const HITL_DECISION_LABELS: Record<string, string> = {
  APPROVE_AI: "Accept Recommended Settlement",
  OVERRIDE_AMOUNT: "Override Amount",
  DENY_CLAIM: "Deny Claim",
  ESCALATE: "Escalate to Senior",
  REQUEST_INFO: "Request More Information",
  RE_VERIFY_AI: "Recheck Recommendation",
};

// ─── Policy tiers ────────────────────────────────────────────────────────────

export const TIER_LABELS: Record<string, string> = {
  ENHANCED_GOLD: "Enhanced Gold",
  ENHANCED_SILVER: "Enhanced Silver",
  BASIC: "Basic",
  THIQA: "Thiqa",
};

// ─── Claim types ─────────────────────────────────────────────────────────────

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  INPATIENT: "Inpatient",
  OUTPATIENT: "Outpatient",
  DAYCARE: "Day Care",
  EMERGENCY: "Emergency",
  MATERNITY: "Maternity",
  DENTAL: "Dental",
  OPTICAL: "Optical",
  PHARMACY: "Pharmacy",
};

// ─── Confidence thresholds ───────────────────────────────────────────────────

export const CONFIDENCE_HIGH = 85;
export const CONFIDENCE_MEDIUM = 70;

export function confidenceColor(score: number): string {
  if (score >= CONFIDENCE_HIGH) return "text-green-600";
  if (score >= CONFIDENCE_MEDIUM) return "text-yellow-600";
  return "text-red-600";
}
