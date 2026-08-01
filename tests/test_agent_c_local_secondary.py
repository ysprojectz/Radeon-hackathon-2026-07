"""
Agent C must never fall back to a cloud provider (Groq/NVIDIA/OpenAI/Anthropic)
when Agent B is already running locally — that would silently violate Track 2's
"100% local core inference" rule (SKILL.md non-negotiable #2). These tests pin
down the two places that guarantee it: the provider-selection routing in
pipeline.py, and the independent local client in reasoning.py.
"""
import time

from services.api_gateway.app import config_store
from services.api_gateway.app.pipeline import ClaimPipeline
from services.reasoning_engine.app.reasoning import ReasoningEngine
from shared.llm_reliability import ReliableLLMClient


def test_secondary_stays_local_when_primary_is_local():
    """pipeline._select_secondary_llm_provider must pick local_secondary,
    never groq/nvidia, when Agent B is local and a secondary local endpoint is configured."""
    cfg = {
        "multi_agent_enabled": True,
        "local_llm_secondary_enabled": True,
        "local_llm_secondary_base_url": "http://localhost:8001/v1",
        "local_llm_secondary_model": "Qwen/Qwen2.5-7B-Instruct-AWQ",
        "local_llm_secondary_api_key": "local",
        # cloud keys present too — if the routing bug regressed, these would get picked instead
        "groq_api_key": "fake-groq-key",
        "nvidia_api_key": "fake-nvidia-key",
    }
    p_config = ("local", "local", "Qwen/Qwen2.5-14B-Instruct-AWQ")

    pipeline = ClaimPipeline.__new__(ClaimPipeline)  # no need for full __init__ / fixture loading
    s_config = pipeline._select_secondary_llm_provider(p_config, cfg)

    assert s_config is not None
    assert s_config[0] == "local_secondary"
    assert s_config[2] == "Qwen/Qwen2.5-7B-Instruct-AWQ"


def test_secondary_is_none_when_local_secondary_not_configured():
    """If Agent C's local endpoint isn't configured, Agent C must be skipped
    entirely — never silently redirected to a cloud provider."""
    cfg = {"multi_agent_enabled": True, "local_llm_secondary_enabled": False, "groq_api_key": "fake"}
    p_config = ("local", "local", "Qwen/Qwen2.5-14B-Instruct-AWQ")

    pipeline = ClaimPipeline.__new__(ClaimPipeline)
    s_config = pipeline._select_secondary_llm_provider(p_config, cfg)

    assert s_config is None


def test_secondary_still_uses_cloud_fallback_for_non_local_primary():
    """When Agent B itself is a cloud provider (groq), Agent C's groq<->nvidia
    cross-check fallback is unaffected by the local-routing fix."""
    pipeline = ClaimPipeline.__new__(ClaimPipeline)

    cfg = {"nvidia_api_key": "fake-nvidia-key", "nvidia_model": "nvidia/llama-3.1-nemotron-ultra-253b-v1"}
    s_config = pipeline._select_secondary_llm_provider(("groq", "fake-groq-key", "model"), cfg)
    assert s_config[0] == "nvidia"

    cfg2 = {"groq_api_key": "fake-groq-key", "llm_model": "llama-3.3-70b-versatile"}
    s_config2 = pipeline._select_secondary_llm_provider(("nvidia", "fake-nvidia-key", "model"), cfg2)
    assert s_config2[0] == "groq"


def test_select_provider_local_secondary_uses_independent_base_url(monkeypatch):
    """Agent C's client must point at local_llm_secondary_base_url, completely
    independent of Agent B's local_llm_base_url — same engine instance, two
    distinct provider identities."""
    engine = ReasoningEngine()

    fake_cfg = {
        "local_llm_base_url": "http://localhost:8000/v1",
        "local_llm_secondary_base_url": "http://localhost:8001/v1",
    }
    monkeypatch.setattr(config_store, "load", lambda: fake_cfg)

    engine.select_provider("local", "local", "Qwen/Qwen2.5-14B-Instruct-AWQ")
    assert engine._provider == "local"
    assert str(engine._client.base_url).rstrip("/") == "http://localhost:8000/v1"

    engine.select_provider("local_secondary", "local", "Qwen/Qwen2.5-7B-Instruct-AWQ")
    assert engine._provider == "local_secondary"
    assert str(engine._client.base_url).rstrip("/") == "http://localhost:8001/v1"
    assert engine._available is True


