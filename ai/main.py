"""FastAPI app for the SliceMatic Stage 3 backend.

Mounts the existing core-backed REST routes (api/routes.py, /api/*) alongside the
new conversational endpoints, with CORS for the Next.js frontend. Run:

    uv run uvicorn ai.main:app --reload --port 7861

"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ai.routers.chat import router as chat_router
from ai.routers.voice import router as voice_router
from ai.routers.voice_ws import router as voice_ws_router
from api.admin_routes import router as admin_router
from api.routes import router as api_router
from api.staff_routes import router as staff_router
from dashboard.routes import router as dashboard_router

# Show our INFO logs (timing, STT results). Without this the root logger stays at
# WARNING, so only warnings surfaced (which is why the timing lines never showed).
logging.getLogger("ai").setLevel(logging.INFO)
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)

log = logging.getLogger(__name__)


def _warmup() -> None:
    """Warm every cold path the first customer would otherwise pay for.

    A bare 1-token "ping" is NOT enough (measured: first real turn still took
    ~6-7s) â€” the first real request carries the full system prompt + tool
    schemas, which the provider processes/caches per prefix. So fire one
    REAL-shaped turn through the same _complete() path as live chat: same
    prompt, same tools, same reasoning-off settings. The throwaway session is
    never stored. Best-effort: a warmup failure (no keys/network) must never
    stop the server."""
    try:
        import asyncio

        from ai import agent, guardrails, observability, tools, voice_fillers
        from ai.session import Session
        from db.client import get_client as get_db

        observability.get_langfuse()
        get_db()
        tools._load_active_menu()
        warm = Session(id="warmup", channel="chat")
        agent._set_system_prompt(warm)
        warm.add("user", "ping")
        agent._complete(warm)
        # The input guardrail's cheap-LLM classifier is its own cold path
        # (measured ~2s on the first >3-word message) â€” warm it with a message
        # long enough to bypass the short-message heuristic.
        guardrails.check_input("hello there, I would like to order a pizza please")
        # Pre-synthesize one "thinking" filler per language (ai/voice_call.py's
        # instant-filler-while-the-LLM-thinks feature) so the first live call
        # doesn't pay that one-time Sarvam TTS cost itself.
        asyncio.run(voice_fillers.get_filler_audio("en"))
        asyncio.run(voice_fillers.get_filler_audio("hi"))
        log.info("AI warmup complete (agent + guardrail LLM turns + voice fillers)")
    except Exception as exc:
        log.warning("AI warmup skipped: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    import ai.realtime as realtime
    realtime.main_loop = asyncio.get_running_loop()
    # Daemon thread: the server binds immediately; the warmup races the first
    # customer instead of delaying boot (matters on hosts with health checks).
    threading.Thread(target=_warmup, daemon=True).start()
    yield


app = FastAPI(title="SliceMatic AI", version="0.1.0", lifespan=lifespan)

# CORS for the Next.js frontend. Comma-separated origins in AI_CORS_ORIGINS,
# default "*" for the demo (we use no cookies, so wildcard is fine).
_origins = [
    o.strip() for o in os.environ.get("AI_CORS_ORIGINS", "*").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)  # /api/* (menu, summary, order, analytics, ...)
from ai.realtime import router as realtime_router
app.include_router(realtime_router, prefix="/api")
app.include_router(admin_router)  # /admin/* protected owner/ops APIs
app.include_router(staff_router)  # /staff/* protected kitchen/backstage APIs
app.include_router(chat_router)  # /chat
app.include_router(voice_router)  # /voice/transcribe, /voice/respond, /voice/synthesize
app.include_router(voice_ws_router)  # WS /voice/call (real-time, additive)
app.include_router(
    dashboard_router
)  # /api/dashboard/* (observability dashboard, additive)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "slicematic-ai"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7861)))
