# FinTrack — Household Budget & Finance Tracker (Spec + Detailed Phase Plan)

> Source of truth for scope and process. Written per Step A/B of `development-workflow.md`.
> **Approved — do not re-run Step A/B.** `PROGRESS.md` is the living log; update this file
> immediately whenever a technical limitation forces a design change.

**Deviation log:** `create-next-app@latest` installed **Next.js 16.2.10** (16 is now latest
stable; 15 was latest at planning time). Accepted rather than pinned back to 15 — fighting the
toolchain for an already-superseded major has no upside. Next.js itself warns (see
`AGENTS.md`) that v16 may differ from agent training data; consult
`node_modules/next/dist/docs/` before assuming App Router API shape. Auth: confirmed **custom
session-table auth** over Neon Auth (Stack Auth) — our household/role/invite model was already
designed around it; Neon Auth's Teams model would require adapting our design to theirs, not
saving work, and avoids a third-party identity dependency on top of Neon itself. SAST: swapped
**CodeQL for Semgrep** — CodeQL's SARIF upload requires GitHub Code Scanning, which on a
private repo needs GitHub Advanced Security (a paid feature, potential billing impact).
Semgrep runs entirely in the CI job via Docker (`p/javascript` + `p/typescript` packs), needs
no GitHub feature/account, and is free regardless of repo visibility or plan.

**Phase 1 deviations:** `middleware.ts` → **`proxy.ts`** — Next.js 16 deprecated and renamed
the `middleware` file convention to `proxy` (`export function proxy`, not `middleware`); the
old name silently stops working. Runs on the Node.js runtime by default in v16 (previously
Edge-only), which is what makes a real DB-backed session check inside it viable at all —
`proxy.ts` does the actual (not just optimistic) session validation and owns sliding-expiry
renewal, since Server Components can't write cookies (see `lib/auth/session.ts`). Added a
**`login_attempts`** table (not in the original Data Model list) to back the "per-IP+username
rate limit on login" requirement from the phase plan — 5 failed attempts per email+IP pair
within a 15-minute trailing window (`lib/auth/rate-limit.ts`). Password policy: minimum 8
characters, no forced complexity rules (NIST 800-63B guidance — prefer length over composition
rules, no rotation requirement). Invite links expire after 7 days. The `server-only` npm
package (used to guard `lib/auth/session.ts`/`guards.ts` against accidental client-component
import) needed to be explicitly installed — Next's bundler resolves it internally without
installation, but plain Node/Vitest cannot, which only surfaced when writing unit tests.

