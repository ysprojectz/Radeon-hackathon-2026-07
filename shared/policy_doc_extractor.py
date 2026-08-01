"""
Policy Document Extractor — LLM-powered extraction of structured policy clauses
from raw text (produced by the OCR engine from an uploaded policy PDF).

Used by: POST /api/v1/policies/{policy_id}/document

Flow:
  1. Receive raw extracted text (from OCR engine)
  2. Truncate to LLM context limit
  3. Call LLM with clause extraction prompt (Groq → Anthropic → none)
  4. Parse and validate the returned JSON array of clauses
  5. Return list of clause dicts compatible with the policy_clauses DB table schema
     (same structure as tests/fixtures/sample_policies/clauses.json entries)

Graceful degradation:
  - No API key   → returns [] with a warning
  - LLM failure  → returns [] with a logged error
  - Bad JSON     → returns [] with a logged error
"""
import os
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTION PROMPT
# ─────────────────────────────────────────────────────────────────────────────

CLAUSE_EXTRACTION_SYSTEM_PROMPT = """You are an expert insurance policy document parser.

Your task: Extract all adjudication-relevant clauses from the raw text of an insurance policy document.

For each clause you find, produce a JSON object with EXACTLY this structure:
{{
  "clause_type": "<one of: BENEFIT, EXCLUSION, LIMITATION, DEFINITION, GENERAL_PROVISION, COPAY_COINSURANCE, DEDUCTIBLE, PREAUTHORIZATION, SUB_LIMIT, WAITING_PERIOD, COORDINATION_OF_BENEFITS, ROOM_RENT>",
  "section_reference": "<exact section number from document, e.g. Section 3.1 or Clause 5.2>",
  "title": "<clause title, max 200 characters>",
  "full_text": "<verbatim or faithfully summarized clause text, max 2000 characters>",
  "structured_data": {{
    // Key-value pairs representing the actionable numbers and rules in this clause.
    // Copay clause: {{"copay_pct": 20, "copay_max_per_visit": 50}}
    // Exclusion: {{"excluded_categories": ["COSMETIC"], "excluded_procedure_codes": []}}
    // Sub-limit: {{"annual_limit": 5000, "currency": "AED"}}
    // Waiting period: {{"waiting_months": 6, "condition": "PRE_EXISTING"}}
    // Room rent: {{"daily_limit": 500, "limit_type": "PROPORTIONATE"}}
  }},
  "applicable_claim_types": ["INPATIENT", "OUTPATIENT"]  // or null if applies to all types
}}

RULES:
1. Extract ALL clauses relevant to claim adjudication: benefits, exclusions, waiting periods, copays, sub-limits, pre-auth requirements, room rent caps, deductibles.
2. Do NOT invent clauses that are not explicitly present in the document text.
3. structured_data MUST use consistent keys:
   - Copay: "copay_pct", "copay_flat", "copay_max_per_visit", "copay_max_annual"
   - Exclusions: "excluded_categories" (list of strings), "excluded_procedure_codes" (list)
   - Sub-limits: "annual_limit", "per_admission_limit", "sessions_per_year", "currency"
   - Waiting period: "waiting_months", "waiting_days", "condition_type"
   - Room rent: "daily_limit", "limit_type" (CAPPED or PROPORTIONATE), "currency"
   - Preauth: "required_for" (list of claim types)
4. Return ONLY a JSON array of clause objects. No markdown fences. No explanation outside JSON.
5. Maximum 40 clauses per document.
6. If the document is unclear or you cannot determine a clause type with confidence, use GENERAL_PROVISION.

MARKET CONTEXT: {market_region} policy issued by {carrier_name}.
"""


# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTOR CLASS
# ─────────────────────────────────────────────────────────────────────────────

