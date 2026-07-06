"""Configuration for the conversational AI layer.

Secrets are read lazily from environment variables so tests and local imports
stay runnable without API keys. Optional integrations (Deepgram voice,
Langfuse, Supabase) expose booleans instead of raising at import time.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # python-dotenv absent â€” env may still be set by the host
    pass

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

DEFAULT_PRIMARY = "google/gemini-2.5-flash"
DEFAULT_FALLBACK_1 = "anthropic/claude-haiku-4.5"
DEFAULT_FALLBACK_2 = "openai/gpt-4o-mini"
DEFAULT_GUARDRAIL = "openai/gpt-4o-mini"  # cheap/fast model for the input classifier
DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com"


class ConfigError(RuntimeError):
    """Raised when a required setting is missing."""


def _env(name: str) -> str | None:
    """Return the env var, treating empty/whitespace-only as missing."""
    val = os.environ.get(name)
    if val is None:
        return None
    val = val.strip()
    return val or None


@dataclass(frozen=True)
class Settings:
    openrouter_api_key: str
    primary_model: str
    fallback_models: tuple[str, ...]
    guardrail_model: str
    deepgram_api_key: str | None
    langfuse_public_key: str | None
    langfuse_secret_key: str | None
    langfuse_host: str
    brand: str = "SliceMatic"
    menu_dir: str = "menu_data"
    openrouter_base_url: str = OPENROUTER_BASE_URL
    # Sarvam AI â€” full voice pipeline for Hindi + Indian English.
    # Saarika = STT (auto-detects language), Bulbul = TTS. Deepgram is fallback.
    sarvam_api_key: str | None = None
    sarvam_speaker: str = "anushka"
    sarvam_model: str = "bulbul:v2"
    sarvam_stt_model: str = "saarika:v2.5"
    # Real-time voice call (ai/sarvam_stream.py, ai/voice_call.py): bulbul:v3 for
    # native Hinglish code-mixing. v3 has its own speaker roster (v2 speakers like
    # "abhilash" are invalid on v3) â€” kept separate from sarvam_speaker above so the
    # batch REST path (ai/sarvam.py, still on bulbul:v2) is unaffected.
    sarvam_v3_speaker: str = "ratan"

    @property
    def models(self) -> tuple[str, ...]:
        """Primary model followed by fallbacks, in try order."""
        return (self.primary_model, *self.fallback_models)

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key)

    @property
    def voice_enabled(self) -> bool:
        return bool(self.deepgram_api_key)

    @property
    def sarvam_enabled(self) -> bool:
        """Sarvam (Bulbul) is the primary TTS for both Hindi and English."""
        return bool(self.sarvam_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load settings once. Raises ConfigError if OPENROUTER_API_KEY is missing."""
    api_key = _env("OPENROUTER_API_KEY")
    if not api_key:
        raise ConfigError(
            "OPENROUTER_API_KEY is required for the AI layer. Add it to .env "
            "(see .env.example)."
        )
    fallbacks = tuple(
        m
        for m in (
            _env("FALLBACK_MODEL_1") or DEFAULT_FALLBACK_1,
            _env("FALLBACK_MODEL_2") or DEFAULT_FALLBACK_2,
        )
        if m
    )
    return Settings(
        openrouter_api_key=api_key,
        primary_model=_env("PRIMARY_MODEL") or DEFAULT_PRIMARY,
        fallback_models=fallbacks,
        guardrail_model=_env("GUARDRAIL_MODEL") or DEFAULT_GUARDRAIL,
        deepgram_api_key=_env("DEEPGRAM_API_KEY"),
        langfuse_public_key=_env("LANGFUSE_PUBLIC_KEY"),
        langfuse_secret_key=_env("LANGFUSE_SECRET_KEY"),
        # The repo's .env uses LANGFUSE_BASE_URL; accept LANGFUSE_HOST too.
        langfuse_host=(
            _env("LANGFUSE_BASE_URL") or _env("LANGFUSE_HOST") or DEFAULT_LANGFUSE_HOST
        ),
        menu_dir=_env("MENU_DIR") or "menu_data",
        sarvam_api_key=_env("SARVAM_API_KEY"),
        sarvam_speaker=_env("SARVAM_SPEAKER") or "anushka",
        sarvam_model=_env("SARVAM_MODEL") or "bulbul:v2",
        sarvam_stt_model=_env("SARVAM_STT_MODEL") or "saarika:v2.5",
        sarvam_v3_speaker=_env("SARVAM_V3_SPEAKER") or "ratan",
    )
