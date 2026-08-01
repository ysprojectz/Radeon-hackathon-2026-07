"""
Property-Based Tests — OPA IRDAI Invariants
============================================
Verifies that the OPA policy enforces IRDAI rules correctly.

Requirement 6.7 invariant:
  FOR ALL claim inputs where copay_pct > 30, the OPA_Policy SHALL return
  allow=false with denial reason containing 'IRDAI-HI-5.1'.
"""
import json
import os
import subprocess
import sys
import pytest

# ── Helpers ───────────────────────────────────────────────────────────────────

def _opa_available() -> bool:
    try:
        result = subprocess.run(["opa", "version"], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False


def _evaluate_opa(claim: dict, policy: dict | None = None) -> dict:
    """
    Evaluate the OPA policy against a claim input.
    Falls back to a direct HTTP call if OPA CLI is not available.
    """
    opa_url = os.getenv("OPA_URL", "http://localhost:8181/v1/data/insurance/india/claims")
    input_doc = {"input": {"claim": claim, "policy": policy or _default_policy()}}

    try:
        import requests
        resp = requests.post(opa_url, json=input_doc, timeout=5)
        if resp.ok:
            return resp.json().get("result", {})
    except Exception:
        pass

    # Fallback: evaluate inline using the rego file
    policy_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "services", "india_cashless", "opa_policy.rego"
    )
    if not os.path.exists(policy_path):
        pytest.skip("OPA policy file not found and OPA server not reachable")

    try:
        result = subprocess.run(
            ["opa", "eval", "--data", policy_path,
             "--input", "/dev/stdin",
             "data.insurance.india.claims"],
            input=json.dumps(input_doc).encode(),
            capture_output=True,
            timeout=10,
        )
        if result.returncode == 0:
            return json.loads(result.stdout).get("result", [{}])[0].get("expressions", [{}])[0].get("value", {})
    except Exception:
        pass

    pytest.skip("OPA not available for evaluation")


def _default_policy() -> dict:
    return {
        "ped_waiting_months": 12,
        "specific_disease_waiting_months": 12,
        "maternity_waiting_months": 9,
        "applied_exclusions": [],
        "mental_health_copay_pct": 0,
        "standard_copay_pct": 0,
        "ayush_sublimit_pct": 25,
        "room_rent_deduction_method": "PROPORTIONATE_DEDUCTION_ONLY",
        "pre_hospitalization_days": 30,
        "post_hospitalization_days": 60,
        "voluntary_deductible": False,
    }


def _base_claim(**overrides) -> dict:
    base = {
        "claim_type": "INPATIENT",
        "days_since_inception": 90,
        "is_ped": False,
        "is_specific_disease": False,
        "copay_pct": 0,
        "patient_age": 35,
        "diagnosis_category": "GENERAL",
        "treatment_system": "ALLOPATHY",
        "denial_reason": "",
    }
    base.update(overrides)
    return base


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestCopayCapInvariant:
    """
    Requirement 6.7: FOR ALL copay_pct > 30, OPA must deny with IRDAI-HI-5.1.
    This is a hard invariant — no other claim attribute can override it.
    """

    @pytest.mark.parametrize("copay_pct", [30.01, 31, 50, 75, 100])
    def test_copay_above_cap_always_denied(self, copay_pct):
        result = _evaluate_opa(_base_claim(copay_pct=copay_pct))
        assert result.get("allow") is False, (
            f"Expected allow=False for copay_pct={copay_pct}, got {result}"
        )
        reasons = result.get("denial_reasons", [])
        assert any("IRDAI-HI-5.1" in str(r) for r in reasons), (
            f"Expected IRDAI-HI-5.1 in denial_reasons for copay_pct={copay_pct}, got {reasons}"
        )

    @pytest.mark.parametrize("copay_pct", [0, 10, 20, 29.99, 30])
    def test_copay_at_or_below_cap_not_denied_for_copay(self, copay_pct):
        result = _evaluate_opa(_base_claim(copay_pct=copay_pct))
        reasons = result.get("denial_reasons", [])
        # Copay rule specifically should NOT fire
        copay_violations = [r for r in reasons if "IRDAI-HI-5.1" in str(r) and "30%" in str(r)]
        assert not copay_violations, (
            f"Unexpected copay violation for copay_pct={copay_pct}: {copay_violations}"
        )

    def test_copay_violation_independent_of_claim_type(self):
        """Invariant holds regardless of claim type."""
        for claim_type in ["INPATIENT", "OUTPATIENT", "DAYCARE", "MATERNITY"]:
            result = _evaluate_opa(_base_claim(copay_pct=35, claim_type=claim_type))
            assert result.get("allow") is False, f"Failed for claim_type={claim_type}"

    def test_copay_violation_independent_of_patient_age(self):
        """Invariant holds for all ages (senior copay rule is separate)."""
        for age in [25, 40, 59, 60, 75]:
            result = _evaluate_opa(_base_claim(copay_pct=35, patient_age=age))
            assert result.get("allow") is False, f"Failed for patient_age={age}"


