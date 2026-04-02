# WebsitePls (MVP)

An **AI-powered website generator**: describe what you want in plain language, and the system produces a complete, styled HTML page with real stock photos. Preview it instantly, iterate with refinement prompts, and download the result.

## What it does today

- **Prompt → website**: enter a description, get a full responsive HTML page with Tailwind CSS, real Unsplash images, and photo credits.
- **Iterate**: after generation, describe changes ("make the hero larger", "change colors to blue") and the AI modifies your existing page.
- **Preview**: live iframe preview with fullscreen and open-in-new-tab options.
- **Download**: one-click HTML download of any generated site.
- **Safety**: optional Lakera Guard prompt screening, per-IP rate limiting, delimiter-based prompt injection defense.

## Product direction

- **Near term**: anonymous tech demo with a path to user accounts, credits/paywall, and publishing (vanity URLs).
- **Planned**: Phase 1 RAG (attach a document for context-aware generation), auth + guest sessions, publish flow.
- **Later**: bring-your-own API keys, multi-page sites, version history UI.

## Tech stack

| Layer           | Choice                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| App framework   | [Next.js](https://nextjs.org) 16 (App Router), React 19                 |
| Language        | TypeScript                                                              |
| Styling         | Tailwind CSS v4                                                         |
| Package manager | [pnpm](https://pnpm.io) 10.x (Corepack-pinned)                          |
| Database        | PostgreSQL via [Prisma](https://www.prisma.io) 7 + `@prisma/adapter-pg` |
| Job queue       | [BullMQ](https://docs.bullmq.io) + Redis                                |
| AI              | [Anthropic SDK](https://docs.anthropic.com) (Claude)                    |
| Images          | [Unsplash API](https://unsplash.com/developers)                         |
| Storage         | [Supabase](https://supabase.com) (object storage for generated HTML)    |
| Screening       | [Lakera Guard](https://www.lakera.ai) (optional)                        |

## Prerequisites

- **Node.js 20+** (for Corepack)
- **PostgreSQL** — local or hosted (e.g. Supabase)
- **Redis** — local (`redis-server` or Docker) or hosted (e.g. Upstash)
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)

## Setup

```bash
# 1. Enable Corepack (once per machine)
corepack enable

# 2. Install dependencies (runs prisma generate via postinstall)
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# 4. Push schema to database
pnpm db:push

# 5. Start dev server + worker (single command)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Health check: [http://localhost:3000/api/health?deep=true](http://localhost:3000/api/health?deep=true).

## Scripts

| Command                | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `pnpm dev`             | Dev server **+ BullMQ worker** (both processes)        |
| `pnpm build`           | Production build                                       |
| `pnpm start`           | Start production server                                |
| `pnpm lint`            | ESLint                                                 |
| `pnpm worker:generate` | Run BullMQ worker standalone (if not using `pnpm dev`) |
| `pnpm db:generate`     | Regenerate Prisma client                               |
| `pnpm db:push`         | Push schema to DB (no migration files)                 |
| `pnpm db:migrate`      | Create/apply migrations (`prisma migrate dev`)         |
| `pnpm db:studio`       | Open Prisma Studio                                     |

## Environment variables

See [`.env.example`](.env.example) for full documentation. At minimum:

| Variable                    | Required    | Purpose                                                |
| --------------------------- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL`              | Yes         | PostgreSQL connection string                           |
| `REDIS_URL`                 | Yes         | Redis for BullMQ (`redis://` or `rediss://`)           |
| `ANTHROPIC_API_KEY`         | Yes         | Claude API for generation                              |
| `SUPABASE_URL`              | Yes         | Supabase project URL                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes         | Supabase admin key (server-only)                       |
| `UNSPLASH_ACCESS_KEY`       | Recommended | Real stock photos; without it, images are placeholders |
| `LAKERA_API_KEY`            | Optional    | Prompt screening; skipped if unset (warning logged)    |
| `ANTHROPIC_MODEL`           | Optional    | Defaults to `claude-sonnet-4-5-20250514`               |

## Troubleshooting

### pnpm / Corepack

**`Unknown options: 'allow-build'`** — Your global pnpm is too old. This repo pins pnpm 10.x:

```bash
corepack enable
corepack use pnpm@10.15.1
pnpm install
```

### Redis / BullMQ worker

- **Stuck at "Starting..."** — The BullMQ worker may not be running. `pnpm dev` starts both the server and worker; check that Redis is reachable.
- **`ECONNRESET` with Upstash** — See `.env.example` for TLS and timeout configuration. Try `REDIS_FAMILY=4` for IPv6 issues. For local dev, plain `redis://localhost:6379` is simplest.

### Generation takes 1-3 minutes

Normal for full-page generation with Claude Sonnet. The progress bar updates as the model streams. For faster (simpler) results, set `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` in `.env`.

## Documentation for agents / LLMs

See [`AGENTS.md`](./AGENTS.md) for dense, repo-specific context: architecture, conventions, what's implemented, what's planned, and where to extend.

## License

Private project (`"private": true` in `package.json`).
