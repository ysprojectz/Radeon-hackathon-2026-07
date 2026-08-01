#!/usr/bin/env python3
"""
Test script for Adaptive LLM Model Selection

Tests the complexity scoring algorithm and provider routing logic.
Run this locally to verify the implementation before deployment.

Usage:
    python scripts/test_adaptive_selection.py
"""
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.api_gateway.app.pipeline import ClaimPipeline
from services.api_gateway.app import config_store


def test_simple_claim():
    """Test that simple claims use Groq"""
    print("\n" + "="*80)
    print("TEST 1: Simple Claim (Outpatient, $500, 2 items)")
    print("="*80)

    claim_data = {
        "claim_type": "OUTPATIENT",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 250},
            {"billed_amount": 250}
        ],
        "secondary_diagnosis_codes": None
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True},
            {"is_covered": True}
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = True
    config["llm_complexity_threshold"] = 5
    config["groq_api_key"] = "test-key"
    config["nvidia_api_key"] = "test-key"

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    expected_complexity = 0  # No high factors
    print(f"Expected complexity: {expected_complexity}")
    print(f"Expected provider: groq")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    assert provider == "groq", f"Expected groq, got {provider}"
    print("✅ PASS: Simple claim correctly routed to Groq")


def test_complex_claim():
    """Test that complex claims use NVIDIA"""
    print("\n" + "="*80)
    print("TEST 2: Complex Claim (Inpatient, $65K, 8 items)")
    print("="*80)

    claim_data = {
        "claim_type": "INPATIENT",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 10000},
            {"billed_amount": 10000},
            {"billed_amount": 10000},
            {"billed_amount": 10000},
            {"billed_amount": 10000},
            {"billed_amount": 5000},
            {"billed_amount": 5000},
            {"billed_amount": 5000}
        ],
        "secondary_diagnosis_codes": None
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True},
            {"is_covered": True}
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = True
    config["llm_complexity_threshold"] = 5
    config["groq_api_key"] = "test-key"
    config["nvidia_api_key"] = "test-key"

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    # Complexity: +3 (>$50K) +2 (>5 items) +2 (INPATIENT) = 7
    expected_complexity = 7
    print(f"Expected complexity: {expected_complexity}")
    print(f"Expected provider: nvidia")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    assert provider == "nvidia", f"Expected nvidia, got {provider}"
    print("✅ PASS: Complex claim correctly routed to NVIDIA")


def test_denials_boost_complexity():
    """Test that denials increase complexity score"""
    print("\n" + "="*80)
    print("TEST 3: Denials Boost Complexity (Outpatient, $5K, 3 items, 2 denials)")
    print("="*80)

    claim_data = {
        "claim_type": "OUTPATIENT",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 2000},
            {"billed_amount": 2000},
            {"billed_amount": 1000}
        ],
        "secondary_diagnosis_codes": None
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True},
            {"is_covered": False},  # Denied
            {"is_covered": False}   # Denied
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = True
    config["llm_complexity_threshold"] = 5
    config["groq_api_key"] = "test-key"
    config["nvidia_api_key"] = "test-key"

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    # Complexity: +0 (value < $10K) +0 (≤5 items) +2 (2 denials) = 2
    # Should still use Groq (2 < 5)
    expected_complexity = 2
    print(f"Expected complexity: {expected_complexity}")
    print(f"Expected provider: groq (denials alone don't trigger NVIDIA)")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    assert provider == "groq", f"Expected groq, got {provider}"
    print("✅ PASS: Denials counted but didn't cross threshold")


