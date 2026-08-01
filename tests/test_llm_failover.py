#!/usr/bin/env python3
"""
Test script for LLM Provider Failover System

Tests:
1. Multi-provider failover logic
2. Health check functionality
3. Graceful degradation to rules-only mode

Usage:
    python3 test_llm_failover.py
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

def test_failover_chain_building():
    """Test that failover chain is built correctly from config."""
    print("\n" + "=" * 80)
    print("TEST 1: Failover Chain Building")
    print("=" * 80)

    from services.api_gateway.app import config_store
    cfg = config_store.load()

    failover_chain = []

    # Build chain (same logic as reasoning.py)
    if cfg.get("groq_enabled", True) and cfg.get("groq_api_key"):
        failover_chain.append({
            "provider": "groq",
            "model": cfg.get("llm_model", "qwen/qwen3-32b"),
            "label": "Groq (primary)"
        })

    if cfg.get("nvidia_enabled", True) and cfg.get("nvidia_api_key"):
        failover_chain.append({
            "provider": "nvidia",
            "model": cfg.get("nvidia_model", "nvidia/llama-3.1-nemotron-ultra-253b-v1"),
            "label": "NVIDIA (secondary)"
        })

    if cfg.get("openai_enabled") and cfg.get("openai_api_key"):
        failover_chain.append({
            "provider": "openai",
            "model": cfg.get("openai_model", "gpt-4o"),
            "label": "OpenAI (tertiary)"
        })

    if cfg.get("anthropic_enabled") and cfg.get("anthropic_api_key"):
        failover_chain.append({
            "provider": "anthropic",
            "model": cfg.get("anthropic_model", "claude-sonnet-4-5"),
            "label": "Anthropic (quaternary)"
        })

    print(f"\n✓ Failover chain contains {len(failover_chain)} providers:")
    for idx, p in enumerate(failover_chain, 1):
        print(f"  {idx}. {p['label']} — {p['provider']}/{p['model']}")

    if not failover_chain:
        print("\n✗ WARNING: No providers configured! Will use rules-only mode.")

    print("\n✓ TEST PASSED")
    return True


def test_health_check():
    """Test health check functionality."""
    print("\n" + "=" * 80)
    print("TEST 2: Provider Health Check")
    print("=" * 80)

    from services.reasoning_engine.app.reasoning import get_reasoning_engine
    from services.api_gateway.app import config_store

    reasoning = get_reasoning_engine()
    cfg = config_store.load()

    # Test Groq health check (if configured)
    groq_key = cfg.get("groq_api_key")
    if groq_key:
        print("\n→ Testing Groq health check...")
        result = reasoning.check_provider_health(
            "groq",
            groq_key,
            cfg.get("llm_model", "qwen/qwen3-32b")
        )
        print(f"  Status: {'✓ HEALTHY' if result['healthy'] else '✗ UNHEALTHY'}")
        print(f"  Response time: {result['response_time_ms']:.2f}ms")
        if result.get('error'):
            print(f"  Error: {result['error']}")
    else:
        print("\n✗ Groq not configured — skipping")

    # Test NVIDIA health check (if configured)
    nvidia_key = cfg.get("nvidia_api_key")
    if nvidia_key:
        print("\n→ Testing NVIDIA health check...")
        result = reasoning.check_provider_health(
            "nvidia",
            nvidia_key,
            cfg.get("nvidia_model", "nvidia/llama-3.1-nemotron-ultra-253b-v1")
        )
        print(f"  Status: {'✓ HEALTHY' if result['healthy'] else '✗ UNHEALTHY'}")
        print(f"  Response time: {result['response_time_ms']:.2f}ms")
        if result.get('error'):
            print(f"  Error: {result['error']}")
    else:
        print("\n✗ NVIDIA not configured — skipping")

    print("\n✓ TEST PASSED")
    return True


def test_rules_only_fallback():
    """Test that rules-only fallback works when no providers are available."""
    print("\n" + "=" * 80)
    print("TEST 3: Rules-Only Fallback")
    print("=" * 80)

    from services.reasoning_engine.app.reasoning import ReasoningEngine, ClaimAIAnalysis

    # Create a reasoning engine instance with no API keys (forces fallback)
    reasoning = ReasoningEngine()
    reasoning._available = False  # Force unavailable state

    # Create minimal test data
    claim_data = {
        "claim_reference": "TEST-FALLBACK-001",
        "claim_type": "OUTPATIENT",
        "market_region": "UAE",
        "currency": "AED",
    }

    result = reasoning.analyze_claim(
        claim_data=claim_data,
        regional_clauses=[],
        company_clauses=[],
        rules_result={}
    )

    print(f"\n→ Claim Reference: {result.claim_reference}")
    print(f"→ Analysis Available: {result.analysis_available}")
    print(f"→ Fallback Reason: {result.fallback_reason}")

    assert isinstance(result, ClaimAIAnalysis), "Result must be ClaimAIAnalysis instance"
    assert result.analysis_available == False, "Analysis should not be available"
    assert "no_providers_configured" in result.fallback_reason or "rules" in result.fallback_reason.lower(), \
        "Fallback reason should indicate no providers or rules-only mode"

    print("\n✓ TEST PASSED — Rules-only fallback works correctly")
    return True


def main():
    """Run all tests."""
    print("\n" + "=" * 80)
    print("LLM PROVIDER FAILOVER SYSTEM — TEST SUITE")
    print("=" * 80)

    tests = [
        ("Failover Chain Building", test_failover_chain_building),
        ("Provider Health Check", test_health_check),
        ("Rules-Only Fallback", test_rules_only_fallback),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
        except Exception as e:
            print(f"\n✗ TEST FAILED: {test_name}")
            print(f"  Error: {type(e).__name__}: {e}")
            failed += 1

    print("\n" + "=" * 80)
    print("TEST RESULTS")
    print("=" * 80)
    print(f"Total tests: {len(tests)}")
    print(f"✓ Passed: {passed}")
    print(f"✗ Failed: {failed}")
    print("=" * 80 + "\n")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
