# SliceMatic

SliceMatic is a Stage 3 full-stack pizza ordering app with a Next.js frontend, a FastAPI backend, Supabase persistence, and AI-assisted chat/voice ordering.

## Active Architecture

- `frontend/` - Next.js App Router UI for customers, staff, kitchen, delivery, admin, and dashboard screens.
- `ai/main.py` - FastAPI application entrypoint. It mounts `/chat`, `/voice/*`, `/api/*`, `/admin/*`, `/staff/*`, and `/api/dashboard/*`.
- `core/` - deterministic menu loading, validation, pricing, analytics, and flat-file compatibility helpers.
- `db/` - Supabase-first data access plus optional local Postgres fallback modules.
- `supabase/migrations/` - database schema and migrations for auth, orders, admin, staff, inventory, analytics, notifications, and AI events.
- `ai/` - LLM orchestration, guardrails, voice/STT/TTS integrations, session handling, and observability.

Gradio and Hugging Face deployment files are archived under `Aman/archived/` and are no longer part of the active application.

## Local Setup

```bash
uv sync
uv run uvicorn ai.main:app --port 7861
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend defaults to `http://localhost:7861` for the API. To point it elsewhere, set `NEXT_PUBLIC_API_BASE` in `frontend/.env.local` or in Vercel.

## Required Environment

Copy `.env.example` to `.env` for local backend configuration. Do not commit real secret values.

Common variables:

- `DATABASE_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `OPENROUTER_API_KEY` for AI chat
- `DEEPGRAM_API_KEY` for voice transcription
- `SARVAM_API_KEY` for voice synthesis
- `LANGFUSE_*` for optional observability
- `AI_CORS_ORIGINS` for allowed frontend origins

## Vercel Deployment

Deploy the Next.js frontend from `frontend/` on Vercel. Configure:

```text
NEXT_PUBLIC_API_BASE=https://your-fastapi-backend.example.com
```

The FastAPI backend must be deployed as a reachable Python service running:

```bash
uv run uvicorn ai.main:app --host 0.0.0.0 --port $PORT
```

Set the same backend environment variables in that backend host. Supabase migrations remain in `supabase/migrations/`; do not run destructive database reset commands against production.

## Useful Commands

```bash
uv run pytest
uv run python -m compileall ai api core dashboard db tests
cd frontend && npm run lint
cd frontend && npm run build
```

## Notes

- Gradio is not an active dependency.
- Hugging Face and Docker deployment files have been archived.
- `database/orders_log.txt` is retained only as historical flat-file data/compatibility; Stage 3 orders use the database as source of truth.
- `.env` and `frontend/.env.local` are local secrets files and should remain untouched by cleanup work.
