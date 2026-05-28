# LLM / agent context — website-generator

Use this file to restore project context when conversation memory is empty. Prefer reading the conventions below over guessing from generic Next.js or Prisma tutorials.

<!-- BEGIN:nextjs-agent-rules -->

> **Next.js 16 warning:** This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

Human-oriented setup instructions: [`README.md`](./README.md).

> **Deep context (local-only):** detailed architecture, the directory map, the
> data model, security internals, and the roadmap live in `.claude/plans/`
> (gitignored). Start with `.claude/plans/internal-architecture.md`. Keep that
> material OUT of tracked files (`AGENTS.md`, `README.md`) — the repo should not
> expose the implementation surface or unshipped plans.

## One-line summary

AI-powered website generator: Next.js app + PostgreSQL/Prisma + BullMQ worker + an Anthropic-backed generation pipeline with multi-tier stock images, prompt screening, per-IP rate limiting, accounts + guest sessions, and structured JSON logging.

## Non-negotiables for this repo

1. **Prisma 7 + PostgreSQL** — Client is generated to `src/generated/prisma` (gitignored). Constructor uses `PrismaClient` + `new PrismaPg({ connectionString: process.env.DATABASE_URL })` (see `src/lib/db/prisma.ts`). Prisma 7 requires a driver adapter; this project uses `@prisma/adapter-pg` + `pg`.
2. **`DATABASE_URL` required** when importing `prisma` — missing env throws at client construction.
3. **Next.js 16** — App Router under `src/app/`. `@/*` maps to `src/*`.
4. **Package manager is pnpm 10.x** — `package.json` has `packageManager` (Corepack). Use `pnpm install` / `pnpm exec prisma`. Do not add `package-lock.json`. Commit `pnpm-lock.yaml`.
5. **Ownership-gated access** — every project/version/preview/export path is gated on the caller's identity. Preserve this when touching those routes.

## Tech stack (authoritative)

- Next.js 16, React 19, TypeScript, Tailwind v4, **Ariakit** (accessible UI primitives), ESLint (next config).
- **pnpm** + `pnpm-lock.yaml`.
- Prisma 7, PostgreSQL, `pg`, `@prisma/adapter-pg`, `dotenv` (for Prisma CLI + worker).
- **Anthropic SDK** + **OpenAI SDK** (OpenAI + OpenRouter) for generation; stock-image providers for images; optional prompt screening.
- **BullMQ + ioredis** for the job queue; **Cloudflare R2** for object storage (S3-compatible via `@aws-sdk/client-s3`).
- **Auth.js v5** (JWT sessions) for accounts; **next-intl** for localization.

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