def test_analyze_claim_force_provider_bypasses_config_failover_chain(monkeypatch):
    """analyze_claim() used to rebuild its own failover chain from config on every
    call, ignoring whatever select_provider() the caller had already set up —
    so Agent C's forced 'local_secondary' call would silently retry 'local'
    (Agent B's own endpoint) first, since local_llm_enabled=True always put
    'local' at the front of that internally-rebuilt chain. This meant the
    'secondary' analysis was actually Agent B validating itself, not a real
    cross-check against Agent C — and explains why the agreement score was
    suspiciously always exactly 1.0. force_provider must make analyze_claim
    try ONLY the given provider, never falling back into the config-derived
    chain (found + fixed 2026-07-24)."""
    engine = ReasoningEngine()

    fake_cfg = {
        "local_llm_enabled": True,
        "local_llm_base_url": "http://localhost:8000/v1",
        "local_llm_model": "Qwen/Qwen2.5-14B-Instruct-AWQ",
        "local_llm_secondary_base_url": "http://localhost:8001/v1",
    }
    monkeypatch.setattr(config_store, "load", lambda: fake_cfg)
    monkeypatch.setattr(engine, "_apply_runtime_tuning", lambda cfg=None: None)

    selected_providers = []
    real_select_provider = engine.select_provider

    def spy_select_provider(provider, api_key, model):
        selected_providers.append(provider)
        return real_select_provider(provider, api_key, model)

    monkeypatch.setattr(engine, "select_provider", spy_select_provider)
    monkeypatch.setattr(engine, "_call_llm", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network call blocked in unit test")))
    monkeypatch.setattr(time, "sleep", lambda *_: None)

    engine.analyze_claim(
        claim_data={"claim_reference": "TEST-001"},
        regional_clauses=[],
        company_clauses=[],
        rules_result={},
        force_provider=("local_secondary", "local", "Qwen/Qwen2.5-7B-Instruct-AWQ"),
    )

    assert selected_providers == ["local_secondary"], (
        f"expected only 'local_secondary' to ever be selected, got {selected_providers} — "
        "if 'local' appears, force_provider isn't suppressing the config-derived failover chain"
    )


def test_analyze_claim_force_provider_skips_cache(monkeypatch):
    """Agent C's forced call must never read the LLM cache — the cache key isn't
    provider-aware (keyed on claim+clauses only), so a cache hit could silently
    return Agent B's already-cached response instead of ever calling Agent C,
    defeating the point of an independent cross-check."""
    engine = ReasoningEngine()

    fake_cfg = {"local_llm_enabled": True, "local_llm_base_url": "http://localhost:8000/v1"}
    monkeypatch.setattr(config_store, "load", lambda: fake_cfg)
    monkeypatch.setattr(engine, "_apply_runtime_tuning", lambda cfg=None: None)
    monkeypatch.setattr(engine, "select_provider", lambda *a, **k: None)
    monkeypatch.setattr(engine, "_call_llm", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("stop before real call")))
    monkeypatch.setattr(time, "sleep", lambda *_: None)

    cache_get_calls = []
    engine._cache = type("FakeCache", (), {
        "enabled": True,
        "get_cache_key": lambda self, *a: "some-key",
        "get": lambda self, key: cache_get_calls.append(key) or None,
    })()

    engine.analyze_claim(
        claim_data={"claim_reference": "TEST-002"},
        regional_clauses=[],
        company_clauses=[],
        rules_result={},
        force_provider=("local_secondary", "local", "Qwen/Qwen2.5-7B-Instruct-AWQ"),
    )

    assert cache_get_calls == [], "cache.get() must not be called when force_provider is set"