class PolicyDocumentExtractor:
    """
    Uses the configured LLM (Groq → Anthropic → fallback) to extract structured
    policy clauses from raw OCR text of an insurance policy document.

    Returns a list of clause dicts compatible with the policy_clauses DB table schema.
    """

    MAX_TEXT_CHARS = 12000   # ~3,000 tokens; protects against very long PDFs
    MAX_TOKENS_OUT = 6000
    TEMPERATURE = 0          # Deterministic extraction

    VALID_CLAUSE_TYPES = {
        "BENEFIT", "EXCLUSION", "LIMITATION", "DEFINITION",
        "GENERAL_PROVISION", "COPAY_COINSURANCE", "DEDUCTIBLE",
        "PREAUTHORIZATION", "SUB_LIMIT", "WAITING_PERIOD",
        "COORDINATION_OF_BENEFITS", "ROOM_RENT",
    }

    def __init__(self):
        self._client = None
        self._provider = "none"
        self._model = ""
        self._available = False
        self._init_client()

    def _init_client(self):
        """Auto-detect LLM provider: Groq (free) → Anthropic (paid) → none."""
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if groq_key:
            try:
                from groq import Groq
                self._client = Groq(api_key=groq_key)
                self._provider = "groq"
                self._model = os.getenv("LLM_MODEL", "qwen/qwen3-32b")
                self._available = True
                logger.info("PolicyDocumentExtractor → Groq | model=%s", self._model)
                return
            except ImportError:
                logger.warning("groq package not installed — run: pip install groq")
            except Exception as e:
                logger.error("Failed to initialize Groq client for extractor: %s", e)

        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if anthropic_key:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=anthropic_key)
                self._provider = "anthropic"
                self._model = os.getenv("LLM_MODEL", "claude-sonnet-4-6")
                self._available = True
                logger.info("PolicyDocumentExtractor → Anthropic | model=%s", self._model)
                return
            except ImportError:
                logger.warning("anthropic package not installed — run: pip install anthropic")
            except Exception as e:
                logger.error("Failed to initialize Anthropic client for extractor: %s", e)

        logger.info(
            "PolicyDocumentExtractor: no LLM API key found "
            "(GROQ_API_KEY or ANTHROPIC_API_KEY) — clause extraction disabled"
        )

    @property
    def is_available(self) -> bool:
        return self._available

    # ── Public API ────────────────────────────────────────────────────────────

    def extract_clauses(
        self,
        text: str,
        policy_meta: dict,
    ) -> list[dict]:
        """
        Parse raw policy document text into a structured clause list.

        Args:
            text:        Raw text extracted from the policy PDF (via OCR engine).
            policy_meta: Dict with at minimum: market_region, carrier_name, policy_number.

        Returns:
            List of clause dicts, each compatible with the policy_clauses table schema.
            Returns [] if LLM unavailable or extraction fails.
        """
        if not self._available:
            logger.warning(
                "PolicyDocumentExtractor: LLM unavailable — returning empty clause list "
                "for policy %s", policy_meta.get("policy_number", "UNKNOWN")
            )
            return []

        # Truncate very long documents to protect LLM context
        truncated = text[:self.MAX_TEXT_CHARS]
        if len(text) > self.MAX_TEXT_CHARS:
            logger.info(
                "Policy text truncated from %d to %d chars for extraction (policy=%s)",
                len(text), self.MAX_TEXT_CHARS, policy_meta.get("policy_number", "UNKNOWN")
            )

        system_prompt = CLAUSE_EXTRACTION_SYSTEM_PROMPT.format(
            market_region=policy_meta.get("market_region", "UNKNOWN"),
            carrier_name=policy_meta.get("carrier_name", "UNKNOWN"),
        )

        user_message = (
            "INSURANCE POLICY DOCUMENT TEXT:\n"
            "---\n"
            f"{truncated}\n"
            "---\n\n"
            "Extract all adjudication-relevant clauses from the above policy document. "
            "Return ONLY a JSON array of clause objects with no markdown or commentary."
        )

        try:
            raw = self._call_llm(system_prompt, user_message)
            return self._parse_clause_list(raw, policy_meta)
        except Exception as e:
            logger.error(
                "PolicyDocumentExtractor: LLM call failed for policy %s: %s",
                policy_meta.get("policy_number", "UNKNOWN"), e
            )
            return []

    # ── LLM Dispatch ─────────────────────────────────────────────────────────

    def _call_llm(self, system_prompt: str, user_message: str) -> str:
        """Dispatch to the configured provider and return raw text response."""
        if self._provider == "groq":
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_message},
                ],
                temperature=self.TEMPERATURE,
                max_tokens=self.MAX_TOKENS_OUT,
            )
            return response.choices[0].message.content

        elif self._provider == "anthropic":
            response = self._client.messages.create(
                model=self._model,
                max_tokens=self.MAX_TOKENS_OUT,
                temperature=self.TEMPERATURE,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            return response.content[0].text

        raise RuntimeError(f"Unknown provider: {self._provider}")

    # ── Response Parsing ──────────────────────────────────────────────────────

    def _parse_clause_list(self, raw: str, policy_meta: dict) -> list[dict]:
        """Parse and validate the LLM's JSON array response into clause dicts."""
        import re as _re
        text = raw.strip()

        # Strip <think>...</think> blocks (chain-of-thought models like qwen3)
        text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()

        # Strip markdown fences (some models add them despite instructions)
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = "\n".join(text.split("\n")[:-1])

        # Find the first JSON array in the LLM response (ignore any trailing content)
        start = text.find("[")
        if start == -1:
            logger.error(
                "PolicyDocumentExtractor: LLM response does not contain a JSON array "
                "(policy=%s). First 300 chars: %s",
                policy_meta.get("policy_number", "UNKNOWN"), raw[:300]
            )
            return []

        try:
            # raw_decode stops at the END of the first valid JSON value, ignoring trailing garbage
            raw_clauses, _ = json.JSONDecoder().raw_decode(text, start)
        except json.JSONDecodeError as e:
            logger.error(
                "PolicyDocumentExtractor: JSON parse error for policy %s: %s",
                policy_meta.get("policy_number", "UNKNOWN"), e
            )
            return []

        if not isinstance(raw_clauses, list):
            logger.error(
                "PolicyDocumentExtractor: expected JSON array, got %s",
                type(raw_clauses).__name__
            )
            return []

        validated = []
        for clause in raw_clauses:
            if not isinstance(clause, dict):
                continue
            # Skip clauses missing the minimum required fields
            if not clause.get("section_reference") or not clause.get("full_text"):
                continue

            clause_type = str(clause.get("clause_type", "GENERAL_PROVISION")).upper()
            if clause_type not in self.VALID_CLAUSE_TYPES:
                clause_type = "GENERAL_PROVISION"

            validated.append({
                "clause_type":             clause_type,
                "section_reference":       str(clause.get("section_reference", ""))[:100],
                "title":                   str(clause.get("title", ""))[:500],
                "full_text":               str(clause.get("full_text", ""))[:5000],
                "structured_data":         clause.get("structured_data") or {},
                "applicable_claim_types":  clause.get("applicable_claim_types"),  # list or None
                "is_active":               True,
            })

        logger.info(
            "PolicyDocumentExtractor: extracted %d valid clauses for policy %s",
            len(validated), policy_meta.get("policy_number", "UNKNOWN")
        )
        return validated


# ─────────────────────────────────────────────────────────────────────────────
# Module-level singleton
# ─────────────────────────────────────────────────────────────────────────────

_extractor_instance: Optional[PolicyDocumentExtractor] = None


def get_policy_doc_extractor() -> PolicyDocumentExtractor:
    """Return (or create) the module-level PolicyDocumentExtractor singleton."""
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = PolicyDocumentExtractor()
    return _extractor_instance
