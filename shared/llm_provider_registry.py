"""
Centralized LLM Provider Registry

Single source of truth for LLM provider configuration.
Initialized once at API startup, cached for all subsequent calls.

Priority: Groq → NVIDIA → OpenAI (requires API key) → Anthropic (requires API key)
Falls back to Rules Engine automatically when no provider is configured.
"""

import os
import logging
from typing import Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class LLMProviderInfo:
    """Immutable provider configuration after initialization."""
    provider_name: Optional[str]  # "groq", "anthropic", "openai", "nvidia", or None
    api_key: Optional[str]
    model_name: Optional[str]
    is_available: bool
    debug_info: str  # Human-readable explanation of why this provider was selected


class LLMProviderRegistry:
    """
    Centralized registry for LLM provider configuration.

    Usage:
        registry = LLMProviderRegistry()
        registry.initialize(config_dict)  # Call once at API startup

        # Anywhere in the codebase:
        info = registry.get_provider_info()
        if info.is_available:
            use_provider(info.provider_name, info.api_key, info.model_name)
        else:
            fallback_to_rules_engine()
    """

    def __init__(self):
        self._provider_info: Optional[LLMProviderInfo] = None
        self._initialized = False

    def initialize(self, config: dict) -> None:
        """
        Initialize the registry with configuration.
        Call this ONCE at API startup.

        Args:
            config: Configuration dict from config_store.load() or similar
        """
        if self._initialized:
            logger.debug("LLMProviderRegistry already initialized, skipping")
            return

        # Check master LLM toggle
        llm_enabled = config.get("llm_enabled", True)
        if not llm_enabled:
            self._provider_info = LLMProviderInfo(
                provider_name=None,
                api_key=None,
                model_name=None,
                is_available=False,
                debug_info="LLM disabled by admin config (master toggle off)"
            )
            self._initialized = True
            logger.info("[LLMRegistry] %s", self._provider_info.debug_info)
            return

        # Try each provider in priority order
        provider_info = self._detect_provider(config)
        self._provider_info = provider_info
        self._initialized = True

        log_level = logging.INFO if provider_info.is_available else logging.WARNING
        logger.log(log_level, "[LLMRegistry] Initialized: %s", provider_info.debug_info)

    def _detect_provider(self, config: dict) -> LLMProviderInfo:
        """
        Detect which provider is active + properly configured.
        Returns LLMProviderInfo with the first available provider, or None if all disabled.
        """

        # ────────────────────────────────────────────────────────────
        # 0. LOCAL (Highest priority — fine-tuned model via Ollama/vLLM)
        # ────────────────────────────────────────────────────────────
        local_enabled = config.get("local_llm_enabled", False)
        local_url = config.get("local_llm_base_url") or ""
        local_url_present = bool(local_url.strip()) if isinstance(local_url, str) else bool(local_url)

        if local_enabled and local_url_present:
            local_model = config.get("local_llm_model") or "claims-adjudicator:latest"
            local_key = config.get("local_llm_api_key") or "local"
            return LLMProviderInfo(
                provider_name="local",
                api_key=local_key,
                model_name=local_model,
                is_available=True,
                debug_info=f"Local LLM selected (url={local_url}, model={local_model})"
            )

        # ────────────────────────────────────────────────────────────
        # 1. GROQ (Default, recommended for free tier)
        # ────────────────────────────────────────────────────────────
        groq_enabled = config.get("groq_enabled", True)
        groq_key = config.get("groq_api_key") or ""

        # Null-safe: handle empty strings, None values, non-string types
        groq_key_present = (
            bool(groq_key.strip())
            if isinstance(groq_key, str)
            else bool(groq_key)
        )

        if groq_enabled and groq_key_present:
            groq_model = config.get("llm_model") or "qwen/qwen3-32b"
            key_str = groq_key.strip() if isinstance(groq_key, str) else groq_key
            return LLMProviderInfo(
                provider_name="groq",
                api_key=key_str,
                model_name=groq_model,
                is_available=True,
                debug_info=f"Groq selected (model={groq_model})"
            )

        # ────────────────────────────────────────────────────────────
        # 2. NVIDIA NIM (2nd priority, active by default)
        # ────────────────────────────────────────────────────────────
        nvidia_enabled = config.get("nvidia_enabled", True)
        nvidia_key = config.get("nvidia_api_key") or ""

        nvidia_key_present = (
            bool(nvidia_key.strip())
            if isinstance(nvidia_key, str)
            else bool(nvidia_key)
        )

        if nvidia_enabled and nvidia_key_present:
            nvidia_model = config.get("nvidia_model") or "nvidia/llama-3.1-nemotron-ultra-253b-v1"
            key_str = nvidia_key.strip() if isinstance(nvidia_key, str) else nvidia_key
            return LLMProviderInfo(
                provider_name="nvidia",
                api_key=key_str,
                model_name=nvidia_model,
                is_available=True,
                debug_info=f"NVIDIA NIM selected (model={nvidia_model})"
            )

        # ────────────────────────────────────────────────────────────
        # 3. OPENAI (Disabled by default, requires API key in settings)
        # ────────────────────────────────────────────────────────────
        openai_enabled = config.get("openai_enabled", False)
        openai_key = config.get("openai_api_key") or ""

        openai_key_present = (
            bool(openai_key.strip())
            if isinstance(openai_key, str)
            else bool(openai_key)
        )

        if openai_enabled and openai_key_present:
            openai_model = config.get("openai_model") or "gpt-4o"
            key_str = openai_key.strip() if isinstance(openai_key, str) else openai_key
            return LLMProviderInfo(
                provider_name="openai",
                api_key=key_str,
                model_name=openai_model,
                is_available=True,
                debug_info=f"OpenAI selected (model={openai_model})"
            )

        # ────────────────────────────────────────────────────────────
        # 4. ANTHROPIC (Disabled by default, requires API key in settings)
        # ────────────────────────────────────────────────────────────
        anthropic_enabled = config.get("anthropic_enabled", False)
        anthropic_key = config.get("anthropic_api_key") or ""

        anthropic_key_present = (
            bool(anthropic_key.strip())
            if isinstance(anthropic_key, str)
            else bool(anthropic_key)
        )

        if anthropic_enabled and anthropic_key_present:
            anthropic_model = config.get("anthropic_model") or "claude-sonnet-4-5"
            key_str = anthropic_key.strip() if isinstance(anthropic_key, str) else anthropic_key
            return LLMProviderInfo(
                provider_name="anthropic",
                api_key=key_str,
                model_name=anthropic_model,
                is_available=True,
                debug_info=f"Anthropic selected (model={anthropic_model})"
            )

        # ────────────────────────────────────────────────────────────
        # NO PROVIDERS: All disabled or unconfigured
        # ────────────────────────────────────────────────────────────
        debug_msg = (
            f"No active provider configured. "
            f"Local=(enabled={local_enabled}, url_present={local_url_present}), "
            f"Groq=(enabled={groq_enabled}, key_present={groq_key_present}), "
            f"NVIDIA=(enabled={nvidia_enabled}, key_present={nvidia_key_present}), "
            f"OpenAI=(enabled={openai_enabled}, key_present={openai_key_present}), "
            f"Anthropic=(enabled={anthropic_enabled}, key_present={anthropic_key_present}). "
            f"Fallback: Rules Engine only"
        )
        return LLMProviderInfo(
            provider_name=None,
            api_key=None,
            model_name=None,
            is_available=False,
            debug_info=debug_msg
        )

    def get_provider_info(self) -> LLMProviderInfo:
        """
        Get the current provider configuration.

        Returns:
            LLMProviderInfo with provider details (or None if not available)
        """
        if not self._initialized:
            logger.warning("LLMProviderRegistry not initialized! Call initialize() first.")
            return LLMProviderInfo(
                provider_name=None,
                api_key=None,
                model_name=None,
                is_available=False,
                debug_info="Registry not initialized"
            )

        return self._provider_info

    def is_available(self) -> bool:
        """Quick check: is any LLM provider available?"""
        return self.get_provider_info().is_available

    def get_active_provider(self) -> Optional[Tuple[str, str, str]]:
        """
        Get active provider as a tuple: (provider_name, api_key, model_name)
        Returns None if no provider is available.

        This is the function to use in pipeline.py instead of _get_active_provider().
        """
        info = self.get_provider_info()
        if info.is_available:
            return (info.provider_name, info.api_key, info.model_name)
        return None


# Global singleton instance
_registry: Optional[LLMProviderRegistry] = None


def get_registry() -> LLMProviderRegistry:
    """Get the global LLMProviderRegistry instance."""
    global _registry
    if _registry is None:
        _registry = LLMProviderRegistry()
    return _registry


def initialize_registry(config: dict) -> None:
    """Initialize the global registry. Call once at API startup."""
    registry = get_registry()
    registry.initialize(config)


def get_active_provider_info() -> LLMProviderInfo:
    """Get current provider info from the global registry."""
    return get_registry().get_provider_info()
