# WebsitePls 

[![CI](https://img.shields.io/github/actions/workflow/status/donth77/website-pls/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/donth77/website-pls/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)

An **AI-powered website generator**: describe what you want in plain language, and the system produces a complete, styled HTML page with real stock photos. Preview it instantly, iterate with refinement prompts, and download the result.

## What it does 

- **Prompt → website**: enter a description, get a full responsive HTML page with Tailwind CSS, real stock images, and photo credits.
- **Iterate**: after generation, describe changes ("make the hero larger", "change colors to blue") and the AI modifies your existing page.
- **Preview**: live iframe preview with fullscreen and open-in-new-tab options.
- **Export**: one-click HTML download of any generated site.
- **Accounts**: sign in to save, revisit, and manage your projects.


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
| Images          | [Unsplash](https://unsplash.com/developers), Pexels, Pixabay (cascade)  |
| Storage         | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible)  |
| Auth            | [Auth.js v5](https://authjs.dev) (credentials + OAuth)                  |

## Prerequisites

- **Node.js 20+** (for Corepack)
- **PostgreSQL** — local or hosted (e.g. [Neon](https://neon.tech))
- **Redis** — local (`redis-server` or Docker) or hosted (e.g. [Upstash](https://upstash.com))
- **Cloudflare R2 bucket** — [dash.cloudflare.com → R2](https://dash.cloudflare.com)
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)

## Setup

```bash
# 1. Enable Corepack (once per machine)
corepack enable

# 2. Install dependencies (runs prisma generate via postinstall)
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY,
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
# AUTH_SECRET

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

