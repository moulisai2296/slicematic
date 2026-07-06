# SliceMatic Local Setup

This setup runs the active Stage 3 app: FastAPI backend plus Next.js frontend.

## Prerequisites

- Python 3.12+
- `uv`
- Node.js 20+
- npm 10+
- Supabase project with migrations applied

## 1. Backend Environment

Copy the template and fill in your local values:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Minimum Supabase-backed app/admin setup:

```text
DATABASE_PROVIDER=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

AI/voice keys are needed only for those features:

```text
OPENROUTER_API_KEY=...
DEEPGRAM_API_KEY=...
SARVAM_API_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
```

## 2. Install Dependencies

```bash
uv sync
cd frontend
npm install
cd ..
```

## 3. Run Backend

```bash
uv run uvicorn ai.main:app --port 7861
```

Health check: `http://localhost:7861/health`

API docs: `http://localhost:7861/docs`

## 4. Run Frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

The frontend defaults to `http://localhost:7861`. To override it, create `frontend/.env.local`:

```text
NEXT_PUBLIC_API_BASE=http://localhost:7861
```

## 5. Vercel

Deploy the `frontend/` app to Vercel and set:

```text
NEXT_PUBLIC_API_BASE=https://your-fastapi-backend.example.com
```

Allow the Vercel origin in backend CORS if you lock CORS down:

```text
AI_CORS_ORIGINS=https://your-vercel-app.vercel.app
```

## Verification

```bash
uv run pytest
uv run python -m compileall ai api core dashboard db tests
cd frontend && npm run lint
cd frontend && npm run build
```

## Troubleshooting

- Frontend loads but chat/menu fails: confirm the FastAPI backend is running and `NEXT_PUBLIC_API_BASE` is correct.
- Auth/admin/staff fails: confirm Supabase env vars and migrations.
- Voice fails: confirm `DEEPGRAM_API_KEY` and `SARVAM_API_KEY`.
- CORS errors on Vercel: set `AI_CORS_ORIGINS` to your Vercel URL.
