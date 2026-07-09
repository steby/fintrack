# FinTrack

Household budget & finance tracker. Functional rebuild + expansion of a prior single-user
SvelteKit app (`../FinanceTracker`) into a shared, multi-user Next.js app.

## Process

This project follows a Phase-Driven, Test-Backed methodology — see
[`development-workflow.md`](./development-workflow.md). The approved spec and numbered phase
plan live in [`spec.md`](./spec.md). Status is tracked in [`PROGRESS.md`](./PROGRESS.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Neon Postgres · Drizzle ORM · Tailwind v4 ·
shadcn/ui · Recharts · Resend · Vercel.

## Getting started

Prerequisites: Node (see `.nvmrc`), a Neon Postgres project with two branches (one for local
dev, one for CI — see `spec.md` Phase 0 step 3), and `npm`.

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL, SESSION_SECRET, CRON_SECRET, SEED_OWNER_*
npm run db:migrate      # apply migrations
npm run db:seed         # idempotent — safe to re-run
npm run dev             # http://localhost:3000
```

Everything except `DATABASE_URL`/`SESSION_SECRET` is keys-optional (`RESEND_API_KEY`,
`SENTRY_DSN`) — the app runs and tests identically without them, just logging instead of
sending real email / skipping remote error reporting.

Common scripts: `npm test` (unit), `npm run test:integration` (needs a real DB),
`npm run test:e2e` (Playwright, starts its own dev server), `npm run lint`,
`npm run typecheck`, `npm run build`.

Operational runbook (DB down, Resend down, rollback, kill-switches): [`RUNBOOK.md`](./RUNBOOK.md).