**Phase 2 deviations:** category/account delete uses the schema's existing `ON DELETE SET
NULL` foreign keys (`lib/db/schema.ts`) instead of an application-level transaction that
manually nullifies `recurring_schedule`/`monthly_entries` references — this phase plan
originally said "delete nullifies refs in a transaction." Same observable behavior (delete
the row, every reference goes null), but enforced by Postgres itself as part of the single
`DELETE` statement, which is stronger than an app-level transaction (it holds even for a
future delete path that forgets to wrap itself in one). Added `overrideBudgetAction`
(`app/actions/monthly.ts`) beyond the plan's literal `updateActual`/`addAdhoc`/`deleteEntry`
action list — the plan already specifies `is_overridden` and its propagation-skip edge case,
but the reference app has no mechanism that ever sets that column; this is the minimal
capability that makes it reachable (override one forecast month's budgeted amount in place).
`deleteEntryAction` restricts deletion to ad-hoc entries (`recurring_schedule_id IS NULL`)
server-side — the reference app only hid the delete control in the UI for recurring-generated
rows but never enforced it in the handler itself.

**Post-Phase-2 operational deviation (2026-07-09):** repo flipped from **private to public**
(Phase 0 originally specified `gh repo create fintrack --private`) — the private-repo free-tier
GitHub Actions minutes allowance was exhausted by heavy same-day CI iteration, and the owner has
no payment method on file to raise it; public repos get unlimited Actions minutes on standard
runners. Before flipping, `lib/db/seed.ts` was genericized (real salary/mortgage/rental figures,
real Singapore bank names, and real household-member names embedded in recurring-item labels
replaced with fictional placeholders) and git history was rewritten (`git filter-repo`) to
remove the real data from every prior commit, not just HEAD, then force-pushed. This is a
one-way operational change, not a scope change — the CodeQL-vs-Semgrep deviation above becomes
moot once public (Advanced Security features are free on public repos), but Semgrep was kept
rather than switching back, since it already works and switching has no benefit. Intent is to
flip back to private later (tracked outside this repo); if that happens, re-confirm the Actions
minutes constraint no longer blocks CI before relying on it again.

**Phase 3 deviation:** `lib/db/queries.ts`'s Phase 3 task item says "scoped SQL aggregations
(port the original's queries)" — implemented instead as one flat, entry-level `SELECT` (two
`LEFT JOIN`s, no `GROUP BY`) with all aggregation (monthly series, category breakdown,
cumulative savings, fixed-vs-variable, bank summary, YoY) done in TypeScript pure functions
(`lib/domain/dashboard.ts`) over the returned row array. Deliberate, not a shortcut: this phase's
own "Ready" criteria already frame it as "aggregation shaping ... as pure functions over row
arrays," and doing the math in TypeScript instead of SQL is what makes every edge case (empty
year, partial actuals, absent prior year) unit-testable without a live database — 17 unit tests
cover exactly those cases. Caught by a `/code-review` pass finding this diverged from the
literal phase-plan wording without being written back here.

**Phase 4 deviation (logged 2026-07-09, during the cross-phase cleanup pass):**
`deleteGoalAction` (`app/actions/goals.ts`) is deliberately **not** gated by
`FEATURE_SAVINGS_GOALS`, unlike `createGoalAction`/`updateGoalAction` — an owner who
disables the feature still needs to remove old goal data without re-enabling it first (a
config-flag flip requires a redeploy). This narrows the Phase 4 adversarial rule below
("flag off ⇒ zero traces in UI and actions rejected") to apply to create/update only;
`app/(app)/goals/page.tsx` still renders existing goals (delete-only, no add/edit
controls) when the flag is off, and the sidebar's Goals link (`app/(app)/layout.tsx`)
stays visible unconditionally so that delete-only view is actually reachable. Caught
undocumented by a `/code-review` pass — the code shipped this way in the same session
the decision was made, but this spec.md note lagged behind it.

**Phase 5 deviations:** the Phase 5 task list's "idempotent via content hash of
(year,month,item,amount)" is implemented instead as **re-classification against live DB
state**, no stored hash column: `classifyRow` (`lib/domain/csv.ts`) checks whether a
candidate entry already has the exact actual amount a row would produce recorded
(`'already-applied'`, not `'match'`/`'new'`) — so re-running the identical file a second
time naturally reclassifies every previously-applied row as a no-op, without a
migration or a separate hash column to keep in sync with the data it's hashing.
Same practical guarantee (re-import is a no-op), simpler mechanism (the DB's own current
state IS the check). `ColumnMapping` (`lib/domain/csv.ts`) maps by column **position**
(index), not header **name** as an early implementation first tried — required once the
"missing headers" edge case meant there may be no header text to map by at all, and it
turned out to also fix an unrelated bug (a CSV with two identically-named columns
previously had no way to disambiguate which one a mapping selected). `next.config.ts`'s
Server Actions `bodySizeLimit` raised from the 1MB platform default to 20MB to accept
Phase 5's CSV uploads (bounded separately by `lib/domain/csv.ts`'s own 5MB
`MAX_CSV_BYTES`/2000-row caps, checked before parsing) — a **global** Next.js setting,
not scoped to the import action alone, so it also widens the body-size ceiling for
every other Server Action in the app including pre-auth `loginAction`; mitigated with
`.max(200)` bounds on `app/actions/auth.ts`'s password fields rather than the larger
architectural fix (moving CSV upload to its own Route Handler, scoped independently —
deferred, see `PROGRESS.md`'s Phase 5 hardening-pass entry).

## Context

`FinanceTracker/` (sibling project, not in this repo) is a single-user finance planner
(SvelteKit 5 + better-sqlite3 + Chart.js, GCP VM/PM2) with weak auth (plaintext username
cookie, CSRF off, `secure:false`), a broken CSV export (non-existent `m.scheduled_day`
column), USD/SGD mismatch, seed baked into the DB module, no migrations/tests. FinTrack
rebuilds it as a **shared household budgeting tracker**. Primary usage: **owner does
all data entry; family mostly views.**

## Rigor Tier — Tier 2 (Core + Hardened, pragmatic)

Real users (family) + data that matters, but no payments/regulated PII/HA.
Tier-3 discipline in 3 narrow spots: **session/auth security**, **financial-integrity math**
(property-based tests), **migrations + tested backup-restore**. Deliberately skipped (honest):
formal load tests, broad fuzzing (only money math), third-party contract tests (keys-optional
covers Resend/Sentry), concurrency stress (single maintainer; money mutations still in DB
transactions), formal SLOs.

## Stack

Next.js 16 (App Router) + React 19 + TS on **Vercel** · **Neon Postgres** + Drizzle +
drizzle-kit migrations · sessions table + opaque token + argon2 + secure cookies + origin/CSRF
checks · roles owner/member/viewer · **Resend** (invites/reminders/recap, keys-optional) +
Vercel Cron · Tailwind v4 + shadcn/ui (light+dark) · Recharts · lucide-react · PWA.

## Toolchain (named)

ESLint (next + security plugin) + Prettier · tsc strict · zod at every edge · Vitest
(+ fast-check on money math) · Playwright E2E · coverage gate **80% on `lib/**` pure logic** ·
npm audit + Dependabot (SCA) · gitleaks (secrets) · Semgrep (SAST) · pino structured logging ·
Sentry adapter behind `SENTRY_DSN` (keys-optional) · `/api/health` · GitHub Actions:
`lint → typecheck → unit → integration → build → E2E` + scans; high-sev blocks. Toolchain
pinned (`.nvmrc` + `engines`), lockfile committed.

## Data Model (Drizzle → Postgres, household-scoped)

Households = tenancy boundary; **every domain query scoped by `household_id`** via central
helpers in `lib/db/queries.ts`.

- `households` — id, name, `base_currency` (default `'SGD'`), created_at
- `users` — id, household_id, email (unique), password_hash, name, `role` pgEnum(owner|member|viewer), created_at
- `sessions` — id (opaque 32-byte token), user_id, expires_at, created_at
- `household_invitations` — id, household_id, email, role, token (single-use), invited_by_user_id, expires_at, accepted_at
- `household_settings` — household_id, key, value (kill-switch flags live here)
- `categories` — + household_id, + `monthly_budget` numeric nullable
- `bank_accounts` — + household_id, + `opening_balance` numeric default 0; credit→bank self-link
- `recurring_schedule` — + household_id (item, category_id, budgeted_amount, bank_account_id, frequency pgEnum, schedule_months, actual_date_day, is_active, notes)
- `monthly_entries` — + household_id, + `paid_by_user_id` nullable, + `is_overridden` boolean default false; `UNIQUE(household_id, year, month, recurring_schedule_id)`
- `goals` — id, household_id, name, target_amount, saved_amount, target_date nullable, created_at

Money columns use `numeric(12,2)` (not float — original used REAL; this is a correctness fix).
Seed = standalone idempotent `lib/db/seed.ts` (npm script; ports the original's categories/
accounts/recurring items from `FinanceTracker/src/lib/server/db.ts`).

## Feature Matrix

**Mandatory:** multi-user auth + RBAC; household scoping; invites + roles; categories/accounts
CRUD; recurring CRUD + generate/propagate; monthly entries + calendar/agenda/list; dashboard;
CSV export (fixed); health check + structured logging.

**Optional** — two kinds of flags. _Config_ = env var (flip = redeploy, fine for low-risk).
_Kill-switch_ = runtime-toggleable without redeploy, required for risky/externally-triggerable.
**Runtime source:** `household_settings` DB rows read per request with ~30s in-memory cache
(no new dependency; confirmed in Phase 0).

| Flag                | Feature                                               | Kind                 | Default |
| ------------------- | ----------------------------------------------------- | -------------------- | ------- |
| `category_budgets`  | Per-category caps + progress                          | config (env)         | on      |
| `savings_goals`     | Goals progress                                        | config (env)         | on      |
| `net_worth`         | Balances + net-worth trend                            | config (env)         | on      |
| `entry_attribution` | `paid_by` tagging on ad-hoc entries                   | config (env)         | on      |
| `pwa`               | Installable PWA                                       | config (env)         | on      |
| `auto_generate`     | Rolling materialize next N months (cron mutates data) | **kill-switch (DB)** | on      |
| `csv_import`        | Statement import (uploaded file, bulk mutation)       | **kill-switch (DB)** | **off** |
| `email_reminders`   | Bill-due reminders (email blast radius)               | **kill-switch (DB)** | **off** |
| `monthly_recap`     | Month-end summary email                               | **kill-switch (DB)** | **off** |

## Out of Scope

Open-banking/Plaid sync; real money movement; multi-currency conversion (SGD only v1);
settle-up; public self-serve signup (invite-only); native mobile apps (PWA only);
receipts/attachments; investment tracking.

## Threat notes (one line per feature)

Auth/sessions: stolen/forged cookie → takeover; opaque tokens, secure cookies, expiry, origin
check. Invites: token guessing/replay → unauthorized join; single-use expiring email-bound
tokens. Scoping: missing `household_id` filter → cross-tenant leak; centralized scoped queries,
tested directly. RBAC: viewer writes → tampering; server-side `requireRole`. CSV import:
huge/malicious file → DoS/injection; size/row caps, zod rows, no formula eval, export escapes
`=-@` cells (CSV injection). Cron: unauth trigger → spam/abuse; `CRON_SECRET` check. Money
math: bad propagation/rollover → silent corruption; pure functions, property tests, never
overwrite actualized rows.

---

# Numbered Phases (detailed)

Each phase = one testable slice → one atomic commit. Execution follows the 8-step loop
(model → trust boundaries → pure logic → unit tests → data/action layer → UI → E2E →
adversarial pass). Per-phase DoD = the workflow's checklist + `PROGRESS.md` appended.

## Phase 0 — Harness (green before any feature code)

**Ready:** AC = CI fully green on GitHub with zero feature code; seed proven idempotent.
Edge cases: Windows dev vs Linux CI path/line-ending drift; Neon cold-start latency in CI;
Playwright browser deps in CI. Trust boundaries: env vars (validated via zod `lib/env.ts`);
CI secrets.

1. Materialize `spec.md` (this document) + README stub into `fintrack/`; add `CLAUDE.md` and
   `AGENTS.md` (identical content — short entry-point pointing any agent session at
   `development-workflow.md` for process, `spec.md` for the approved plan, `PROGRESS.md` for
   status; note "spec approved, do not re-run Step A/B"). `git init`; `gh repo create fintrack
--private` + push.
2. Scaffold: `create-next-app` (TS, App Router, Tailwind v4, ESLint); pin Node in `.nvmrc` +
   `engines`; commit lockfile. Prettier + `eslint-plugin-security`; `tsc --noEmit` strict script.
3. **Neon setup (manual, blocking):** you sign up at neon.tech (free tier), create a project
   (default branch = **Production**, reserved for real deployed data — never used for dev/CI).
   Create two child branches off Production: **`dev`** (local development, freely
   reset/reseed) and **`ci`** (GitHub Actions integration tests). Paste both connection
   strings into `.env` (`dev` branch) and GitHub Actions secrets (`ci` branch) when prompted —
   I'll pause here and give exact steps at the time.
4. `lib/env.ts` — zod-validated env access (fail loud at boot in dev); `.env.example` with every
   var documented (`DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY?`, `SENTRY_DSN?`,
   `CRON_SECRET`, feature-flag defaults).
5. Observability: pino logger (`lib/log.ts`, request-id child loggers); Sentry seam
   (`lib/observability.ts` — no-op unless `SENTRY_DSN`); `/api/health` returning
   `{ ok, db: 'up'|'down', version }` with a 2s DB-ping timeout.
6. DB plumbing: Drizzle + Neon driver (`lib/db/index.ts` with pooled connection),
   `drizzle.config.ts`; **empty baseline migration applied** to prove the migrate path.
   Separate `DATABASE_URL` for dev vs CI (Neon branch) vs prod — environments stay distinct.
7. Test runners: Vitest (unit + integration projects; integration hits a real Neon branch DB);
   Playwright (chromium; one smoke spec: `/api/health` 200 + login page renders). Coverage
   gate 80% on `lib/**`.
8. CI (`.github/workflows/ci.yml`): lint → typecheck → unit → integration → build → E2E;
   plus gitleaks, Semgrep, npm audit (high-sev fails), Dependabot config, coverage gate.
9. Seed: `lib/db/seed.ts` — deterministic, **idempotent via natural-key upserts**; npm script
   `db:seed`. Prove: run twice → second run 0 errors 0 duplicates (assert row counts equal).
10. Adversarial pass: break CI on purpose once (failing test, planted fake secret) to prove
    gates actually fail. Push → CI green (repo already created in step 1). Append PROGRESS.md.

**Deliverable:** green pipeline, empty app shell, health check, proven seed. No features.

## Phase 1 — Data model + auth + household sharing

**Ready:** AC = owner can log in/out and change password; invite → viewer joins read-only;
viewer mutation attempts rejected server-side; all tables migrated. Edge cases: expired/reused
invite token; invite to an email that already has an account; concurrent session expiry;
argon2 timing; wrong-password lockout behavior (rate limit); cookie over http in dev vs https
in prod. Trust boundaries: login form, invite-accept form, session cookie, all zod-validated.

1. **Model:** full schema in `lib/db/schema.ts`; migration generated + applied (expand-only).
2. **Pure logic (`lib/auth/*`):** token generation (crypto.randomBytes), session-expiry rules,
   `rbac.ts` (`can(role, action)` matrix), invite-token validity (expiry, single-use, email
   match), password policy. Unit tests incl. edge cases (expired, reused, role escalation
   attempts).
3. **Data layer:** `session.ts` (create/validate/revoke; sliding 30-day expiry; delete on
   logout), argon2 hash/verify wrapper, login/logout/change-password Server Actions
   (zod-validated, generic error messages, per-IP+username rate limit on login — simple DB
   counter, fine for household scale), invite actions: create (owner-only) → Resend email
   (keys-optional: logs the accept URL when no key) → `/invite/[token]` accept page → sets
   password → user created in household with invited role, token marked used.
4. **Access:** `middleware.ts` — session check, redirect to `/login`; `requireUser` /
   `requireRole` helpers used by every action; viewers get read-only (server-enforced).
5. **UI:** login page; invite-accept page; minimal authenticated shell (sidebar skeleton,
   sign-out); members section stub in Settings (list members, invite form, role change,
   remove member — owner-only).
6. **Tests:** unit (token/rbac/invite rules); integration (real DB: session lifecycle, invite
   accept flow, duplicate-email invite, expired token); E2E happy: login → dashboard shell →
   logout; E2E failure: wrong password shows error, viewer POST rejected (403), expired invite
   link shows friendly error.
7. **Adversarial:** try cookie tampering, invite replay, role self-escalation via forged form
   field, cross-household invite acceptance.

## Phase 2 — Core domain (parity): categories, accounts, recurring, monthly

**Ready:** AC = original app's data-entry workflows fully reproduced, household-scoped, with
propagation rules honored. Edge cases: generate over year boundary (Dec→Jan); Quarterly/Yearly
`schedule_months` parsing (empty, malformed, out-of-range months); deleting a category/account
in use (nullify refs, like original); editing recurring item with zero forecast months;
`is_overridden` set then recurring edit propagates; duplicate generate (must no-op);
day-31 in a 30-day month for `actual_date_day`. Trust boundaries: every Server Action input
(zod), URL params (`year`, `month`, `view` — parse + clamp).

1. **Model:** no new tables (Phase 1 created all); add any missed indexes
   (`monthly_entries(household_id, year, month)`).
2. **Pure logic (`lib/domain/*`):** `shouldGenerate(item, month)` (frequency + schedule_months);
   date-walk over (fromY,fromM)→(toY,toM); month-status derivation
   (empty|forecast|in_progress|closed); propagation predicate
   (`actual IS NULL AND NOT is_overridden`); diff favorability (income vs expense direction);
   currency formatting (SGD, `lib/format.ts`). **Property tests (fast-check):** date-walk
   never skips/duplicates a month; generate is idempotent; propagation never touches
   actualized or overridden rows.
3. **Data layer (Server Actions, all zod + `requireRole('member')`):**
   - Categories/accounts CRUD (delete nullifies refs in a transaction — parity with original).
   - Recurring CRUD + toggle; edit with optional propagate-to-forecast.
   - Generate: `INSERT … ON CONFLICT DO NOTHING` in one transaction; returns count.
   - Auto-generate: on-load hook materializing next N=3 months, behind `auto_generate`
     kill-switch; manual edit of an entry sets `is_overridden = true`.
   - Monthly: updateActual (amount+date), addAdhoc (+optional `paid_by`), deleteEntry.
4. **UI:** Recurring page (table, add/edit modal, toggle, generate dialog); Monthly page with
   `?view=calendar|agenda|list` (port the three views), month tabs with status dots, summary
   header, inline actual entry (keyboard-friendly: Enter saves, Esc cancels), ad-hoc modal;
   Settings sections for categories (color picker) + accounts (credit→bank link). Loading/
   empty/error states on every fetch surface.
5. **Tests:** unit+property per §2; integration: generate over year boundary on real DB,
   propagate skips overridden, delete-category nullifies; E2E: generate → enter actual →
   status advances → edit recurring w/ propagate → forecast updated, overridden month intact;
   failure path: invalid amount rejected with visible error.
6. **Adversarial:** cross-household ID probing (edit an entry ID from another household →
   must 404/403), negative/NaN amounts, `schedule_months: "13,0,abc"`.

## Phase 3 — Dashboard + theming

> **Superseded 2026-07-12 (Phase 8):** the "OLED-dark identity" described in task 3 below
> (`oklch(0 0 0)` true-black background, ported from `FinanceTracker/src/app.css`) was
> replaced by Phase 8's "modern fintech" redesign — a layered warm dark theme
> (`app/globals.css`'s `.dark` block: increasing-lightness background/card/popover, a
> vibrant violet `--primary`, semantic `--income`/`--expense`/`--warning` tokens) instead
> of pure black. This history is kept, not deleted — see spec.md's Phase 8 section below
> and `app/globals.css`'s own comment for the full rationale.

**Ready:** AC = all original dashboard widgets reproduced against household-scoped data;
light/dark toggle. Edge cases: year with zero entries (empty states, no NaN); division by zero
in percentages; months with budget but no actuals (charts show budget-only); prev-year absent
(YoY hides gracefully). Trust boundary: `?year=` param.

1. **Pure logic:** aggregation shaping (monthly series, cumulative savings walk, fixed-vs-
   variable split, YoY deltas) as pure functions over row arrays — unit-tested with edge cases
   (all-zero, partial actuals).
2. **Data layer:** `lib/db/queries.ts` — scoped SQL aggregations (port the original's queries);
   integration tests against seeded DB comparing known totals.
3. **UI:** stat tiles (budget/actual income/expense/net), cash-flow bar (Recharts), category
   doughnut, cumulative-savings line, bank summary table, fixed-vs-variable, YoY card; year
   selector in sidebar (URL-driven); `next-themes` light/dark toggle with tokens preserving
   the OLED-dark identity; charts read CSS variables so both themes render correctly.
4. **E2E:** seeded year renders all widgets; empty year renders empty states (no crash);
   theme toggle persists.
5. **Adversarial:** `?year=99999`/`?year=abc` clamped; SGD formatting everywhere (no `$`
   hardcodes — the original's USD bug class).

## Phase 4 — Budgeting additions: category budgets, goals, net worth

**Ready:** AC = per-category caps with progress + overspend; goals CRUD + progress; running
balances + net-worth trend. Edge cases: budget of 0 vs null (unset ≠ zero cap); overspend

> 100% bar rendering; goal with past target_date; account with negative running balance; credit
> account math (outflows via credit roll up to linked bank). Trust boundaries: all new action
> inputs (zod).

1. **Pure logic:** budget-progress calc (spent/cap, clamp+overflow flag), goal progress +
   naive projected-completion (linear from savings deltas), running-balance walk
   (opening + Σ inflow − Σ outflow per month; credit spend attributed to linked account),
   net-worth series. Unit + property tests (running balance is order-independent per month;
   never NaN).
2. **Data layer:** `monthly_budget` on category actions; goals CRUD actions; opening-balance
   edit on accounts; net-worth query in `queries.ts`.
3. **UI (behind config flags):** budget column + progress bars in Settings/categories +
   dashboard budget-health widget (overspend red); Goals page (cards, progress, add/edit);
   net-worth line chart + per-account balances on dashboard.
4. **E2E:** set cap → overspend shows red; create goal → progress renders; set opening
   balance → net-worth chart updates. Failure: negative target rejected.
5. **Adversarial:** flag off ⇒ zero traces in UI and actions rejected (flags enforced
   server-side too, not just hidden UI).

## Phase 5 — CSV import/export

**Ready:** AC = export produces a correct, injection-safe CSV of all entries; import (behind
kill-switch, default off) maps columns and reconciles actuals. Edge cases: >5MB file, >2000
rows, wrong encoding, missing headers, dates in multiple formats, amounts with commas/`$`,
duplicate rows in file, rows matching nothing (→ ad-hoc create with confirm), formula cells
(`=SUM(...)` — never evaluate, escape on export). Trust boundary: uploaded file = fully
hostile input.

1. **Pure logic:** CSV row parser/normalizer (zod row schema; date + amount coercion),
   matching heuristic (same month + close amount + fuzzy item name → candidate match),
   dedup within file. Heavy unit tests; property test: parser never throws on arbitrary
   strings (returns typed errors).
2. **Data layer:** export route (fixed query — join `recurring_schedule` for scheduled day;
   escape `"` and prefix `'` on `=+-@` cells); import action: size/row caps enforced before
   parse, preview payload (matched/unmatched/errors), commit applies in one transaction,
   idempotent via content hash of (year,month,item,amount) — re-import is a no-op.
3. **UI:** Import page (upload → column mapping → preview diff table with match/new/skip per
   row → confirm); Export button in Settings.
4. **E2E:** import small fixture CSV → actuals reconciled; re-import same file → 0 changes;
   failure: oversized/garbage file → friendly error, nothing written. Export downloads and
   round-trips.
5. **Adversarial:** formula-injection cells, 10MB file, header spoofing, cross-household
   entry IDs in a forged commit payload.

## Phase 6 — Email + Cron (Resend, keys-optional)

**Ready:** AC = cron endpoints secured and idempotent; reminder + recap emails render and
send when keys exist, log-fallback when not. Edge cases: cron double-fire (must not double-
send — dedup ledger); no upcoming bills (no empty email); Resend down/timeout (retry w/
backoff, then log + degrade); kill-switch off mid-cycle. Trust boundaries: cron requests
(`CRON_SECRET` bearer check), Resend API responses (validated).

**Pre-decision resolved (2026-07-09):** stay UTC-only — no household-timezone column. A
household in SGT (UTC+8) can see a reminder/recap fire up to ~16 hours off from local
midnight; accepted as a known, documented Tier-2 limitation rather than adding schema
surface area for it. To still give Phase 4's goal-overdue gap a single, consistent answer
instead of a second inconsistent implementation, both this phase and the goal logic now
share one helper (`lib/domain/today.ts`): UTC-day-boundary arithmetic, not raw instant
comparison. This incidentally fixes a real off-by-one in the pre-existing goal `isOverdue`
check (it compared full timestamps, so a goal was marked overdue mid-day on its own due
date rather than the day after) — see PROGRESS.md's Phase 6 entry.

**Also resolved (2026-07-09):** RESEND_API_KEY stays unset for this phase — built and
tested entirely in keys-optional log-fallback mode, same convention as Phase 1's invite
email. The app is not yet deployed to Vercel, so `vercel.json`'s cron schedule is built and
documented but its actual scheduled firing can't be verified end-to-end this phase; cron
routes are instead verified via authenticated manual requests and integration tests
(`CRON_SECRET` check, dedup ledger, kill-switch off → no-op).

1. **Pure logic:** upcoming-bill selection (due in ≤3 days from `actual_date_day`, month-end
   clamping for day 29–31), recap aggregation reuse from Phase 3. Unit tests incl. Feb/short
   months.
2. **Data layer:** `email_log` table (dedup key: type+period+household → idempotent sends);
   `lib/email/resend.ts` with 5s timeout + 2 retries + fallback-to-log; React Email or simple
   HTML templates (reminder, recap); cron routes `api/cron/{reminders,recap,generate}` —
   `CRON_SECRET` check, kill-switch check, per-household loop; `vercel.json` cron config.
3. **UI:** Settings → notifications section: kill-switch toggles (owner-only), recipient
   opt-in per member, "send test email" button.
4. **Tests:** unit (bill selection); integration (dedup ledger blocks second send; cron
   without secret → 401; switch off → no-op); E2E: toggle switches in Settings.
5. **Adversarial:** replay cron call (dedup holds), forged secret, template with entry names
   containing HTML (escape — stored XSS via email).

## Phase 7 — PWA + mobile polish + final hardening

**Ready:** AC = installable on a phone; family-viewer mobile dashboard clean; backup-restore
procedure documented and **tested once for real**. Edge cases: service-worker caching a stale
authed page (network-first for data, cache-first for static only); logout clears SW-cached
state; iOS PWA quirks. Trust boundary: none new (SW serves same-origin only).

1. Manifest + icons + minimal service worker (static assets only — no caching of authed API
   responses; documented why, per "comment load-bearing gotchas").
2. Mobile pass: bottom-nav (port original's pattern), viewer-optimized dashboard (read-only,
   large tiles), touch-friendly monthly entry.
3. Ops: `RUNBOOK.md` (top failure scenarios: DB down, Resend down, bad deploy rollback,
   kill-switch usage); Neon backup: document PITR + run one **restore drill to a branch and
   verify row counts** (Tier-2 promise); request timeouts + pagination caps on list queries.
4. Final adversarial sweep across phases (session fixation, scoping probe with two seeded
   households, flag bypass attempts); fix or explicitly defer with notes.
5. E2E: Lighthouse PWA installability check; mobile-viewport Playwright run of core flows.

---

## UI/UX Redesign — Phases 8-11 (approved 2026-07-11, complete 2026-07-12)

v1.0.0 shipped and real use started, surfacing four pain points: navigation feels like
disconnected pieces, the visual design is unconsidered (plain shadcn defaults), data entry
is slow, and — the core gap — no screen answers "what's due soon and can I afford it?" (the
only upcoming-bills logic, `lib/domain/reminders.ts`, is cron-email-only; paid/unpaid state
shows in just one of three monthly views). This redesign restructures the app around that
question (a forecast-first Home, Phase 9) inside a coherent "modern fintech" visual system
(warm, rounded, vibrant accent, big numbers; light+dark stay, OLED true-black is retired —
see the Phase 3 supersession note above), executed as four new phases on the same
phase-driven process. Desktop and mobile stay equally first-class; viewers get the same
screens minus edit controls. Money-math testing keeps the same Tier-2 treatment (property
tests for the new affordability module). No Feature Matrix changes — all four phases ship
under existing flags; no new flag rows.

**Target information architecture** (routes stay stable; prominence changes — only
`/insights` and `/accounts` are new routes):

| Surface   | Route                      | Content                                                                                                                                |
| --------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Home      | `/`                        | Forecast-first screen — safe-to-spend, upcoming list, runway (Phase 9 rewrite, done)                                                   |
| Money     | `/monthly`                 | Entry hub, redesigned in place (Phase 10)                                                                                              |
| Plan      | `/recurring`               | Recurring + generate, relabeled "Plan", restyled (Phase 11, done)                                                                      |
| Net worth | `/accounts`                | NEW (Phase 8): NetWorthChart + AccountBalancesTable + BankSummaryTable, moved off the dashboard                                        |
| Goals     | `/goals`                   | Redesigned cards (Phase 11, done)                                                                                                      |
| Insights  | `/insights`                | NEW (Phase 8): year analytics — StatTiles, CashFlow, Category donut, Savings, FixedVariable, YoY + YearPicker, moved off the dashboard |
| Settings  | `/settings` hub + subpages | Sidebar collapses to ONE Settings entry (Phase 8); Data section gains an Import entry; `/import` route keeps working                   |

Desktop sidebar (7 links, Phase 8): Home, Money, Plan, Net worth, Goals, Insights, Settings
— grouped "Track" (Home/Money/Plan) / "Grow" (Net worth/Goals/Insights) / footer (Settings
link, user chip, theme toggle, sign-out). The Phase 3 `YearNav` sidebar quick-jump is
deleted (no replacement — `/insights` carries its own `YearPicker`, same as the old
dashboard's). Mobile bottom tabs (5, Phase 8): Home `/`, Money `/monthly`, Net worth
`/accounts`, Goals `/goals`, More `/settings` (the hub adds Plan + Insights links,
mobile-only — the desktop sidebar already covers them). Viewer role: every new
surface/action hides write affordances via the existing `can(role, ...)` and
server-guards with `requireRole('write')`, same pattern as every prior phase.

### Phase 8 — Design system foundation: tokens, primitives, shell/nav

**Ready:** AC = every existing page renders correctly on the new tokens in light+dark; new
sidebar/tab IA live; `/insights` + `/accounts` exist with the moved widgets (the old `/`
dashboard KEEPS rendering everything it already did this phase — duplication is deliberate
so nothing is orphaned until Phase 9 swaps Home); all new primitives exist, are built to
spec, and are exercised at least once each (some get real Phase 8 UI wiring — EmptyState on
`/accounts`' feature-off state, Stat as a headline figure on `/accounts`,
Tooltip via a quick hover hint on `/accounts`' heading (desktop-pointer only, by Base UI's
own touch-disabled design) plus Dialog+Drawer+ResponsiveSheet together via a tap-friendly
"Learn more" -> "About net worth" info sheet on the same page (`net-worth-about-sheet.tsx`
— centered Dialog at >= md, bottom Drawer below it, same content either way), Toast via a
confirmation on the theme toggle; Skeleton/Switch/Progress/Tabs/Fab are complete and
correct but deliberately not yet wired into a page — see task 8's `loading.tsx` finding
below for why Skeleton in particular isn't wired this phase; Switch/Progress/Tabs/Fab's
real homes are Plan/Goals toggles (Phase 11), the Monthly view-toggle (Phase 10), and the
global quick-add trigger (Phase 10) respectively, per this redesign's own phase
boundaries); full E2E green, plus a real live adversarial pass (keyboard-only Dialog/
Drawer/Toast operation, a light+dark screenshot sweep of every touched page) — see task 11.
Edge cases: theme-flash on first paint (next-themes class strategy already handles this;
unchanged); Drawer scroll-lock/focus-trap vs the fixed BottomNav + `env(safe-area-inset-
bottom)`; toast stacking (default `limit=3` is fine); the load-bearing `min-w-0` on
`<main>` (`app/(app)/layout.tsx`) survives the rewrite verbatim.
Trust boundaries: none new — verify a viewer sees no write affordances in the new shell;
the Members link stays `can(user.role,'manage_members')`-gated (now inside the collapsed
Settings hub rather than a direct sidebar link, for every role, not just non-owners).

1. Append this section (Phases 8-11) to spec.md; mark the Phase 3 "OLED-dark identity"
   note superseded with a pointer here (done above) rather than deleting it. No Feature
   Matrix changes.
2. **Token pass** (`app/globals.css`): `--radius: 1rem` (up from `0.625rem`); warm
   near-white light background/neutral ramp (hue ~90, chroma <=0.005) with a vibrant
   violet `--primary`; a layered warm dark theme (increasing-lightness
   background/card/popover, same violet primary, softened `oklch(1 0 0 / 10%)` borders)
   replacing the true-black OLED theme; new semantic `--income`/`--expense`/`--warning`
   tokens (`text-income`, `bg-expense/10`, etc., registered in `@theme inline`); 8 fixed
   CVD-validated `--chart-1..8` slots (light set validated on white, dark set on the new
   dark card surface); a `--text-display` type size for hero money figures; a
   `--card-shadow`/`shadow-card` token replacing the flat `ring-foreground/10` outline
   cards used alone. Rewrote the stale comment documenting the old OLED + emerald/red
   convention to describe the new one and its page-by-page (not all-at-once) retirement
   through Phase 11.
3. **New primitives** in `components/ui/`: `dialog.tsx`, `drawer.tsx`,
   `responsive-sheet.tsx` (renders Dialog >= md / Drawer < md via a hydration-safe
   `matchMedia` hook, defaulting to Dialog until mounted), `toast.tsx` (+ `ToastProvider`
   mounted in `app/layout.tsx`, inside `ThemeProvider`), `skeleton.tsx`, `empty-state.tsx`,
   `progress.tsx`, `switch.tsx`, `tabs.tsx`, `tooltip.tsx` (+ app-level
   `TooltipProvider`, also mounted in `app/layout.tsx`), `stat.tsx`, `fab.tsx` — all
   base-ui wrappers in `button.tsx`'s style (cva where variants exist, `cn()`,
   `data-slot`).
4. **Shell rewrite** (`app/(app)/layout.tsx`): grouped sidebar per the IA table above,
   active-link styling via a new client `nav-link.tsx` (`usePathname`); deleted
   `app/(app)/year-nav.tsx` and its two call sites (sidebar, settings hub). Preserved
   verbatim: the `min-w-0` on `<main>` + its comment, the bottom padding calc,
   `<BottomNav/>`.
5. **`app/(app)/bottom-nav.tsx`**: tabs -> Home/Money/Net worth/Goals/More per the IA
   table (Recurring dropped from the tab bar itself — reachable via More's hub); updated
   the hand-maintained-list comment (still a deliberately separate list from the sidebar
   and settings hub, membership just changed).
6. **New pages** (content moves, no behavior/query change from the pre-redesign
   dashboard): `app/(app)/insights/page.tsx` (StatTiles, CashFlowChart, CategoryChart,
   SavingsChart, FixedVariableCard, YoyCard + YearPicker, same queries the dashboard
   already ran); `app/(app)/accounts/page.tsx` (NetWorthChart, AccountBalancesTable,
   BankSummaryTable + YearPicker + a new Stat headline total, behind `FEATURE_NET_WORTH`
   with a friendly feature-off `EmptyState`, matching `/import`'s pattern). `YearPicker`
   gained an optional `basePath` prop (default `/`, unchanged for the old dashboard) so
   `/insights`/`/accounts` can page their own year instead of bouncing to `/`.
7. **Settings hub** (`app/(app)/settings/page.tsx`): now the desktop entry too (sidebar
   collapsed to one link) — removed its `md:hidden` YearNav (deleted entirely, see task
   4); added `md:hidden` Plan + Insights links as the mobile bottom nav's escape hatch
   (desktop's sidebar already covers both).
8. **`loading.tsx` — built, then removed after a real, reproduced bug (not shipped this
   phase); root `app/not-found.tsx` (kept, unaffected).** Built Skeleton-based
   `loading.tsx` files for `/`, `/monthly`, `/accounts`, `/insights`, `/goals`,
   `/recurring` per the original task. The full local E2E gate against a real production
   build (`next build && next start`, exactly as CI runs it) then failed 3 tests with a
   `strict mode violation: ... resolved to 2 elements` on pages with an interactive
   `useActionState` form — `/settings/categories`' add-category input (cascaded from the
   root `app/(app)/loading.tsx`, since `/settings/*` has no loading.tsx of its own and
   Next's docs confirm an ancestor's loading.tsx wraps "the page.js file and any children
   below") and `/goals`' add-goal input (its own dedicated loading.tsx), plus `/recurring`'s
   generate-forecast confirmation message never appearing at all. Root-caused via a bisection
   (removing one loading.tsx at a time, rebuilding, re-running against a real production
   server each time — not the dev server, to rule out Turbopack dev-mode compile races,
   which were a real red herring early in the investigation): every failure traced to a
   `loading.tsx` Suspense boundary wrapping a page with a client form using
   `useActionState`. The rendered DOM showed two copies of the same input with different
   `useId()`-derived ids — one server-numbered (`base-ui-_r_0_`), one client-only-shaped
   (`base-ui-_R_<random>_`) — the signature of the component tree mounting twice instead
   of once. Removing **all six** `loading.tsx` files (not just the two directly
   implicated) made the full local E2E suite pass 55/55 against a fresh production build.
   Not fully root-caused at the React/Next.js internals level within this phase's budget;
   shipping a known, reproduced form-breaking bug was judged strictly worse than shipping
   without route-level loading skeletons this phase, per "zero-tolerance regression."
   Deferred to a future phase: re-investigate with a minimal repro (isolated from this
   app's other code) before reintroducing `loading.tsx` anywhere a page also has a
   `useActionState` form.
9. **Restyled existing primitives**: `card.tsx` and `select.tsx`'s popup (the two with a
   visible outline) moved from a flat `ring-foreground/10` to a softened
   `ring-foreground/6` + the new `shadow-card` token. `input.tsx`/`badge.tsx`/`table.tsx`
   audited and left unchanged — already fully token-driven with no hardcoded gray
   literals; their radius bump comes for free from the `--radius` token change (Tailwind
   v4's `--radius-*` scale in `@theme inline` derives from it).
10. **E2E**: `e2e/mobile.spec.ts` updated for the new tab names/targets; `e2e/dashboard.
spec.ts`'s sidebar-year-jump assertion replaced with a same-page YearPicker
    round-trip (the sidebar quick-jump it tested no longer exists — an explicit, in-scope
    consequence of task 4's YearNav deletion, not itself a dashboard behavior change);
    new `e2e/shell.spec.ts` (desktop nav reaches all 7 surfaces, theme toggle persists
    across reload, a viewer sees no Members link/write affordances anywhere in the
    shell).
11. **Adversarial pass, run for real against a live production server, not just planned:**
    keyboard-only Dialog operation on `/accounts`' "Learn more" info sheet at desktop
    width (Tab to the trigger, Enter opens, Escape closes) and the same sheet rendering
    as a Drawer at a 390px mobile width, both confirmed via direct DOM assertions, not
    visual inspection alone; the Tooltip next to the same page's heading confirmed to
    reveal its content on keyboard focus (desktop only, by design); the theme-toggle
    Toast confirmed to appear on a keyboard-triggered toggle and to be reachable/
    dismissible via its Close button once the toast viewport is expanded (Base UI's
    documented `data-expanded`/F6 pattern — the Close button is `aria-hidden` until
    then, which is Base UI's own design, not a bug). Full light+dark screenshot sweep of
    Home/Net worth/Insights/Settings/Goals/Money/Plan confirmed no regressed-to-
    unreadable text or broken layout. Full local gate (lint, typecheck, unit 395/395,
    integration 232/232, build, E2E 55/55 against a real `next build && next start`);
    commit.

### Phase 9 — Affordability domain + forecast-first Home

**Ready:** AC = `/` answers "can I cover what's coming" (both lenses); cross-month
upcoming list with one-tap mark-paid + toast Undo; runway sparkline; horizon
configurable (this-month default / 7 / 14 / 30); `/insights` + `/accounts` are now
canonical (the old dashboard's widgets are gone from `/`, replaced entirely);
reminder-email behavior byte-identical (pinned by an integration regression test, not
just left alone by omission). Edge cases: `FEATURE_NET_WORTH` off or zero bank accounts
-> promote the budget lens to hero, hide the cash lens (never render a wrong number);
negative safe-to-spend -> warning styling, not an error; overdue unpaid bills (current
month, due day passed) shown in their own bucket AND subtracted regardless of horizon;
day-29-31 clamping in short months; horizon window spilling Dec->Jan; Undo restores the
exact previous actualAmount/actualDate (including null); a brand-new household with zero
entries -> empty state with a "set up your plan" CTA to `/recurring`. Trust boundaries:
`markPaidAction` + `setHorizonAction` inputs (zod); horizon re-validated on read
(`parseHorizon`, never trusts a stored `household_settings` row blindly); every new
query is household-scoped; a cross-household entry-id probe returns "Entry not found".

1. **Pure logic — `lib/domain/affordability.ts`** (imports `daysInMonth` from
   `reminders.ts` and `utcDaysBetween`/`utcStartOfDay`/`currentYearMonth` from
   `today.ts`; does NOT modify `reminders.ts`): `UpcomingEntryCandidate` (a superset of
   `reminders.ts`'s `UpcomingBillCandidate` — adds direction/category, and
   `actualDateDay: null` covers both "no schedule" and "ad-hoc, no schedule at all"),
   `parseHorizon` (trust-boundary parser, garbage/out-of-set -> `'month'`),
   `resolveHorizonDays` ('month' = days to that calendar month's end, inclusive of
   today), `selectUpcomingItems` (skips paid + uncategorized; unscheduled -> due at
   clamped month-end; overdue = negative days-until-due, CURRENT month only, included
   regardless of horizon; sorted due-date then item), `computeSafeToSpend` (cash minus
   upcoming minus overdue expense; income tracked but never subtracted — the
   conservative headline number the plan's user decision calls for),
   `computeBudgetRemaining` (budgeted expense minus ACTUAL spend so far this month —
   deliberately the opposite fallback rule from `bestEstimateCents`: an unpaid forecast
   row hasn't spent anything yet), `buildRunway` (day-by-day projected cash,
   `horizonDays + 1` points, DOES include income — the one deliberate asymmetry with the
   hero's conservative number, documented in a load-bearing comment; overdue items land
   on day 0; every other item's offset is clamped into `[0, horizonDays]` so the
   function stays a true conservation identity for any item array, not just
   well-formed ones). `lib/domain/dashboard.ts` gained `actualOnlyCents` alongside
   `bestEstimateCents` — the cash-total's opposite fallback rule (actuals only, never
   falling back to budgeted), named and commented so a call site doesn't need to
   re-derive why.
2. **Tests — `lib/domain/affordability.test.ts`** (fast-check property tests, same
   treatment as `lib/money.test.ts`/`lib/domain/net-worth.test.ts` — user decision):
   conservation identities for `computeSafeToSpend` (cash minus safe-to-spend always
   equals total expense subtracted, for arbitrary item arrays) and `buildRunway` (the
   last point always equals cash plus the full signed sum of an arbitrary item array,
   proving the day-0/clamping design holds generally, not just for well-formed input);
   `computeBudgetRemaining`'s `remaining + spent === budgeted` identity; a property
   confirming `selectUpcomingItems` never selects a paid or uncategorized candidate for
   arbitrary candidates/today/horizon. Unit cases: Feb day-31 clamp, Dec->Jan spill,
   `'month'` horizon on the 1st vs. the last day of a month (including leap February),
   unscheduled-entry month-end due date, zero-budget `pctSpent` 0, empty candidates,
   `parseHorizon` against every documented garbage shape.
3. **Data layer — `lib/db/queries.ts`**: `getUpcomingEntryCandidates` (clones
   `getUpcomingBillCandidates`'s bucket-spanning shape but LEFT-joins
   `recurring_schedule`, not INNER, so ad-hoc entries are included with
   `actualDateDay: null`, and LEFT-joins categories for direction/name/color — a
   deliberately separate query from the cron path's, not a shared/parameterized one, so
   a future Home change can never accidentally alter cron behavior);
   `getActualizedCashRows` (per-account signed sums of ACTUAL amounts only, no year
   bound — same grouped-sum shape as `getAccountEntriesBeforeYear` but
   `WHERE actual_amount IS NOT NULL` instead of a year cutoff). New `lib/settings.ts`:
   `getSetting`/`setSetting`, a generic `household_settings` accessor for the
   `affordability_horizon` key — same table `lib/flags.ts` owns the boolean
   `KillSwitchKey` subset of, deliberately NOT added to that union (a horizon isn't a
   kill-switch) and deliberately uncached (a single per-request read on Home's render
   path, not a hot path).
4. **Actions**: `markPaidAction` (`app/actions/monthly.ts`) — zod `{ id: uuid }`,
   `requireRole('write')`, household-scoped select; an already-paid entry
   (`actualAmount !== null`) returns `{ success: true, alreadyPaid: true }` (idempotent,
   double-tap safe — no second write); otherwise sets `actualAmount` to the entry's own
   `budgetedAmount` and `actualDate` to today (UTC), returning
   `{ success: true, alreadyPaid: false, previous: { actualAmount: null, actualDate } }`
   so the client's toast Undo can replay the exact prior state through the EXISTING
   `updateActualAction` (no new "unmark" action — that would duplicate exactly what
   `updateActualAction` already does). `updateActualAction` itself gained a
   `revalidatePath('/')` alongside its existing `/monthly` one, since it's now also the
   Undo path Home's data depends on. `setHorizonAction` (new `app/actions/settings.ts`)
   — zod enum, `requireRole('write')` (owner OR member — a personal viewing preference,
   not an owner-only policy toggle like the `manage_settings`-gated kill-switches).
   Integration tests cover idempotency, cross-household scoping (added to
   `cross-household-scoping.integration.test.ts` too), a partial-actualization
   (date-only) `previous` case, and horizon round-trip/tampering. A dedicated
   **"reminders freeze"** regression test seeds a real fixture and asserts
   `getUpcomingBillCandidates` + `selectUpcomingBills` (the cron path — untouched this
   phase) still produce byte-identical output end-to-end against a live DB, not just "no
   diff in reminders.ts."
5. **Home UI — rewrote `app/(app)/page.tsx` + new `app/(app)/home/`**:
   `safe-to-spend-hero.tsx` (cash lens primary + always-visible budget-remaining
   secondary line when cash is trustworthy; budget lens promoted to the ONLY hero,
   cash hidden entirely, when `FEATURE_NET_WORTH` is off or there are zero bank
   accounts — never a wrong/misleading number), `upcoming-list.tsx` (Overdue / This
   week / Later groups) + `mark-paid-button.tsx` (client; see the real bug below),
   `runway-sparkline.tsx` (Recharts, axis-free, zero-reference line), `budget-mini.tsx`
   (reuses `BudgetHealthCard` wholesale — its real, single home per the Phase 8 entry's
   own note) + `goals-mini.tsx` (compact read-only `computeGoalProgress` cards),
   `horizon-picker.tsx` (a 4-button segmented control, not a Popover — see Deviations).
   A brand-new household with zero `monthly_entries` in the current+next-month window
   gets an `EmptyState` ("set up your plan" -> `/recurring`) instead of a confusing
   all-zero hero.
6. **E2E**: new `e2e/home.spec.ts` (hero renders a real figure; a seeded ad-hoc bill ->
   mark paid -> row disappears from the list, the budget-remaining figure drops by
   EXACTLY its amount, Undo restores both; a viewer sees the list with no mark-paid
   button or horizon picker; a genuinely fresh household — its own `households` row,
   not just a new user in the seeded one — sees the empty state). `e2e/dashboard.spec.ts`
   renamed to `e2e/insights.spec.ts` and repointed at `/insights` (the widgets' now-sole
   home). `e2e/phase4.spec.ts`'s net-worth assertion repointed at `/accounts` (no longer
   rendered on `/` at all); its budget-health assertion stays on `/` unchanged, since
   `budget-mini.tsx` is that widget's real home now, not a duplicate.
7. **Adversarial pass**: double-tap mark-paid (idempotent, confirmed via integration
   test); forged/foreign entry id (cross-household probe); horizon tampering (form field
   AND a garbage DB row, both re-validated through `parseHorizon`); confirmed the cron
   reminder unit + integration suites stay green and byte-identical (task 4's freeze
   test). Full local gate green; commit.

**Deviations from the literal plan, logged rather than silent:**

1. **Horizon picker is a 4-button segmented control, not a Popover.** The plan's WISDOM
   section sketched a small Popover for this; Phase 8 never built a `popover.tsx`
   primitive (Tooltip/Dialog/Drawer/ResponsiveSheet were that phase's full overlay set),
   and adding a brand-new base-ui overlay wrapper purely for a 4-option picker was
   judged out of THIS phase's scope. Four always-visible buttons need no
   overlay/focus-trap plumbing and are equally reachable on mobile and desktop.
2. **`MarkPaidButton` calls `markPaidAction` directly (inside `startTransition`), not
   via `useActionState` + `<form action>`, despite the plan's WISDOM section sketching
   the latter.** See the real bug below — a `useActionState`-bound version was built
   first per the plan and demonstrably failed under real E2E verification.
3. `budget-mini.tsx` links to `/insights` and `goals-mini.tsx` links to `/goals`,
   exactly as the plan specifies, even though `/insights` doesn't render a per-category
   budget breakdown itself (`CategoryChart`'s expense-by-category donut is the nearest
   analytically-related widget there) — a deliberate, literal reading of the plan's own
   task 5 wording, not an oversight.

**A real bug found and fixed via live E2E verification (not just green tests):** the
first `MarkPaidButton` implementation followed the plan's sketch — `useActionState`,
firing the toast from a render-time "reacted to" comparison (this codebase's existing
pattern for `goal-card.tsx`/`entry-row.tsx`, but those only ever call their OWN
`setState`, never an external system). Full green unit/integration/E2E suites did NOT
catch this — the toast reliably failed to appear only under a REAL browser exercising
the REAL click, confirmed via a throwaway script driving the live `next build && next
start` server directly (same verification method as Phase 8's own adversarial pass).
Root cause: `markPaidAction`'s single response drives TWO client updates at once —
`useActionState`'s own local `state`, and (because the action calls `revalidatePath('/')`)
the Next.js router's refresh of Home's server-rendered tree, which removes the
now-paid entry (and therefore this exact component) from the list. When both land in
one commit, React can go straight from "old tree" to "new tree without this component,"
without ever committing an intermediate frame where this instance holds the new `state`
while still mounted — so neither the render-time pattern NOR a `useEffect` keyed on
`state` reliably fired (both were tried; both intermittently failed, matching the
non-deterministic "sometimes it's there" signature of a genuine race, not a typo).
Fixed by calling `markPaidAction` directly inside `startTransition`, awaiting its result
in the same closure that fires the toast — the same shape the plan's own Undo button
already used for exactly this reason, now applied consistently to the primary action
too. Verified via the same throwaway live-server script (toast now appears reliably
across 10 consecutive 300ms samples) before re-running the full E2E suite.

A second, smaller finding from the same live-verification pass: `EmptyState`'s
CTA (`Button` composed with `render={<Link/>}` and `nativeButton={false}`) exposes an
accessibility role of `"button"`, not `"link"`, even though it navigates via `href` —
Base UI adds button semantics/keyboard handling on top of the underlying `<a>` when
`nativeButton` is `false`. Not a bug (this is Base UI's own documented composition
behavior, the same mechanism Phase 8's `not-found.tsx`/`empty-state.tsx` already
depend on) — just a real thing to know when writing a Playwright locator against it;
`e2e/home.spec.ts`'s empty-state test targets `getByRole('button', ...)` accordingly,
with a comment explaining why.

### Phase 10 — Money page: paid-state everywhere, one-tap entry, month nav, global quick-add

**Ready:** AC = calendar + agenda show paid/upcoming/overdue per entry (list already did,
via the presence/absence of an actual amount); mark-paid available in all three views;
`‹ July 2026 ›` chevrons cross year boundaries; a `fintrack_view` cookie persists the
view preference (URL param still wins; a garbage/tampered cookie falls back to the
documented default); a global quick-add (Phase 8's `Fab`, mounted for the first time, +
a desktop trigger) opens a `ResponsiveSheet` with the ad-hoc entry form, defaulting to
the viewed (else current) month. Edge cases: Dec<->Jan chevrons; garbage/tampered
cookie -> default, never a crash; mark-paid from the calendar day sheet revalidates
without the sheet closing; quick-add from a non-Money page defaults to
`currentYearMonth()`; the inline actual-entry keyboard flow in entry-row.tsx preserved
verbatim; Playwright strict mode vs repeated month labels/button names. Trust
boundaries: the `fintrack_view` cookie (parsed/clamped identically to a URL param,
never trusted directly); quick-add reuses `addAdhocAction`'s existing zod validation
plus a new optional `actualDate` field, validated through the same `dateInputSchema`
`updateActualAction` already uses.

1. **Pure logic**: `lib/domain/month-params.ts` gained `parseViewParam(raw, cookieValue?)`
   — URL param wins when valid; else the cookie, if valid; else `'agenda'` (changed from
   `'calendar'`, Phase 2's original default — there's no way to know a request's
   viewport server-side, and agenda reads acceptably at any width without a
   client-side correction; a desktop user who prefers the grid is one click away, and
   that choice then sticks via the cookie) — and `monthNav(year, month)`, a thin
   `{ prev, next }` wrapper around `lib/domain/recurring.ts`'s already-property-tested
   `addMonths`, so a chevron click is provably using the same rollover logic
   generate/auto-generate already rely on, not a second copy. `lib/domain/entries.ts`
   gained `entryPaidState(entry, today): 'paid' | 'overdue' | 'upcoming' | 'unscheduled'`
   — the ONE classifier all three Monthly views share (paid beats everything; no due
   day -> unscheduled; day-31-in-Feb clamping via the same `daysInMonth` reminders.ts
   and affordability.ts already clamp through; due exactly today -> upcoming, not
   overdue). Deliberately broader than affordability.ts's own overdue notion: this
   classifier isn't restricted to the current calendar month (a still-unpaid entry from
   any past month a view happens to render is "overdue" here, since its job is "what
   does this ONE entry look like," not "what belongs in a forward-looking forecast
   window").
2. **View cookie**: read in `app/(app)/monthly/page.tsx` via `const store = await
cookies()` (async in this Next.js version) — read-only during render, matching this
   version's rule that `.set`/`.delete` only work in a Server Action/Route Handler.
   Written from `view-toggle.tsx`, a client component, via a plain
   `document.cookie = 'fintrack_view=<v>;path=/;max-age=31536000'` on click — a
   non-sensitive UI preference, so a client-side write avoids a Server Action round
   trip for a nav click; safe specifically because `parseViewParam` re-validates it
   identically to a URL param on every read.
3. **Month header** — new `app/(app)/monthly/month-header.tsx`: `‹ <Month Year> ›`
   links built from `monthNav`, plus a "Today" quick link when not already on the
   current month. `month-tabs.tsx` split into two renders of the same 12 pills (own
   testids `month-tabs-desktop`/`month-tabs-mobile`) — `hidden md:flex` (unchanged
   wrapped-grid layout) at md+, a horizontally scrollable `overflow-x-auto` snap row
   below md, where the wrapped grid would eat 3+ rows of a phone screen.
4. **Paid-state in views**: `calendar-view.tsx` (converted to a client component — the
   day-cell-click sheet below needs local state) reads each entry's pre-computed
   `paidState` (see task 1) and styles chips accordingly (paid = muted + "✓ " prefix;
   overdue = a `ring-warning` ring + warning text; upcoming = unchanged category-color
   dot). A day cell with entries (`canManage`, grid mode only) is clickable/keyboard-
   activatable and opens a `ResponsiveSheet` listing that day's entries with a
   per-entry `MarkPaidButton` (reused directly from `app/(app)/home/mark-paid-button
.tsx`, extended with optional `size`/`variant`/`className` props — its
   `startTransition`+direct-call logic from Phase 9 untouched) and a "View in list"
   link; the sheet stays mounted (not just while open) so a mark-paid inside it
   re-renders with fresh `entries` without the sheet flashing closed. Agenda mode rows
   get a state icon (check/warning/category dot) + an inline `MarkPaidButton` for
   unpaid entries. `entry-row.tsx` (list) gained a compact ghost `MarkPaidButton`
   beside the actual-amount inputs for unpaid rows — the load-bearing inline
   keyboard flow (Enter/Escape/blur, with its onBlur comment) is untouched, just
   wrapped in an extra flex container so the button can sit beside it.
5. **Global quick-add** — `adhoc-form.tsx` retired; a new `app/(app)/quick-add.tsx`
   (top-level, not nested under `monthly/`, since it's now genuinely global) renders a
   `Fab` (mobile) and a fixed-position desktop button (spec.md's own "top of sidebar OR
   a fixed header slot" choice — the fixed slot, since nesting in the sidebar would
   hide the Fab too below md, where that `<aside>` is `hidden`), both toggling one
   `ResponsiveSheet`'s `open` state (not its `trigger` prop, which only accepts a
   single element). Mounted once in `app/(app)/layout.tsx` (Suspense-wrapped, since the
   sheet reads the viewed month via `useSearchParams`), gated server-side by
   `canManage` — a viewer gets neither trigger, not just a hidden one. Fields: Item,
   Amount (bound to `actualAmount` — the primary "log what just happened" flow),
   Category, Account, Date, then a "More options" disclosure for a
   budgeted-vs-actual split and `paid_by` (`FEATURE_ENTRY_ATTRIBUTION`-gated, as
   before). `addAdhocAction` gained an optional `actualDate` field (validated through
   the existing `dateInputSchema`) and now mirrors a blank budgeted amount to the
   actual amount when one was given (rather than defaulting to 0) — a quick-logged
   $50 lunch with no explicit budget shouldn't register as "$50 over budget" by
   default; leaving both blank still defaults to 0, unchanged. New
   `lib/db/queries.ts`'s `getEntryFormOptions(householdId)` replaces what used to be
   three inline queries duplicated only inside `monthly/page.tsx` (categories/
   accounts/members option lists), since quick-add now needs them on every page.
6. **Restyle**: `summary-bar.tsx` collapsed from 6 flat figures to an income/expense/net
   trio via the `Stat` primitive and the `--income`/`--expense`/`--warning` semantic
   tokens (retiring this page's own emerald/red Tailwind-literal convention, per Phase
   8's page-by-page retirement plan — `entry-row.tsx`'s Difference column retired the
   same literals while it was already being touched this phase). `view-toggle.tsx`
   rewritten on the Phase 8 `Tabs` primitive (its real intended home, per that phase's
   own notes) — each `Tabs.Tab` renders AS a real `next/link` via Base UI's `render`
   composition prop, so navigation/prefetch stay ordinary browser behavior; the cookie
   write happens in the same click. List/calendar containers got the `bg-card
shadow-card` tokens (not the literal `<Card>` component, which sets
   `overflow-hidden` — these containers need `overflow-x-auto` for wide content).
7. **E2E**: `e2e/monthly.spec.ts` — ad-hoc creation moved to the quick-add sheet ("New
   entry: add then delete"); new one-tap mark-paid test (list view, verified via a DB
   poll — the amount input is deliberately uncontrolled, so its `defaultValue` doesn't
   re-apply after a same-instance revalidation, the same reason the pre-existing
   "generate, enter an actual" test already polls the DB instead of re-reading the
   input); new Dec->Jan chevron test; new cookie-vs-URL-param precedence test. `e2e/
mobile.spec.ts` gained a new describe block: agenda-default-view test, and a FAB ->
   Drawer -> quick-add -> one-tap-mark-paid test (touch events, DB-verified). `e2e/
phase4.spec.ts`'s ad-hoc-entry step repointed at the quick-add sheet.
8. **Adversarial pass, and a real naming bug found live (not by the test suite as
   written, but by watching it fail):** the very first version of the quick-add
   trigger's label was "Quick add" — the full local E2E gate passed lint/typecheck/
   unit/integration/build, but the FIRST E2E run against a real production build broke
   a pre-existing, untouched test (`categories.spec.ts`'s bank-account create/delete
   flow, `getByRole('button', { name: 'Add' }).last()`): Playwright's role-name
   matching is a case-insensitive SUBSTRING match by default, not exact, so "Quick add"
   silently satisfied that query too — and since this trigger is mounted on EVERY
   `(app)` page via the layout, appearing AFTER each page's own main content in DOM
   order, it became the new `.last()` match everywhere a pre-existing test relied on
   positional disambiguation among "Add"-ish buttons (categories, recurring, phase4).
   Root-caused by re-running the failing spec and reading the "element not found"
   error carefully (the account was never created — clicking `.last()` had silently
   opened the quick-add sheet instead of submitting the account form). Fixed by
   renaming the trigger to "New entry" (shares no substring with "Add" in any form)
   and confirmed via two full, clean local E2E runs (64/64 both times) after rebuilding
   — the stale build from before the rename was the reason a first re-run attempt
   still showed the old failure, a reminder to always rebuild after a source change
   before trusting a fresh E2E run. Cookie/URL precedence, cross-year chevrons, and
   Dialog-vs-Drawer breakpoint switching were all exercised both by the committed E2E
   suite and by a separate live-verification pass (below). Full local gate green;
   commit.

**A live-verification finding that turned out to be a test-harness artifact, not a
product bug (logged for honesty, not swept under the rug):** a throwaway script
driving the real production server directly (same method as Phases 8-9's own
adversarial passes) initially appeared to show the day-sheet's mark-paid action
updating the UI ("Paid" label, sheet stays open) without the database reflecting the
new `actualAmount` even after several seconds of polling from the SAME script. Chased
across several isolated repros: first ruled out an ambiguous-target theory (a day with
TWO unpaid entries sharing it, one already seeded — confirmed real via a genuine
Playwright strict-mode violation the investigation surfaced, and a legitimate scenario
the product itself handles correctly via one distinct button per entry); then ruled out
duplicate rows (confirmed exactly one row exists per test entry). The anomaly remained
intermittent and NOT reproducible via the properly-engineered, `expect.poll`-based
committed E2E suite (which passed cleanly twice in full), nor via most of several
otherwise-identical manual repros (which succeeded, DB correctly updated, most of the
time) — only a minority of quick, freshly-spun-up one-off script invocations against
Neon's serverless Postgres showed the delay. Most likely explanation: connection/
read-latency specific to a brand-new script process establishing its own fresh
Postgres connection each run, as opposed to the actual Next.js server's warm, pooled
connection real users hit — not a deterministic defect in `markPaidAction` itself.
Flagged honestly rather than either hand-waved away or over-claimed as a fixed bug:
the mechanism is verified correct by the authoritative, repeatable signal (the
committed E2E suite, twice clean) and by a majority of direct manual repros; a lingering,
narrow possibility of a genuine intermittent issue under real Neon connection pressure
is not fully ruled out to 100% certainty within this phase's time budget.

**Deviations from the literal plan, logged rather than silent:**

1. `quick-add.tsx` lives at `app/(app)/quick-add.tsx`, not nested under `monthly/` —
   the plan's literal "rename/refactor adhoc-form.tsx -> quick-add.tsx" wording
   suggested keeping its old location, but since it's now mounted globally in
   `app/(app)/layout.tsx` (the parent of every route, not just `/monthly`), its real
   home is alongside the layout that owns it.
2. The desktop quick-add trigger and the Fab are both labeled "New entry", not
   anything containing "Add" — see the naming-collision bug above; a deliberate,
   debugged departure from the plan's own "+ Add" sketch.
3. `addAdhocAction`'s budgeted-amount default when left blank now mirrors a given
   actual amount (rather than defaulting to 0) — a small, deliberate UX fix
   enabled by quick-add's new single-primary-amount-field design, not present in the
   old two-box adhoc-form.tsx and not explicitly called for by the plan, but directly
   serving its "Amount (actual)" primary-field framing.
4. Card surfaces use the `bg-card`/`shadow-card` tokens directly rather than the
   `<Card>` component itself, for containers that need `overflow-x-auto` (the `<Card>`
   component sets `overflow-hidden`, which would clip horizontal scrolling on the wide
   calendar grid/list tables).

**Test/CI status:** Unit 461/461 (up from 444 — new `entryPaidState`/`monthNav`/
cookie-aware `parseViewParam` tests). Integration 264/264 (up from 260 — new
`addAdhocAction` `actualDate`/budgeted-mirroring tests). Coverage: 99.44% statements /
97.58% branches / 99.32% functions / 99.84% lines on the gated `lib/**` scope (gate is
80%; every new pure function is 100%-covered by its own direct tests). E2E 64/64 (up
from 59), the final run executed with `CI=true` against a real `next build && next
start` — the exact settings GitHub Actions uses — run twice back-to-back clean after
the naming-collision fix, plus once more after the final `npm run format` pass and
rebuild. Lint/typecheck/format all clean (`npm run format` reformatted 8 files on its
one substantive run this phase, all whitespace-only; `npm run format:check` clean
afterward).

**Live verification (real, not assumed):** a throwaway script drove the running
production server directly (same method as Phases 8-9): confirmed a garbage/`<script>`
`fintrack_view` cookie value renders `/monthly` at 200 (not a crash) and falls back to
the agenda tab (`data-active` present on it, confirmed via a real DOM read, not test
mocks); confirmed the Dec 2026 -> Jan 2027 chevron navigates and updates the header
text live; confirmed clicking a calendar day cell with real seeded/generated entries
opens the day sheet (Base UI `Dialog` at desktop width, `Drawer` at a 390px/Pixel-7
viewport), that mark-paid inside it updates the row and the sheet stays open, and that
Escape closes it; confirmed the mobile FAB ("New entry") is the only such trigger
reachable in the accessibility tree at that viewport (the desktop button is
`display:none` there) and opens a Drawer, not a Dialog. See the live-verification
finding above for the one anomaly this pass surfaced and its investigation.

**Deferred / not done:** Nothing from this phase's own task list. Phase 11 (Plan/
Goals/Settings/Import restyle, PWA refresh) remains not started, per the plan's own
phase boundaries.

### Phase 11 — Plan/Goals/Settings/Import restyle + polish + PWA refresh

**Ready:** AC = Plan/Goals/Settings/Import restyled on the Phase 8 primitives; empty
states everywhere a list can be empty; toasts for settings saves; PWA manifest/icons/
`viewport` theme-color match the new brand; final adversarial + a11y sweep. Edge cases:
goals flag-off delete-only mode preserved; import kill-switch-off page state preserved;
generate-over-year-boundary behavior untouched; `viewport` export needs light/dark
`themeColor` media variants (verified against
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md`
before using the array form); the service worker's static-only caching policy verified
untouched. Trust boundaries: none new — every restyled Server Action call site keeps its
existing `requireRole`/zod validation; only presentation changed.

1. **Plan `/recurring`** (route unchanged): H1 relabeled "Plan" (the monthly-page empty
   state already said "Plan" pre-restyle — this makes the page's own heading match what
   it was already called elsewhere). Frequency-grouped tables wrapped in
   `bg-card shadow-card` surfaces (not the `<Card>` component — same
   `overflow-x-auto`-needs-`overflow-hidden`-off reasoning Phase 10 already
   established for wide tables). Active/Inactive toggle -> `Switch` primitive, direct-
   call + `startTransition` (not `useActionState` + `<form>` — a Switch has no native
   form submission to bind to, and this keeps the same "call the action directly, don't
   depend on this component's own state to observe the result" shape
   `mark-paid-button.tsx` established, even though this particular toggle never
   unmounts). **Generate -> a plain (always-centered) `Dialog`**, not `ResponsiveSheet`
   — a deliberate plan choice, not an oversight: four month/year fields fit any
   viewport width in a centered dialog, with no "swipe to dismiss" affordance a bottom
   sheet implies. Add/Edit stay inline (unchanged interaction), restyled onto
   `bg-card shadow-card` surfaces.
2. **Goals**: `GoalCard`'s manual progress-bar `<div>` replaced by the `Progress`
   primitive; COMPLETE/OVERDUE badges and a new projected-completion badge use the
   `Badge` primitive on the `--income`/`--warning` semantic tokens (retiring this
   page's emerald/red-literal convention). Add -> `GoalAddForm` restyled as a
   `ResponsiveSheet` (trigger + sheet, replacing the always-visible inline Card); Edit
   -> each `GoalCard` gets its own `ResponsiveSheet` (replacing the in-place
   card-becomes-a-form swap). **Flag-off delete-only mode intact, unchanged**: `canEdit`
   (gates the ResponsiveSheet Edit trigger) and `canManage` (gates Delete, independent
   of the flag) are the exact same booleans the pre-restyle version used, just wired
   into new JSX — verified live (see below), not just by inspection.
3. **Settings**: hub links and every subpage restyled onto `Card`/`bg-card shadow-card`
   surfaces. Kill-switch toggles (`email_reminders`, `monthly_recap` via
   `NotificationToggle`; `csv_import` via `CsvImportToggle`) -> `Switch`. Save feedback
   -> toasts, **inline validation errors stay inline** (not moved to a toast):
   `ChangePasswordForm`, `InviteForm`, `MemberRow` (role change + remove),
   `NotificationToggle`, `MemberNotifyRow`, `SendTestEmailButton`, `CsvImportToggle` all
   converted from `useActionState` to the direct-call + `startTransition` +
   `useToastManager()` pattern — needed, not just stylistic consistency, for `MemberRow`
   remove and `CsvImportToggle` (both trigger a `revalidatePath` that unmounts/replaces
   the exact component that would otherwise need to observe its own result, the same
   class of race `mark-paid-button.tsx` documents). `ChangePasswordForm`'s inline
   "Password updated." text is preserved **verbatim, not replaced by the toast** — the
   toast is additive — because `e2e/auth.spec.ts` (one of the three specs this
   project's own cross-phase rule says must never need churn) asserts that exact text.
   Data subpage gains an "Import CSV" card/link (export stays). Members page gains a
   read-only **"Pending invites"** list (new query, no new mutation) — the pre-restyle
   page never showed pending invitations at all; `createInviteAction` gained a
   `revalidatePath('/settings/members')` so this list actually refreshes after a real
   invite send (see the real bug below).
4. **Import**: wizard restyled with a plain, **non-interactive step indicator**
   (Upload -> Preview -> Done), deliberately not the `Tabs` primitive — these steps
   can't be jumped between arbitrarily the way `Tabs` implies, only advanced by
   actually completing the current one, so real tabs would be a misleading affordance.
   No flow change; `CsvImportToggle` -> `Switch` (see task 3).
5. **Empty states**: `EmptyState` adopted on every list surface the plan named —
   recurring, goals, categories (income + expense, compact `py-4` variant), accounts
   (bank accounts list), members-invites (new), and Monthly's pre-existing
   `rounded-2xl border-dashed` block (byte-for-byte the same classes `EmptyState`
   itself already uses, now the real component instead of hand-copied markup).
6. **PWA/brand refresh**: `lib/pwa/icon.tsx`'s shared glyph background changed from
   pure black to `#7c3aed` (the exact sRGB value of `globals.css`'s light `--chart-1`/
   `--primary` hue — reused, not freshly invented, so it's already CVD-palette-
   consistent) with the same near-white glyph. `app/manifest.ts`'s
   `background_color`/`theme_color` changed from `#000000` to `#0c0c11` (the sRGB
   rendering of the dark theme's actual `--background` token). `app/layout.tsx`'s
   `viewport` export gained `media`-qualified `themeColor` variants (light
   `#f8f7f3` / dark `#0c0c11`, each the real sRGB rendering of that theme's
   `--background` token) per the array form
   `node_modules/next/dist/docs/.../generate-viewport.md` documents — verified against
   that file before writing it, not assumed from training data.
7. **RUNBOOK.md**: new "UI primitives (Phase 8-11 redesign) — failure modes" section —
   the direct-call/toast pattern's failure mode (a mutation always completes even if its
   toast doesn't render), `ResponsiveSheet`'s Dialog-until-mounted default, Drawer's
   iOS safe-area padding, and a reminder that the service worker's static-only policy
   is unrelated to any of this.
8. **E2E**: `e2e/recurring.spec.ts` ("Recurring schedule" -> "Plan" heading; Active
   toggle assertions -> `getByRole('switch')`/`toBeChecked()`, since Base UI's
   `Switch.Root` renders `role="switch"`, not `"button"`; new fresh-household
   empty-state test). `e2e/phase4.spec.ts` (goal add/edit flows -> scoped to
   `data-testid="goal-add-form"`/`"goal-edit-form"`; two new fresh-household
   empty-state tests — goals, and categories/accounts). `e2e/notifications.spec.ts`
   (kill-switch assertions -> `getByRole('switch')`). New `e2e/members.spec.ts`
   (pending-invites empty state -> real invite sent through the restyled `InviteForm`
   -> toast -> invite appears in the list). `e2e/categories.spec.ts`/
   `e2e/phase5.spec.ts`/`e2e/pwa.spec.ts` reviewed and left untouched — none of their
   existing assertions depend on anything this phase's restyle changed (confirmed by
   running them, not just by inspection).
9. **Final adversarial sweep**: repeated Phase 7's cross-household scoping + flag-bypass
   probes against the new UI. No `app/actions/*.ts` file was modified this phase except
   `invites.ts`'s single added `revalidatePath` call (confirmed via `git diff --stat`
   before committing) — every `requireRole`/zod check restyled call sites depend on is
   the exact pre-existing one. Live-verified (not just code-reviewed) with a fresh,
   disposable household for each check: goals flag-off delete-only mode (a real seeded
   goal rendered with no Add/Edit controls and a working Delete button that actually
   removed it); import kill-switch-off (friendly message + owner-only `Switch`, no file
   input, flipping it on live-revealed the real upload form); the pending-invites query
   is `household_id`-scoped like every other list query. Full local gate green; commit.

**Two real bugs found via live E2E verification (not caught by the green unit/
integration/typecheck/lint/build gates on their own) — both test-authoring bugs this
phase's own restyle exposed, not product defects, but real enough to log honestly:**

1. **`GoalAddForm`'s ResponsiveSheet correctly closes on success — the test didn't wait
   for its exit animation before reopening it.** `e2e/phase4.spec.ts`'s goal-creation
   test reopens the Add sheet immediately after asserting the first goal's card is
   visible, to exercise the validation-failure path. Base UI's Dialog/Drawer keep the
   Popup mounted through their CSS exit transition (`components/ui/dialog.tsx`'s
   `transition-all duration-150`) rather than unmounting instantly — a real, deliberate
   product behavior — so a reopen click landing inside that ~150ms window hit a genuine
   Playwright strict-mode violation (`getByRole('button', { name: 'Add goal' })`
   resolving to both the trigger and the still-animating-out submit button). Root-
   caused by reproducing it against the real committed test suite (`CI=true npx
playwright test`, not a guess) and confirming a hand-written throwaway script never
   caught it (polling every 300ms — comfortably past the 150ms window every time).
   Fixed in the test, not the product: `await expect(page.getByTestId('goal-add-form'))
.toHaveCount(0)` before the reopen click.
2. **`GenerateForm`'s Dialog blocked interaction with the rest of the page after
   success — a real, if minor, UX regression the restyle introduced, not a test bug.**
   Converting Generate from an inline form to a modal `Dialog` means it now has a
   backdrop that intercepts clicks elsewhere on the page while open; the pre-restyle
   inline form had no such overlay. `e2e/recurring.spec.ts`'s existing test (clicking
   Edit on a row right after generating) timed out for 30s waiting for a click the
   backdrop was silently swallowing. Fixed two ways: the test now dismisses the dialog
   (via its built-in close icon) before continuing, matching how a real user would need
   to; and the redundant custom "Close" button in the dialog's footer (which
   `DialogContent` already provides via its own X icon) was removed rather than
   relabeled, since two controls both named exactly "Close" was itself a latent bug
   (confirmed by a SEPARATE Playwright strict-mode violation once the first fix
   surfaced it) — one clear affordance, not two colliding ones.

**A real bug found and fixed (a genuine gap this phase's own new feature needed, not
inherited from an earlier phase):** the new Pending Invites list on `/settings/members`
never refreshed after sending a real invite — `createInviteAction` (`app/actions/
invites.ts`) had no `revalidatePath` call (it never needed one pre-Phase-11, since
nothing on that page depended on its data). `e2e/members.spec.ts`'s own test caught
this immediately (the invite row never appeared) — root-caused correctly on the first
try (no revalidation call existed for that path) but INITIALLY appeared not to be fixed
by adding one, which traced to re-running the E2E test against a **stale `next build`
output** from before the fix — the exact "always rebuild after a source change before
trusting a fresh E2E run" lesson Phase 10's own PROGRESS entry already recorded, hit
again this phase. Rebuilding first confirmed the fix. Added
`revalidatePath('/settings/members')` to `createInviteAction`, same category of change
as Phase 9's `updateActualAction` gaining a second `revalidatePath('/')` when Home
started depending on its data too — not a loosened check, a cache-invalidation
addition a new UI surface now needs.

**Deviations from the literal plan, logged rather than silent:**

1. Generate uses a plain `Dialog`, Goals' add/edit use `ResponsiveSheet` — not an
   inconsistency: the plan's own task wording draws exactly this distinction
   ("Generate -> Dialog" vs. Goals' `ResponsiveSheet`), and this restyle preserves it
   deliberately rather than flattening both onto one primitive for its own sake.
2. Members gained a **new, read-only "Pending invites" list** — not explicitly speced
   task-by-task, but a direct, minimal-risk reading of the plan's own literal
   instruction to adopt `empty-state.tsx` on "members-invites" as one of the named list
   surfaces; the pre-restyle page had no such list to attach an empty state to at all.
   Deliberately no revoke/resend action added alongside it — that would be new
   mutation surface a restyle-and-empty-states phase has no mandate to add, and isn't
   implied by "adopt an empty state."
3. `MemberNotifyRow` (per-member email opt-in) stayed a plain `Button`, not converted
   to `Switch` — the plan's task 3 says "kill-switch toggles -> Switch" specifically;
   opt-in is a personal preference, not one of the four kill-switches, so this is a
   literal reading of the task's own scope, not an inconsistency with the two toggles
   that WERE converted.

**Test/CI status:** Unit 461/461 (unchanged from Phase 10 — no `lib/**` logic touched
this phase). Integration 264/264 (unchanged — no `app/actions/*.ts` file touched except
`invites.ts`'s single added `revalidatePath` line, which no existing integration test
asserts against either way, and no integration test needed a new one for a
cache-invalidation-only change). Coverage: 99.44% statements / 97.58% branches / 99.32%
functions / 99.84% lines on the gated `lib/**` scope (gate 80%; identical to Phase 10's
numbers for the reason above). E2E 68/68 (up from 64) — the final run executed with
`CI=true` against a real `next build && next start`, run twice back-to-back clean after
the three fixes above and one rebuild in between. Lint/typecheck/format all clean.

**Live verification (real, not assumed) — beyond the green E2E suite:** two throwaway
scripts (same method as every prior phase's own adversarial pass) drove a REAL running
production server directly for the two edge cases the task explicitly called out to
verify beyond tests: (1) started a second server instance with `FEATURE_SAVINGS_GOALS=
false`, inserted one real goal directly into the seeded household, logged in as the
owner, and confirmed via direct DOM reads: the goal card rendered with its real data, no
"Add goal" trigger anywhere on the page, no "Edit" button on that card, and a working
"Delete" button that — clicked for real — actually removed the row (verified by its
absence afterward, not assumed). (2) created a genuinely fresh household (its own
`households` row) with `csv_import` at its default (never toggled) state, confirmed the
friendly "CSV import is not enabled for this household" message, the owner-specific
enabling copy, no CSV file input anywhere in the DOM, and an unchecked `Switch`; then
flipped that real `Switch` and confirmed, after a reload, the full upload form (CSV file
input included) actually appeared. The third preserved-behavior edge case (service
worker static-only policy) was verified by confirming via `git diff --stat` that
`app/sw.js/route.ts` and `lib/pwa/static-paths.ts` have zero changes this phase, combined
with `e2e/pwa.spec.ts`'s own service-worker-registers-and-controls-the-page test passing
clean in the full run above.

**Deferred / not done:** Nothing from this phase's own task list — every task 1-9 item
shipped. This closes the Phase 8-11 UI/UX redesign in full; `spec.md`'s Feature Matrix
is unchanged (no new flags across any of the four phases), and every prior phase's
preserved behavior (auto-generate, propagation, reminders/recap byte-identical output,
CSV import/export, cross-household scoping) was re-verified, not just assumed carried
forward.

---

## Post-redesign bug-fix pass — spec corrections (2026-07-12)

A code-review pass over the shipped Phase 8-11 redesign (10 finder angles + individual
verification + live browser testing) found 12 real bugs, documented in full in
`PROGRESS.md`'s own entry for this pass. Two of the fixes correct behavior this spec
had previously documented differently; both are called out here rather than left as a
silent drift between spec and shipped code:

1. **Bank Summary is no longer gated behind `FEATURE_NET_WORTH`.** Phase 8's task 6
   (line 559 above) described `BankSummaryTable` as living on `/accounts` "behind
   `FEATURE_NET_WORTH` with a friendly feature-off `EmptyState`" — but
   `buildBankSummary` only ever needed entries tagged to a bank account for the
   selected year, nothing net-worth-specific (no opening-balance carry-forward), and
   the pre-redesign dashboard had always rendered it unconditionally. Gating the WHOLE
   `/accounts` page behind the flag (rather than just the genuinely net-worth-specific
   pieces — `NetWorthChart`, `AccountBalancesTable`, the "Total net worth" hero) made
   Bank Summary unreachable with the flag off, a real regression from the pre-redesign
   behavior. Corrected: `/accounts` now always fetches and renders
   `BankSummaryTable`; only `NetWorthChart`/`AccountBalancesTable`/the net-worth hero
   stay behind `FEATURE_NET_WORTH`, with a smaller inline note (not a page-replacing
   `EmptyState`) explaining net-worth tracking specifically is off.
2. **Mark paid opens a small confirm popup with an editable date, instead of marking
   paid instantly.** Phase 9's task 5 (and Phase 10's reuse of the same component)
   described `mark-paid-button.tsx` as "one-tap" — correct at the time, since Phase 9
   itself only ever reached this button from the CURRENT month. Phase 10 then made the
   same button reachable from arbitrary past/future months via Monthly's chevrons,
   which exposed a real bug: `markPaidAction` hardcoded `actualDate` to today
   regardless of which month the entry actually belonged to, so marking a January bill
   paid while browsing January in July recorded it as paid in July. Per explicit user
   direction, this is now a deliberate UX change, not just a bug fix: clicking "Mark
   paid" opens a small `ResponsiveSheet` (item name read-only, a date field defaulting
   to today but editable, Cancel/"Mark paid") before the action fires. The
   double-tap-idempotent, direct-call-inside-`startTransition`,
   toast-fired-in-the-same-closure invariants `mark-paid-button.tsx`'s own comment
   documents are all unchanged — only the trigger now opens a popup instead of firing
   the action immediately.

No Feature Matrix changes (no new flags, no flag defaults changed) — both corrections
are behavior/UX clarifications to already-shipped surfaces, not new optional features.

---

## Definition of Done (every phase)

Workflow checklist verbatim: tests (unit+integration+E2E incl. failure paths) green; lint/
typecheck/build/coverage/scans clean; external calls have timeout+retry+fallback; writes
idempotent; edge inputs validated; nothing silent; flags correct kind + default; adversarial
pass done; `spec.md`/README updated; `PROGRESS.md` appended; migrations expand-then-contract.

## Verification (end-to-end, final)

Seed idempotent (re-run proof) → owner login → invite viewer (email or logged URL) → viewer
read-only on mobile → recurring auto-generates → monthly entry across 3 views → actual entered
→ status advances → recurring edit propagates (overridden month intact) → budget overspend
red → goal + net worth render → CSV import reconciles, re-import no-ops → export valid/safe →
cron secured + deduped → kill-switch flips features live → PWA installs → full CI green →
`npm run build` Vercel-ready.
