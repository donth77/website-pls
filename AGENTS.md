# LLM / agent context — website-generator

Use this file to restore project context when conversation memory is empty. Prefer reading paths below over guessing from generic Next.js or Prisma tutorials.

<!-- BEGIN:nextjs-agent-rules -->

> **Next.js 16 warning:** This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

Human-oriented setup instructions: [`README.md`](./README.md).

## One-line summary

**AI-powered website generator MVP**: Next.js app + PostgreSQL + Prisma + BullMQ worker + Anthropic orchestrator + Unsplash images + optional Lakera screening; anonymous demo mode with per-IP rate limiting; iteration/refinement on generated sites; structured JSON logging with request correlation IDs.

## Non-negotiables for this repo

1. **Prisma 7 + PostgreSQL** — Client is generated to `src/generated/prisma` (gitignored). Constructor uses `PrismaClient` + `new PrismaPg({ connectionString: process.env.DATABASE_URL })` (see `src/lib/db/prisma.ts`). Prisma 7 requires a driver adapter; this project uses `@prisma/adapter-pg` + `pg`.
2. **`DATABASE_URL` required** when importing `prisma` — missing env throws at client construction.
3. **Anonymous + authenticated ownership** — keep `Project.userId` nullable for anonymous mode; `secretToken` per project for preview access control (guest cookie session planned to replace this after auth is implemented).
4. **Next.js 16** — App Router under `src/app/`. `@/*` maps to `src/*`.
5. **Package manager is pnpm 10.x** — `package.json` has `packageManager` (Corepack). Use `pnpm install` / `pnpm exec prisma`. Do not add `package-lock.json`. Commit `pnpm-lock.yaml`.

## Tech stack (authoritative)

- Next.js 16, React 19, TypeScript, Tailwind v4, **Ariakit** (accessible UI primitives), ESLint (next config).
- **pnpm** + `pnpm-lock.yaml`.
- Prisma 7, PostgreSQL, `pg`, `@prisma/adapter-pg`, `dotenv` (for Prisma CLI + worker).
- **Anthropic SDK** for generation; **Unsplash API** for stock images; **Lakera Guard** (optional) for prompt screening.
- **BullMQ + ioredis** for job queue; **Cloudflare R2** for object storage (generated HTML, S3-compatible via `@aws-sdk/client-s3`).
- Auth provider TBD. Embeddings provider TBD for Phase 1 RAG.

## Directory map

| Path                                        | Role                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                      | Models: `User`, `Project`, `Version`, `PublishedSite`; enum `ProjectStatus`       |
| `prisma.config.ts`                          | Loads `DATABASE_URL`; migrations path                                             |
| `src/app/page.tsx`                          | Landing page — prompt input, preview, refinement UI                               |
| `src/app/api/generate/route.ts`             | `POST` — validate, rate-limit, screen, create project/version, enqueue job        |
| `src/app/api/versions/[versionId]/route.ts` | `GET` — poll job progress (requires `?token=`)                                    |
| `src/app/api/health/route.ts`               | `GET` — shallow; `GET ?deep=true` — checks DB, Redis, Anthropic                   |
| `src/app/preview/[versionId]/route.ts`      | `GET` — serve generated HTML from R2 (requires `?token=`)                         |
| `src/components/`                           | Extracted UI components (generator-app, preview-panel, chat, etc.)                |
| `src/hooks/`                                | Custom React hooks (e.g. `use-generation.ts`)                                     |
| `src/lib/ai/orchestrator.ts`                | `runGenerationPipeline` — structured + fallback paths, images, refinement support |
| `src/lib/ai/promptSafety.ts`                | Input validation + delimiter wrapping                                             |
| `src/lib/ai/lakera.ts`                      | Optional Lakera Guard screening (warns on startup if key missing)                 |
| `src/lib/ai/context.ts`                     | `buildContextForAgent` — hook for Phase 1 RAG                                     |
| `src/lib/db/prisma.ts`                      | Singleton `PrismaClient` with `PrismaPg` adapter                                  |
| `src/lib/queue/`                            | BullMQ queue + Redis connection management                                        |
| `src/lib/storage/r2.ts`                     | Cloudflare R2 client + storage helpers (upload, download, list, delete)           |
| `src/lib/images/unsplash.ts`                | Unsplash photo search with dedup + attribution                                    |
| `src/lib/logger.ts`                         | Structured JSON logging with component scoping + child loggers                    |
| `src/lib/rateLimit.ts`                      | Redis-backed sliding-window per-IP rate limiter                                   |
| `src/workers/generation-worker.ts`          | BullMQ worker — runs pipeline, uploads to R2, tracks progress                     |
| `src/generated/prisma/`                     | Generated client — **not in git**; regenerate via `pnpm install`                  |

