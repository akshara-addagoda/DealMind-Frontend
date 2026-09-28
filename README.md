# DealMind Frontend

Frontend-only React/Vite implementation for the Microsoft hackathon DealMind workspace.

## Run Locally

```bash
npm install
npm run dev
```

The frontend expects the DealMind FastAPI backend at `http://localhost:8000` by default. To change it, copy `.env.example` to `.env.local` and set:

```bash
VITE_DEALMIND_API_BASE_URL=http://localhost:8000
```

Do not commit real `.env` files or secrets.

## Backend Contract

The UI uses only these endpoints:

- `GET /health`
- `GET /api/health/db`
- `GET /api/health/memory`
- `POST /api/deals/{deal_id}/ask`
- `POST /api/deals/{deal_id}/intelligence`
- `POST /api/deals/{deal_id}/interactions`

The seeded deal used by the frontend is:

```text
53df2f8b-70a7-4eeb-90e6-f4d8cb135cfc
```

The API client is implemented in `src/services/apiClient.ts`. It maps backend responses into the existing UI types without inventing evidence, memory IDs, or temporal insight. If the backend does not return `memory_used`, `evidence`, or `temporal_insight`, the UI shows an unavailable or insufficient-history state.

## Rosy Avatar

Rosy uses the uploaded portrait at `public/rosy.jpeg`. The UI applies a circular crop and subtle state animations in CSS.

## Verify

```bash
npm run build
```

This runs TypeScript typechecking and creates a production build in `dist`.