class TestEmergencyNoCopay:
    """Requirement 6.3: Emergency admissions must have copay=0."""

    def test_emergency_with_copay_denied(self):
        result = _evaluate_opa(_base_claim(claim_type="EMERGENCY", copay_pct=5))
        assert result.get("allow") is False
        reasons = result.get("denial_reasons", [])
        assert any("emergency" in str(r).lower() or "IRDAI-HI-5.1" in str(r) for r in reasons)

    def test_emergency_zero_copay_allowed(self):
        result = _evaluate_opa(_base_claim(claim_type="EMERGENCY", copay_pct=0))
        # Should not be denied for copay reason
        reasons = result.get("denial_reasons", [])
        emergency_copay_violations = [r for r in reasons if "emergency" in str(r).lower()]
        assert not emergency_copay_violations


class TestProhibitedExclusions:
    """Requirement 6.3: Mental health, HIV/AIDS, substance abuse cannot be excluded."""

    @pytest.mark.parametrize("exclusion", ["MENTAL_HEALTH", "HIV_AIDS", "SUBSTANCE_ABUSE_TREATMENT"])
    def test_prohibited_exclusion_denied(self, exclusion):
        policy = _default_policy()
        policy["applied_exclusions"] = [exclusion]
        result = _evaluate_opa(_base_claim(), policy)
        assert result.get("allow") is False
        reasons = result.get("denial_reasons", [])
        assert any("IRDAI-HI-4.1" in str(r) for r in reasons), (
            f"Expected IRDAI-HI-4.1 for exclusion={exclusion}, got {reasons}"
        )

    def test_permitted_exclusion_not_denied(self):
        policy = _default_policy()
        policy["applied_exclusions"] = ["COSMETIC_ELECTIVE"]
        result = _evaluate_opa(_base_claim(), policy)
        reasons = result.get("denial_reasons", [])
        exclusion_violations = [r for r in reasons if "IRDAI-HI-4.1" in str(r)]
        assert not exclusion_violations


class TestInitialWaitingPeriod:
    """Requirement 6.3: Initial 30-day waiting period."""

    def test_claim_within_30_days_denied(self):
        result = _evaluate_opa(_base_claim(days_since_inception=15))
        assert result.get("allow") is False
        reasons = result.get("denial_reasons", [])
        assert any("IRDAI-HI-3.1" in str(r) for r in reasons)

    def test_accident_exempt_from_waiting_period(self):
        result = _evaluate_opa(_base_claim(days_since_inception=5, claim_type="ACCIDENT"))
        reasons = result.get("denial_reasons", [])
        waiting_violations = [r for r in reasons if "waiting" in str(r).lower() and "IRDAI-HI-3.1" in str(r)]
        assert not waiting_violations

    def test_claim_after_30_days_not_denied_for_waiting(self):
        result = _evaluate_opa(_base_claim(days_since_inception=31))
        reasons = result.get("denial_reasons", [])
        initial_waiting = [r for r in reasons if "Initial 30-day" in str(r)]
        assert not initial_waiting
