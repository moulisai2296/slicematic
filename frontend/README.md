# SliceMatic Frontend

Next.js App Router frontend for the SliceMatic Stage 3 app.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The frontend talks to the FastAPI backend through `NEXT_PUBLIC_API_BASE`. If unset, it defaults to `http://localhost:7861`.

```text
NEXT_PUBLIC_API_BASE=http://localhost:7861
```

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Vercel

Deploy this `frontend/` directory on Vercel. Set `NEXT_PUBLIC_API_BASE` to the deployed FastAPI backend URL.