def test_reliable_client_cache_is_not_provider_aware_but_claim_data_none_bypasses_it():
    """The THIRD, deepest cache layer: ReliableLLMClient (shared/llm_reliability.py)
    caches responses keyed on claim_data alone — no provider identity at all — and
    this client is a single instance shared by both Agent B and Agent C calls
    (ReasoningEngine.__init__ creates it once). So even after fixing routing
    (force_provider) and the Redis-cache skip, Agent C's call was STILL being
    served Agent B's already-cached response here, because both calls pass the
    identical claim_data. This was the actual, final cause of the always-1.0
    agreement score (found + fixed 2026-07-24) — reasoning.py now passes
    claim_data=None to _call_llm whenever force_provider is set, which this test
    proves is sufficient: the cache is a no-op for a call with no claim_data,
    both on lookup and on write, regardless of what's already cached under that
    same claim_data for another provider."""
    client = ReliableLLMClient(max_retries=1)
    claim_data = {"market_region": "INDIA", "claim_type": "INPATIENT", "primary_diagnosis_code": "K35.80", "line_items": []}

    calls = []

    def agent_b_call():
        calls.append("agent_b")
        return "AGENT_B_RESPONSE"

    # Primary (Agent B) call — caches its response under claim_data.
    response1, _ = client.call_with_retry(provider="local", llm_call_fn=agent_b_call, claim_reference="T1", claim_data=claim_data)
    assert response1 == "AGENT_B_RESPONSE"
    assert calls == ["agent_b"]

    # Sanity check the bug this guards against: a SECOND call with the SAME
    # claim_data (even a different provider name) WOULD be served from cache —
    # this is the pre-fix behavior, confirming the cache genuinely doesn't
    # check provider identity.
    def agent_c_call_should_not_run():
        calls.append("agent_c_wrongly_called")
        return "AGENT_C_RESPONSE"

    response2, metrics2 = client.call_with_retry(provider="local_secondary", llm_call_fn=agent_c_call_should_not_run, claim_reference="T1", claim_data=claim_data)
    assert response2 == "AGENT_B_RESPONSE", "confirms the cache ignores provider identity when claim_data is passed"
    assert metrics2["cache_hit"] is True

    # The actual fix: passing claim_data=None (what reasoning.py now does for
    # any force_provider call) must bypass the cache entirely.
    def agent_c_call_should_run():
        calls.append("agent_c_correctly_called")
        return "AGENT_C_RESPONSE"

    response3, metrics3 = client.call_with_retry(provider="local_secondary", llm_call_fn=agent_c_call_should_run, claim_reference="T1", claim_data=None)
    assert response3 == "AGENT_C_RESPONSE"
    assert metrics3["cache_hit"] is False
    assert "agent_c_correctly_called" in calls


def test_call_llm_dispatches_local_secondary_to_call_local(monkeypatch):
    """The dispatch table must route 'local_secondary' through _call_local
    (the same OpenAI-compatible call path 'local' uses) rather than raising
    'Unknown provider'."""
    engine = ReasoningEngine()
    engine._provider = "local_secondary"
    monkeypatch.setattr(engine, "_call_local", lambda msg: "mock-response")

    def llm_call_fn():
        if engine._provider == "groq":
            return engine._call_groq("x")
        elif engine._provider == "anthropic":
            return engine._call_anthropic("x")
        elif engine._provider == "openai":
            return engine._call_openai("x")
        elif engine._provider == "nvidia":
            return engine._call_nvidia("x")
        elif engine._provider in ("local", "local_secondary"):
            return engine._call_local("x")
        raise RuntimeError(f"Unknown provider: {engine._provider}")

    assert llm_call_fn() == "mock-response"


def test_local_providers_get_generous_timeout_not_the_2s_cloud_default(monkeypatch):
    """The default 2s LLM_REQUEST_TIMEOUT_SECONDS is tuned for fast cloud APIs
    (Groq) and was silently causing every local vLLM call to fail as a
    timeout rather than actually complete — a full local response can take
    minutes at unoptimized speed. local/local_secondary must get the
    separate, much longer local_llm_request_timeout_seconds default instead
    (found + fixed 2026-07-24)."""
    engine = ReasoningEngine()
    fake_cfg = {"llm_request_timeout_seconds": 2.0, "local_llm_request_timeout_seconds": 300.0}
    monkeypatch.setattr(config_store, "load", lambda: fake_cfg)

    assert engine._request_timeout("local") == 300.0
    assert engine._request_timeout("local_secondary") == 300.0
    assert engine._request_timeout("groq") == 2.0
    assert engine._request_timeout(None) == 2.0