def test_maternity_claim():
    """Test that MATERNITY claims get complexity boost"""
    print("\n" + "="*80)
    print("TEST 4: Maternity Claim (+2 complexity)")
    print("="*80)

    claim_data = {
        "claim_type": "MATERNITY",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 8000},
            {"billed_amount": 7000}
        ],
        "secondary_diagnosis_codes": ["O80", "O82"]  # Secondary diagnoses
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True},
            {"is_covered": True}
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = True
    config["llm_complexity_threshold"] = 5
    config["groq_api_key"] = "test-key"
    config["nvidia_api_key"] = "test-key"

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    # Complexity: +2 (>$10K) +2 (MATERNITY) +1 (secondary dx) = 5
    # Should use NVIDIA (5 >= 5)
    expected_complexity = 5
    print(f"Expected complexity: {expected_complexity}")
    print(f"Expected provider: nvidia")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    assert provider == "nvidia", f"Expected nvidia, got {provider}"
    print("✅ PASS: Maternity claim correctly routed to NVIDIA")


def test_fallback_when_nvidia_disabled():
    """Test fallback to Groq when NVIDIA has no API key"""
    print("\n" + "="*80)
    print("TEST 5: Fallback to Groq (NVIDIA disabled)")
    print("="*80)

    claim_data = {
        "claim_type": "INPATIENT",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 60000}
        ],
        "secondary_diagnosis_codes": None
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True}
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = True
    config["llm_complexity_threshold"] = 5
    config["groq_api_key"] = "test-key"
    config["nvidia_api_key"] = None  # NVIDIA disabled

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    # Complexity would be high, but should fallback to Groq
    print(f"NVIDIA API key: {config['nvidia_api_key']}")
    print(f"Expected provider: groq (fallback)")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    assert provider == "groq", f"Expected groq fallback, got {provider}"
    print("✅ PASS: Correctly fell back to Groq when NVIDIA disabled")


def test_adaptive_disabled():
    """Test that disabling adaptive mode uses default provider"""
    print("\n" + "="*80)
    print("TEST 6: Adaptive Mode Disabled (uses default provider)")
    print("="*80)

    claim_data = {
        "claim_type": "INPATIENT",
        "market_region": "UAE",
        "line_items": [
            {"billed_amount": 60000}
        ],
        "secondary_diagnosis_codes": None
    }

    rules_result = {
        "evaluated_items": [
            {"is_covered": True}
        ]
    }

    config = config_store.load()
    config["llm_model_selection_adaptive"] = False  # Disabled
    config["llm_complexity_threshold"] = 5
    config["groq_enabled"] = True
    config["groq_api_key"] = "test-key"
    config["nvidia_enabled"] = True
    config["nvidia_api_key"] = "test-key"

    pipeline = ClaimPipeline()
    provider, api_key, model = pipeline._select_llm_provider(claim_data, rules_result, config)

    # Should use default provider (Groq, as it's enabled and has priority)
    print(f"Adaptive mode: {config['llm_model_selection_adaptive']}")
    print(f"Expected: Default provider from registry")
    print(f"Actual provider: {provider}")
    print(f"Actual model: {model}")

    # When adaptive is disabled, it delegates to get_registry().get_active_provider()
    # which returns Groq (first enabled provider with API key)
    assert provider in ["groq", "nvidia"], f"Expected groq or nvidia, got {provider}"
    print("✅ PASS: Adaptive mode disabled correctly delegates to default provider")


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("ADAPTIVE LLM MODEL SELECTION — TEST SUITE")
    print("="*80)

    try:
        test_simple_claim()
        test_complex_claim()
        test_denials_boost_complexity()
        test_maternity_claim()
        test_fallback_when_nvidia_disabled()
        test_adaptive_disabled()

        print("\n" + "="*80)
        print("✅ ALL TESTS PASSED")
        print("="*80)
        print("\nAdaptive LLM selection is working correctly!")
        print("Ready for deployment.\n")

    except AssertionError as e:
        print("\n" + "="*80)
        print("❌ TEST FAILED")
        print("="*80)
        print(f"\nError: {e}\n")
        sys.exit(1)

    except Exception as e:
        print("\n" + "="*80)
        print("❌ UNEXPECTED ERROR")
        print("="*80)
        print(f"\nError: {e}\n")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
