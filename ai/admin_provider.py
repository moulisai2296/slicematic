"""Admin AI provider abstraction.

Admin AI must remain safe for business operations: database metrics are the
source of truth, and external providers may only explain/rephrase those metrics.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol


class AdminAIProvider(Protocol):
    name: str

    def refine_insights(
        self,
        *,
        metrics: dict,
        insights: list[dict],
    ) -> list[dict]:
        """Return insight text derived only from supplied metrics."""


@dataclass
class ProviderResult:
    provider: str
    insights: list[dict]
    fallback_used: bool = False
    error: str | None = None


class MockAdminAIProvider:
    name = "mock"

    def refine_insights(
        self,
        *,
        metrics: dict,
        insights: list[dict],
    ) -> list[dict]:
        return insights


class OpenAICompatibleAdminAIProvider:
    def __init__(self, *, name: str, api_key: str, base_url: str | None, model: str):
        self.name = name
        self.api_key = api_key
        self.base_url = base_url
        self.model = model

    def refine_insights(
        self,
        *,
        metrics: dict,
        insights: list[dict],
    ) -> list[dict]:
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        response = client.chat.completions.create(
            model=self.model,
            temperature=0.2,
            max_tokens=700,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are SliceMatic Admin AI. Rewrite each insight in "
                        "clear business language. You may expand on the insights to provide "
                        "actionable business suggestions (like marketing or coupon ideas). "
                        "However, you MUST NOT invent fake metrics or data points. "
                        "Return only a valid JSON array of objects with 'type' and 'text'."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"metrics": metrics, "insights": insights}, default=str
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or "[]"
        return _merge_refined_text(insights, content)


class GeminiAdminAIProvider:
    name = "gemini"

    def __init__(self, *, api_key: str, model: str):
        self.api_key = api_key
        self.model = model.removeprefix("models/")

    def refine_insights(
        self,
        *,
        metrics: dict,
        insights: list[dict],
    ) -> list[dict]:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={self.api_key}"
        )
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "You are SliceMatic Admin AI. Rewrite each admin insight in "
                                "clear business language. You may expand on the original text "
                                "to provide actionable business suggestions (e.g., marketing ideas "
                                "or coupon suggestions), but DO NOT invent fake data or metrics. "
                                "Return only a valid JSON array. Each item must have 'type' and 'text'. "
                                "Do not include markdown or commentary outside the JSON array. "
                                + json.dumps(
                                    {"insights": insights},
                                    default=str,
                                )
                            )
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
            },
        }
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:  # nosec B310
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Gemini request failed: {exc}") from exc
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "[]")
        )
        return _merge_refined_text(insights, text)


def refine_admin_insights(*, metrics: dict, insights: list[dict]) -> ProviderResult:
    provider_name = _provider_name()
    try:
        provider = _build_provider(provider_name)
        refined = provider.refine_insights(metrics=metrics, insights=insights)
        return ProviderResult(provider=provider.name, insights=refined)
    except Exception as exc:
        return ProviderResult(
            provider="mock",
            insights=MockAdminAIProvider().refine_insights(
                metrics=metrics, insights=insights
            ),
            fallback_used=provider_name != "mock",
            error=str(exc),
        )


def admin_ai_provider_status() -> dict:
    provider_name = _provider_name()
    try:
        provider = _build_provider(provider_name)
        return {
            "provider": provider.name,
            "configured": provider.name == "mock"
            or bool(getattr(provider, "api_key", "")),
            "fallback_provider": "mock",
        }
    except Exception as exc:
        return {
            "provider": provider_name,
            "configured": False,
            "fallback_provider": "mock",
            "error": str(exc),
        }


def _provider_name() -> str:
    return (
        (os.environ.get("ADMIN_AI_PROVIDER") or os.environ.get("AI_PROVIDER") or "mock")
        .strip()
        .lower()
    )


def _build_provider(provider_name: str) -> AdminAIProvider:
    if provider_name in {"", "mock", "deterministic"}:
        return MockAdminAIProvider()
    if provider_name == "openai":
        api_key = _required_env("OPENAI_API_KEY")
        model = os.environ.get("ADMIN_AI_MODEL") or "gpt-4o-mini"
        return OpenAICompatibleAdminAIProvider(
            name="openai", api_key=api_key, base_url=None, model=model
        )
    if provider_name == "openrouter":
        api_key = _required_env("OPENROUTER_API_KEY")
        model = os.environ.get("ADMIN_AI_MODEL") or os.environ.get("PRIMARY_MODEL")
        model = model or "openai/gpt-4o-mini"
        return OpenAICompatibleAdminAIProvider(
            name="openrouter",
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            model=model,
        )
    if provider_name == "gemini":
        api_key = _required_env("GEMINI_API_KEY")
        model = os.environ.get("ADMIN_AI_MODEL") or "gemini-1.5-flash"
        return GeminiAdminAIProvider(api_key=api_key, model=model)
    raise ValueError("ADMIN_AI_PROVIDER must be mock, openai, gemini, or openrouter.")


def _required_env(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if not value:
        raise ValueError(f"{key} is required for selected Admin AI provider.")
    return value


def _merge_refined_text(original: list[dict], content: str) -> list[dict]:
    try:
        refined = json.loads(_strip_code_fence(content))
    except json.JSONDecodeError as exc:
        raise ValueError("Provider did not return valid JSON.") from exc
    if not isinstance(refined, list):
        raise ValueError("Provider response must be a JSON array.")
    text_by_type = {
        str(item.get("type")): str(item.get("text"))
        for item in refined
        if isinstance(item, dict) and item.get("type") and item.get("text")
    }
    return [
        {
            **insight,
            "text": text_by_type.get(str(insight.get("type")), insight["text"]),
        }
        for insight in original
    ]


def _strip_code_fence(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    if text.startswith("json\n"):
        text = text[5:]
    array_start = text.find("[")
    array_end = text.rfind("]")
    if array_start != -1 and array_end > array_start:
        text = text[array_start : array_end + 1]
    return text.strip()
