# FinTrack

Household budget & finance tracker. Functional rebuild + expansion of a prior single-user
SvelteKit app (`../FinanceTracker`) into a shared, multi-user Next.js app.

## Documentation

Start here — every other doc in this repo hangs off one of these:

- [`development-workflow.md`](./development-workflow.md) — the process this project follows:
  rigor tier, phase execution loop, Definition of Done. Read this first.
- [`spec.md`](./spec.md) — the approved scope, data model, feature matrix, and numbered phase
  plan (already approved; deviations get logged there live rather than silently drifting).
- [`PROGRESS.md`](./PROGRESS.md) — the living log: what shipped per phase, real bugs found and
  fixed (root cause, not just "fixed a bug"), and why. Read the last entry to see what's current.
- [`RUNBOOK.md`](./RUNBOOK.md) — operational procedures: DB down, Resend down, bad deploy
  rollback, kill-switch usage, session incidents, backup/restore.
- [`AGENTS.md`](./AGENTS.md) / [`CLAUDE.md`](./CLAUDE.md) — entry point for AI coding agents
  working in this repo; points back to the three docs above, in reading order.
- `infra-reference.html` — a local-only, gitignored, point-in-time snapshot of every service
  this app runs on (hosting, database, cron, observability, email, CI/CD). Not committed and
  not auto-regenerated; it's a manual reference doc, not a build artifact.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Neon Postgres · Drizzle ORM · Tailwind v4 ·
shadcn/ui · Recharts · Resend · Vercel.

**Single-currency by design:** every stored amount and every aggregate is SGD
(`lib/format.ts`'s `formatSGD` is the one render path). Multi-currency _accounting_ —
historical FX rates inside the math — is deliberately out of scope; foreign spends are
recorded as the SGD amount actually paid (an FX-assisted entry helper converting at
entry time is planned, but the stored truth stays SGD).

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