## Data model

- **Project** — one user-facing "site" effort; holds `prompt`, `status`, `secretToken` (access control), optional `errorMessage` (persisted on failure).
- **Version** — numbered snapshot per project (`versionNumber`, `promptDelta` for refinements, `storageKey` for R2 HTML).
- **PublishedSite** — future: subdomain/custom domain + `storageKey`.
- **User** — authenticated account (not yet wired).
- **Ownership** — currently `secretToken` per project; planned: `userId` (authenticated) or `guestSessionId` (anonymous cookie).

## What's implemented

| Feature                                                             | Status |
| ------------------------------------------------------------------- | ------ |
| Prompt → generation → preview                                       | Done   |
| Structured output (Claude 4.5+) + fallback                          | Done   |
| Unsplash image search (3-tier fallback + attribution)               | Done   |
| BullMQ queue + worker with progress tracking                        | Done   |
| Iteration/refinement (edit existing generation)                     | Done   |
| Per-IP rate limiting (10/hr, Redis-backed)                          | Done   |
| Secret token access control on preview/status                       | Done   |
| Lakera prompt screening (optional)                                  | Done   |
| Structured JSON logging + request correlation IDs                   | Done   |
| Deep health check (DB + Redis + Anthropic)                          | Done   |
| Error message persistence on Project                                | Done   |
| Download HTML                                                       | Done   |
| UX polish (char counter, Cmd+Enter, prompt examples, elapsed timer) | Done   |

## Possible future directions (not committed)

> These are rough ideas at various stages of exploration — none are committed or fully designed. Sections below capture early research and thinking where it exists.

1. **Phase 1 RAG** — one `.txt`/`.pdf` per project, chunk + embed, top-k retrieval. See RAG section below.
2. **Publish + export** — vanity slugs, public R2 URLs, `POST /api/publish`, `GET /p/[slug]` redirect. See Publish section below.
3. **Split orchestrator** into intent → blueprint → section code; validation layer.
4. **Stock video hero backgrounds** — muted autoplay `<video>` in hero sections using Pexels/Pixabay video APIs (Unsplash has no video API). Scoped to one video per page; orchestrator decides when a video hero suits the site type; always include a `poster` image fallback. Medium quality (720p) to limit payload. See research notes below.
5. **JWT session revocation** — when admin/ban tooling is built, add a short `maxAge` (e.g., 5 minutes) to the JWT session so the `jwt` callback periodically revalidates against the DB. Gives near-instant revocation without sacrificing resilience during DB outages.

---

## Phase 1 RAG (single attachment, no chat)

**Goal:** User attaches **one** text or PDF per generation flow; we chunk + embed, retrieve **top-k** chunks using the **user prompt as the query**, and inject a short context block into `runGenerationPipeline`. UX stays **one page, one Generate button** (optional file input).

### Dependencies & infrastructure

- **Postgres `pgvector`** — enable extension. Store one embedding per chunk.
- **Embedding provider** — Anthropic has no embedding API; use **OpenAI** `text-embedding-3-small` or similar. New env: `OPENAI_API_KEY`.
- **PDF text**: server-only library (e.g. `pdf-parse`); **plain text** read as UTF-8. Cap file size (5–10 MB).

### Schema

- **`ProjectSourceDocument`**: `projectId`, `storageKey`, `mimeType`, `originalFilename`, `status`.
- **`ProjectKnowledgeChunk`**: `id`, `projectId`, `ordinal`, `content`, `embedding` (pgvector).

### Implementation order

1. Migration: pgvector + source/chunk tables.
2. Lib: `extractTextFromPdf`, `chunkText`, `embedTexts`, `retrieveTopKForPrompt`.
3. Wire ingestion into `POST /api/generate` (multipart) before enqueue.
4. Wire retrieval in worker/orchestrator; pass `ragContext` into message builder.
5. UI: file input + FormData.
6. Update `.env.example`.

