# AI Module

## Overview

The AI module adds a role-aware commerce assistant and an asynchronous virtual try-on workflow to the existing Firebase Functions + Express backend.

Core goals:
- Keep authorization on the backend.
- Use real store data through internal services.
- Persist sessions, messages, tool calls, jobs, and assets in Firestore.
- Keep try-on assets private and downloadable through signed URLs.

## Architecture

Main layers:
- `src/routes/ai.routes.ts`: protected HTTP surface under `/api/ai`.
- `src/controllers/ai/*`: request/response orchestration.
- `src/services/ai/adapters/*`: Gemini and Vertex integrations.
- `src/services/ai/knowledge/*`: store-facing business services and helpers.
- `src/services/ai/memory/*`: sessions, messages, tool calls, audit records.
- `src/services/ai/jobs/*`: try-on job lifecycle, assets, worker trigger.
- `src/services/ai/rbac/*`: dynamic tool exposure by role and AI scopes.
- `src/services/ai/tools/*`: tool contracts, schemas, runtime registry.

## Role Model

Global roles remain unchanged:
- `CLIENTE`
- `EMPLEADO`
- `ADMIN`

AI capability mapping:
- `CLIENTE`: customer tools only.
- `EMPLEADO`: customer + support; inventory tools require `aiToolScopes` to include `inventory`.
- `ADMIN`: full AI tool access.

Important rule:
- The model only receives the tools allowed for the current request. Permission is never delegated to Gemini.

## Endpoints

Protected endpoints:
- `POST /api/ai/chat/sessions`
- `GET /api/ai/chat/sessions`
- `GET /api/ai/chat/sessions/:id`
- `POST /api/ai/chat/messages`
- `POST /api/ai/files/upload`
- `POST /api/ai/tryon/jobs`
- `GET /api/ai/tryon/jobs`
- `GET /api/ai/tryon/jobs/:id`
- `GET /api/ai/tryon/jobs/:id/download`
- `GET /api/ai/admin/metrics`
- `GET /api/ai/admin/jobs`

`POST /api/ai/chat/messages` supports JSON responses and SSE when `Accept: text/event-stream` or `stream=true`.

## Firestore Collections

The module uses the store database and adds:
- `ai_sessions`
- `ai_messages`
- `ai_tool_calls`
- `tryon_jobs`
- `tryon_assets`
- `ai_audit_logs`
- `faqTienda`
- `politicasTienda`

## Try-On Flow

1. User uploads a private image through `/api/ai/files/upload`.
2. Backend validates mime type, integrity, and minimum dimensions.
3. Backend stores the input asset in private storage.
4. User creates a try-on job through `/api/ai/tryon/jobs`.
5. The job document is persisted in Firestore as `queued`.
6. Firestore trigger `processTryOnJob` picks the job.
7. Worker resolves the official product image and calls Vertex Virtual Try-On using the service account `vertex-tryon-sa@e-comerce-leon.iam.gserviceaccount.com`.
8. Output is persisted in the private bucket and linked to `tryon_assets` with a stable `gs://` reference.
9. Job status moves to `completed` or `failed`.
10. User downloads through `/api/ai/tryon/jobs/:id/download`, which validates ownership and returns a signed URL.

## Gemini Integration

Adapter:
- `src/services/ai/adapters/gemini.adapter.ts`

Supported modes:
- API key mode with `GEMINI_API_KEY`
- Vertex mode with `AI_GEMINI_MODE=vertexai`, `GCP_PROJECT_ID`, and `GCP_REGION`

Configured models:
- `GEMINI_MODEL_PRIMARY`
- `GEMINI_MODEL_FAST`
- `GEMINI_MODEL_SUMMARY`

The legacy news summarization service now delegates to the same Gemini adapter.

## Vertex Try-On Integration

Adapter:
- `src/services/ai/adapters/vertex-tryon.adapter.ts`

Required config:
- `GCP_PROJECT_ID=e-comerce-leon`
- `GCP_REGION=us-central1`
- `VERTEX_TRYON_MODEL=virtual-try-on-001`
- `AI_STORAGE_BUCKET=e-comerce-leon-ai-private`

## Environment Variables

Add the following variables in the Functions environment:

```env
AI_GEMINI_MODE=vertexai
GEMINI_API_KEY=
GEMINI_MODEL_PRIMARY=gemini-2.5-pro
GEMINI_MODEL_FAST=gemini-2.5-flash
GEMINI_MODEL_SUMMARY=gemini-2.5-flash-lite
AI_GEMINI_TIMEOUT_MS=30000
AI_MAX_TOOL_STEPS=6
AI_CONTEXT_MAX_MESSAGES=12
AI_SUMMARY_MAX_CHARS=2500
AI_GEMINI_TEMPERATURE=0.2

GCP_PROJECT_ID=e-comerce-leon
GCP_REGION=us-central1
VERTEX_TRYON_MODEL=virtual-try-on-001
VERTEX_TRYON_PUBLISHER=google
AI_TRYON_TIMEOUT_MS=120000
AI_TRYON_POLL_INTERVAL_MS=4000

AI_STORAGE_BUCKET=e-comerce-leon-ai-private
GCS_TRYON_BUCKET=e-comerce-leon-ai-private
AI_STORAGE_UPLOAD_FOLDER=ai/uploads
AI_STORAGE_RESULT_FOLDER=ai/tryon-results
AI_SIGNED_URL_TTL_SEC=900
AI_STORAGE_PUBLIC=false

AI_UPLOAD_MAX_MB=10
AI_UPLOAD_MAX_FILES=1
AI_UPLOAD_MIN_WIDTH=512
AI_UPLOAD_MIN_HEIGHT=512

AI_RATE_LIMIT_WINDOW_MS=60000
AI_RATE_LIMIT_MAX=30
AI_ENABLE_SSE=true

STORE_PUBLIC_BASE_URL=
STORE_PRODUCT_PATH_TEMPLATE=/productos/:id
```

## Local Testing

Run:

```bash
npm run build --prefix functions
npm test --prefix functions
```

For local API testing:

```bash
npm run dev --prefix functions
```

Then open Swagger at `http://localhost:3000/api-docs`.

## Mocking Gemini And Vertex

Recommended approach in tests:
- mock `src/services/ai/adapters/gemini.adapter.ts`
- mock `src/services/ai/adapters/vertex-tryon.adapter.ts`
- mock `src/services/ai/storage/ai-storage.service.ts`

The module is structured so the orchestrator and workflow services can be unit tested without live external calls.

## Migration Notes

If the project already used the legacy AI service for news summaries:
- keep using `src/services/ai.service.ts`
- no public API change is required
- the implementation now routes through the new Gemini adapter

## Operational Notes

If the deployed environment still has `GEMINI_MODEL_PRIMARY` set to a preview/versioned value such as `gemini-2.5-pro-preview-05-06` or `gemini-3.1-pro-preview`, update it manually to `gemini-2.5-pro`. The backend does not silently fall back across model families.

Rollback path:
- remove `/api/ai` route mounting
- stop exporting `processTryOnJob`
- keep legacy `src/services/ai.service.ts` in place if only news summary must remain active

Known limitation:
- this delivery does not retrofit every legacy route in the repository with the same AI-specific RBAC guarantees; the AI module enforces its own ownership and tool allowlist independently.
