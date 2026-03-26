# WebsitePls (MVP)

An **AI-assisted website generator**: users describe what they want in natural language, and the system eventually produces full pages (layout, copy, and code). The current codebase is a **scaffold** for that MVP—database models, AI pipeline hooks, and a Next.js app—while generation logic is still mostly unimplemented.

## Product direction (short)

- **Near term:** anonymous **tech demo** (no authentication). Iterate on prompt → generated site → preview.
- **Later:** optional accounts, and **bring-your-own API keys** before sharing the product broadly so you are not storing everyone’s provider credentials by default.
- **Retrieval (RAG):** intentionally **out of scope for the first MVP**; static prompts and structured intermediate steps first. A post-MVP plan exists for embeddings and document grounding.

## Tech stack

| Layer | Choice |
| ----- | ------ |
| App framework | [Next.js](https://nextjs.org) 16 (App Router), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Package manager | [pnpm](https://pnpm.io) 10.x (see `package.json` → `packageManager`; [Corepack](https://nodejs.org/api/corepack.html) pins the version) |
| Database | PostgreSQL |
| ORM | Prisma 7 (schema in `prisma/schema.prisma`) |
| DB driver | `pg` via `@prisma/adapter-pg` (Prisma 7 expects a driver adapter for this setup) |
| Linting | ESLint with `eslint-config-next` |

Optional or planned (not all wired yet): AI provider SDKs, job queues (e.g. BullMQ + Redis), object storage for exports.

## Repository layout

```
website-generator/
├── prisma/
│   └── schema.prisma          # PostgreSQL models (User, Project, Version, PublishedSite)
├── prisma.config.ts            # Prisma datasource URL from env
├── pnpm-lock.yaml             # Lockfile (commit this; do not use npm/yarn for installs)
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/health/         # Simple health route
│   │   ├── layout.tsx
│   │   └── page.tsx            # Current landing placeholder
│   ├── generated/prisma/       # Prisma client (generated; gitignored—run `pnpm install` or `pnpm exec prisma generate`)
│   └── lib/
│       ├── db/
│       │   └── prisma.ts       # PrismaClient singleton (requires DATABASE_URL)
│       └── ai/
│           ├── context.ts       # buildContextForAgent — extension point for future RAG/context
│           ├── orchestrator.ts  # Generation pipeline stub
│           ├── types.ts        # SiteSpec / SiteBlueprint placeholders
│           ├── agents/         # For per-step LLM agents (empty)
│           ├── prompts/        # System / few-shot prompts (empty)
│           └── templates/      # HTML section examples (empty)
├── .env.example                # Example environment variables
├── next.config.ts
├── postcss.config.mjs
└── tsconfig.json
```

## Prerequisites

- Node.js (LTS recommended; Node 20+ so **Corepack** can manage pnpm)
- [pnpm](https://pnpm.io/installation) — easiest: `corepack enable` then Corepack will use the version in `packageManager`
- A running **PostgreSQL** instance and a connection string

## Setup

1. Enable Corepack (once per machine) so the pinned pnpm version is used:

   ```bash
   corepack enable
   ```

2. Clone the repo and install dependencies:

   ```bash
   pnpm install
   ```

   `postinstall` runs `prisma generate`, which recreates `src/generated/prisma/`.

3. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your PostgreSQL URL (see [Prisma connection strings](https://www.prisma.io/docs/orm/reference/connection-urls)).

4. Push the schema to the database (good for local dev; use migrations when you want versioned SQL):

   ```bash
   pnpm db:push
   ```

5. Run the dev server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:push` | Push schema to DB (no migration files) |
| `pnpm db:migrate` | Create/apply migrations (`prisma migrate dev`) |
| `pnpm db:studio` | Open Prisma Studio |

## Environment variables

See `.env.example`. At minimum you need `DATABASE_URL` for any code path that uses `src/lib/db/prisma.ts`.

**`UNSPLASH_ACCESS_KEY`** (optional, recommended) — Generated sites use real photos from Unsplash, matched by each `<img>` alt text. Without the key, images stay as the model's placeholder URLs. Sign up at [unsplash.com/developers](https://unsplash.com/developers), create an app, and paste the Access Key. Free tier is 50 req/hr (demo); apply for production to get 5 000/hr.

## Troubleshooting pnpm / Corepack

**`Unknown options: 'allow-build', 'dangerously-allow-all-builds'`** — Recent Node ships Corepack that installs pnpm using flags only supported by **pnpm 10+**. This repo pins **pnpm 10.15.1** in `packageManager`. Pull the latest `package.json`, then:

```bash
corepack enable
corepack use pnpm@10.15.1   # optional: syncs packageManager + runs install
pnpm install
```

If `pnpm --version` still shows 9.x, an older global pnpm (e.g. from npm or nvm) may be first on your `PATH`. Prefer the Corepack shim: `hash -r` after `corepack enable`, or run `corepack pnpm install` once.

## Troubleshooting Redis / `pnpm worker:generate`

**`read ECONNRESET` with Upstash** — BullMQ workers use long-lived and blocking Redis connections. Some managed providers are sensitive to **`ioredis` reconnect behavior**: the library’s default retry backoff can reconnect every 50ms at first, which may worsen reset loops. This repo uses the same **minimum 1s reconnect backoff** BullMQ uses internally, expands **`rediss://` URLs into host/port/password + `tls: {}`** (per Upstash’s BullMQ docs), and defaults **`REDIS_WORKER_DISCONNECT_TIMEOUT=0`** (see `src/lib/queue/redis.ts`). **`REDIS_FAMILY=4`** still helps when IPv6 routing is flaky.

If problems persist, use **local Redis** for development (`docker run -d -p 6379:6379 redis:7-alpine` and `REDIS_URL=redis://localhost:6379`) and keep Upstash for environments where you’ve validated stability.

## Documentation for automation / LLMs

For **dense, repo-specific context** (architecture, conventions, what is stubbed, where to extend), see [`LLM_CONTEXT.md`](./LLM_CONTEXT.md). It is meant to be pasted or loaded into an assistant when long-term memory is unavailable.

## License

Private project (`"private": true` in `package.json`). Add a license file if you open-source it.
