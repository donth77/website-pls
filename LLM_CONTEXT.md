# LLM / agent context — website-generator

Use this file to restore project context when conversation memory is empty. Prefer reading paths below over guessing from generic Next.js or Prisma tutorials.

## One-line summary

**AI-powered website generator MVP**: Next.js app + PostgreSQL + Prisma; anonymous demo first; generation pipeline (`orchestrator`, agents) is mostly not built yet.

## Non-negotiables for this repo

1. **No RAG in MVP** — context for models comes from static prompts, JSON IR (`SiteSpec`, blueprint), and capped chat for refinement later. Do not add vector DB/embeddings until explicitly requested.
2. **Prisma 7 + PostgreSQL** — Client is generated to `src/generated/prisma` (gitignored). Constructor uses `PrismaClient` + `new PrismaPg({ connectionString: process.env.DATABASE_URL })` (see `src/lib/db/prisma.ts`). Prisma 7 requires a driver adapter (or Accelerate); this project uses `@prisma/adapter-pg` + `pg`.
3. **`DATABASE_URL` required** when importing `prisma` — missing env throws at client construction.
4. **Anonymous projects** — `Project.userId` is nullable; auth/BYOK are future. `User` model exists for later use, not required for demo flows.
5. **Next.js 16** — App Router under `src/app/`. `@/*` maps to `src/*`.
6. **Package manager is pnpm 10.x** — `package.json` has `packageManager` (Corepack). **pnpm 9 + current Corepack** can fail with unknown `--allow-build` flags; stay on the pinned pnpm 10 in `packageManager`. Use `pnpm install` / `pnpm exec prisma`. Do not add `package-lock.json` (gitignored). Commit `pnpm-lock.yaml`.

## Tech stack (authoritative)

- Next.js 16, React 19, TypeScript, Tailwind v4, ESLint (next config).
- **pnpm** + `pnpm-lock.yaml`.
- Prisma 7, PostgreSQL, `pg`, `@prisma/adapter-pg`, `dotenv` (for Prisma CLI config).
- No auth SDK installed yet. No AI SDK installed yet (add when implementing generation).

## Directory map

| Path | Role |
| ---- | ---- |
| `prisma/schema.prisma` | Models: `User`, `Project`, `Version`, `PublishedSite`; enum `ProjectStatus` |
| `prisma.config.ts` | Loads `DATABASE_URL`; migrations path |
| `src/lib/db/prisma.ts` | Singleton `PrismaClient` with `PrismaPg` adapter |
| `src/lib/ai/orchestrator.ts` | `runGenerationPipeline` — **stub** (throws until implemented) |
| `src/lib/ai/context.ts` | `buildContextForAgent` — **MVP returns empty suffix**; hook for future RAG |
| `src/lib/ai/types.ts` | `SiteSpec`, `SiteBlueprint` as `Record<string, unknown>` placeholders |
| `src/lib/ai/agents/`, `prompts/`, `templates/` | Empty placeholders for pipeline |
| `src/app/api/health/route.ts` | `GET` → `{ ok: true }` |
| `src/app/page.tsx` | Minimal landing; replace with prompt + preview UI |
| `src/generated/prisma/` | Generated client — **not in git**; regenerate via `pnpm install` or `pnpm exec prisma generate` |

## Data model (mental model)

- **Project** — one user-facing “site” effort; holds `prompt`, optional `siteSpec` JSON, `status`.
- **Version** — numbered snapshot per project (`versionNumber`, optional `blueprint` JSON, `promptDelta`, `storageKey` for blobs later).
- **PublishedSite** — future: subdomain/custom domain + `storageKey`.
- **User** — optional relation; `Project.userId` nullable for anonymous demo.

## Next implementation order (suggested)

1. `POST /api/generate` (or similar): accept prompt, create `Project` + `Version`, call one LLM, return HTML (Tailwind CDN acceptable).
2. UI: textarea + submit + iframe (`srcDoc` or blob) for preview.
3. Persist HTML: add field or object storage strategy (schema may need `generatedHtml` or reliance on `storageKey`).
4. Split orchestrator into intent → blueprint → section code; validation layer (HTML cleanup, Tailwind allowlist).
5. Refinement endpoint + optional queue for long jobs.

## Commands

- `corepack enable` — once per machine (Node’s pinned pnpm via `packageManager`)
- `pnpm install` — deps + `postinstall` → `prisma generate`
- `pnpm dev` — dev server
- `pnpm build` — production build (must pass before merge)
- `pnpm lint`
- `pnpm db:push` — sync schema (dev); `db:migrate` for versioned migrations
- `pnpm exec prisma generate` — client only

## Gotchas

- **Do not import `prisma` in Client Components** — server-only; use Server Actions or API routes.
- **`serverExternalPackages`** in `next.config.ts` includes `pg` and `@prisma/adapter-pg`.
- **ESLint** ignores `src/generated/**`.
- **`AGENTS.md`** contains a Next.js version warning; this file is the **domain** companion.

## Human-oriented README

See `README.md` for setup, scripts, and high-level product description.