---

## Publish & export (planned)

### Goals

1. **Public HTML** from R2 via vanity redirect.
2. **Vanity URL:** optional slug or auto-generated segment → `https://{host}/p/{segment}` → 302 to R2 public URL.

### Implementation order

1. R2 bucket policy for `published/*` public read.
2. Slug validators + segment allocator.
3. `POST /api/publish` + `GET /p/[slug]` redirect route.
4. UI: optional slug field + publish button + copy link.
5. `GET /api/versions/[versionId]/export` — attachment download.

---

## Stock video hero backgrounds (planned)

### Research summary

- **Unsplash** has no video API — photos only.
- **Pexels** video search: `GET https://api.pexels.com/videos/search` — same auth header as photos. Returns `video_files[]` with `quality` (hd/sd), `file_type`, `width`, `height`, `fps`, `link` (direct MP4 URL). Shares the 200 req/hr free rate limit with photo searches.
- **Pixabay** video search: `GET https://pixabay.com/api/videos/` — same `key` param as photos. Returns `videos` object with `large` (1080p), `medium` (720p), `small` (~360p), `tiny` (~270p) variants, each with `url`, `width`, `height`, `size`. Shares the ~5,000 req/hr limit with photo searches.

### Design constraints

- **One video per page max** (hero section only) — a 10s 720p clip is 2-5 MB.
- **Muted autoplay loop**: `<video autoplay muted loop playsinline>` with dark overlay + text.
- **Poster image fallback** via existing image pipeline — required for mobile (iOS/Android restrict autoplay) and slow connections.
- **Opt-in, not default** — orchestrator decides per-generation whether the site type benefits (e.g., restaurant/travel yes, SaaS pricing page no).
- **Hotlinking concern** — generated HTML references Pexels/Pixabay CDN URLs directly; less stable than Unsplash's explicit hotlink support. May need to proxy or cache.
- **Cascade: Pexels → Pixabay** (two tiers, no Unsplash).

### Implementation order

1. `src/lib/videos/pexels-video.ts` + `pixabay-video.ts` — same pattern as image modules.
2. `src/lib/videos/video-search.ts` — facade with Pexels → Pixabay fallback.
3. Orchestrator: add video hero decision to blueprint step; new `videoQuery` field in structured output.
4. Worker: call video search when `videoQuery` is present; inject `<video>` markup with `poster`.
5. Update `.env.example` (no new keys needed — reuses existing Pexels/Pixabay keys).

---

## Commands

- `corepack enable` — once per machine
- `pnpm install` — deps + `postinstall` → `prisma generate`
- `pnpm dev` — starts **both** Next.js dev server and BullMQ worker
- `pnpm build` — production build (must pass before merge)
- `pnpm lint`
- `pnpm db:push` — sync schema to DB (dev)
- `pnpm db:migrate` — versioned migrations
- `pnpm exec prisma generate` — regenerate client only

## Database safety

- **NEVER** run `DELETE`, `DROP`, `TRUNCATE`, `UPDATE`, or `ALTER` statements against the database without explicit user confirmation.
- **NEVER** run `pnpm db:push`, `pnpm db:migrate`, `prisma migrate`, or `prisma db push` without explicit user confirmation.
- **NEVER** use Prisma Client write methods (`create`, `update`, `delete`, `deleteMany`, `updateMany`, `upsert`, `createMany`) in ad-hoc scripts or REPL sessions without explicit user confirmation.
- For ad-hoc queries and investigation, use **`SELECT` only**.
- When a read-only connection string is available (`DATABASE_URL_READONLY`), prefer it for any exploratory or diagnostic queries.

## Gotchas

- **Do not import `prisma` in Client Components** — server-only; use Server Actions or API routes.
- **`serverExternalPackages`** in `next.config.ts` includes `pg` and `@prisma/adapter-pg`.
- **ESLint** ignores `src/generated/**`.
- **Worker needs `dotenv/config`** — imported at top of `generation-worker.ts`; Next.js loads `.env` automatically but the standalone worker does not.
- **`pnpm dev` runs the worker via `&` + trap** — both processes start from one command; Ctrl+C kills both.
