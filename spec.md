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
| `entry_attribution` | `paid_by` tagging + per-person view                   | config (env)         | on      |
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

**Required pre-decision, before step 1:** "due in ≤3 days" needs an explicit answer to "what
does 'today' mean for this household" — the app has been UTC-only-by-convention everywhere
else (every stored date is a bare `numeric`/integer month, never a timestamp compared against
"now"), and Phase 4's goal `isOverdue`/`projectedCompletionDate` already hit this exact
question and was deliberately left unresolved rather than patched narrowly (see PROGRESS.md's
Phase 4 hardening pass and the cross-phase cleanup pass) specifically so it could be decided
once, here, instead of twice inconsistently. Decide: (a) stay UTC-only — simplest, but a
household in SGT (UTC+8) can see a reminder fire up to ~16 hours off from local midnight, or
(b) add a real household-timezone concept (a column + a shared "what is today for this
household" helper) — more correct, more surface area for a Tier-2 app. Whichever is chosen,
retrofit Phase 4's goal-overdue logic to use the same helper rather than leaving it as a
second, inconsistent implementation.

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
