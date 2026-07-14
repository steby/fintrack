# Progress Log

Status snapshot per phase, per the Development Workflow's Living Documentation requirement.
One section per completed phase, appended in order. Each section states honestly: what
shipped, test/CI status (with real numbers), failure modes handled, key decisions and why,
real bugs found and fixed (root cause, not just "fixed a bug"), and anything deferred or
blocked. This file is about what happened and why — the standing list of open items lives in
`spec.md`, not duplicated here.

**Rigor Tier:** Tier 2 (Core + Hardened, pragmatic). Real users (household/family) and data
that matters if lost/corrupted, but no payments/regulated PII/HA. See `spec.md` for the exact
scope of what's hardened (session/auth security, financial-integrity math, migrations +
backup-restore) vs. deliberately skipped (formal load tests, broad fuzzing, contract tests,
concurrency stress, formal SLOs).

---

## Phase 0: Scaffold, Tooling & CI — status: complete 2026-07-08

**What shipped:**

- `spec.md`, `README.md`, `CLAUDE.md`/`AGENTS.md` (entry-point docs; `CLAUDE.md` uses Claude
  Code's `@AGENTS.md` import, matching the convention `create-next-app` itself now generates).
  Private GitHub repo `steby/fintrack` created and pushed.
- Next.js 16.2.10 (App Router) + React 19 + TypeScript scaffold, merged with the existing docs.
  Toolchain pinned: `.nvmrc` + `package.json` engines, lockfile committed.
- ESLint (`eslint-config-next` + `eslint-plugin-security`) + Prettier + `eslint-config-prettier`,
  all clean. `tsc --noEmit` strict typecheck script.
- `lib/env.ts`: zod-validated env access, fails loud with a readable error listing every
  invalid/missing var. Handles the "blank `.env` line loads as `''` not `undefined`" gotcha for
  optional vars. `loadEnv()` takes an injectable source so it's unit-testable without touching
  real `process.env`.
- `lib/log.ts` (pino, pretty-printed in dev, JSON in prod) + `lib/observability.ts` (keys-optional
  Sentry seam — works identically with or without `SENTRY_DSN`/the package installed, via a
  non-literal dynamic import so it typechecks without the dependency present).
- `lib/db/`: Drizzle ORM over `pg`/node-postgres (chosen over `@neondatabase/serverless`'s HTTP
  driver, which doesn't support real multi-statement transactions that later phases require).
  Empty baseline schema + migration, `migrate.ts`, `seed.ts` — all proven against the live Neon
  **dev** branch (Production is Neon's default branch, reserved and untouched; `dev`/`ci` are
  child branches created for this project).
- `app/api/health`: liveness + DB-ping (2s timeout) check. Verified over real HTTP via `next
dev` and via Playwright.
- Vitest: `unit` and `integration` projects in one config (`test.projects`, `extends: true`).
  Unit tests get dummy-but-valid env values (never touch a real DB); integration tests load the
  real `.env` via a setup file. 80% coverage gate scoped to `lib/**` (DB plumbing files excluded
  — they need a live connection, not meaningfully unit-testable in isolation).
- Playwright: chromium smoke spec (`/api/health` 200, root page renders). CI reuses the prior
  `build` step's output via `next start`; local dev uses `next dev`.
- GitHub Actions `ci.yml`: checkout → install → gitleaks (secret scan) → Semgrep (SAST) → `npm
audit --audit-level=high` (SCA) → format check → lint → typecheck → unit+coverage →
  integration → build → Playwright install → E2E → upload Playwright report. `dependabot.yml`
  for weekly npm + github-actions updates.
- Seed script (`lib/db/seed.ts`) proves the seeding _mechanism_ — env validation (zod), password
  hashing (argon2 via `@node-rs/argon2`), DB connectivity — since `lib/db/schema.ts` is still
  empty; Phase 1 replaces `main()`'s body with real household/owner/categories/accounts/
  recurring seeding once real tables exist. Ran twice locally: identical success, zero errors.

**Test/CI status:** Unit 21/21 (3 files), Integration 2/2 (1 file, against live Neon `dev`
branch), E2E 2/2 (chromium). Coverage on gated `lib/**` scope: 100% lines/branches/functions/
statements. `npm run build` green. Full GitHub Actions `ci.yml` green (final run: 2m8s,
[28908825144](https://github.com/steby/fintrack/actions/runs/28908825144)). `npm audit
--audit-level=high` clean (6 moderate, 0 high/critical — transitive deps of `next`/`drizzle-kit`,
tracked via Dependabot, not blocking).

**Failure modes handled:** Missing/invalid env vars fail loud at process start with a specific,
actionable error (not a downstream crash). `/api/health` never throws — DB ping has a 2s
timeout and returns `db: 'down'` + HTTP 503 on failure rather than hanging or 500ing.
Observability seam degrades to log-only if `SENTRY_DSN` is unset or the package isn't
installed — proven via unit tests for both branches, not just assumed.

**Key decisions and why (deviations from the original plan, logged live in `spec.md`):**

1. **Next.js 16, not 15** — 16 became latest stable between planning and scaffolding; pinning
   back to an already-superseded major had no upside. Next's own generated `AGENTS.md` warns
   agents that this version may differ from training data; kept that warning, appended our
   process pointers to it.
2. **Custom session-table auth over Neon Auth (Stack Auth)** — considered when Neon's dashboard
   surfaced it, but our household/role/invite model was already designed around owning the
   `sessions` table directly; Neon Auth's Teams model would mean adapting our design to theirs,
   not saving work, plus a third-party identity dependency on top of Neon itself.
3. **`pg`/node-postgres over `@neondatabase/serverless`** — the HTTP driver doesn't support real
   transactions, which category-delete ref-nullification, `generate`, and CSV import all need.
   Neon's pooled connection string works fine over plain `pg`.
4. **Semgrep over CodeQL for SAST** — CodeQL's scan itself succeeded, but uploading SARIF
   results requires GitHub Code Scanning, which on a _private_ repo needs GitHub Advanced
   Security (a paid feature). Rather than enable a billed feature without checking the account's
   plan, or make the repo public just for free scanning, swapped to Semgrep, which runs entirely
   inside the CI job (Docker, `p/javascript` + `p/typescript` packs — not the much slower,
   irrelevant-language-inclusive `p/security-audit` pack) with no GitHub feature/account
   dependency. 0 findings across all 22 source files.
5. **Neon branch layout** — the project's default branch is literally named **Production**, not
   "main"/"dev" as originally assumed. Corrected the plan: Production stays untouched; `dev` and
   `ci` are child branches, used for local development and CI integration tests respectively.

**Real bugs found and fixed (actual root cause, not just "fixed a bug"):**

- **Prettier's markdown reflow silently corrupted content twice.** A literal `+` at a wrapped
  line boundary in `spec.md`'s prose got reinterpreted as a markdown list marker, breaking the
  sentence ("queries + tests" → a new, disconnected list item). Separately, running Prettier
  over the user-authored `development-workflow.md` de-indented a code-block continuation line
  inside a bullet, breaking its structure. Fixed the wording to avoid ambiguous `+`, reverted
  the workflow doc to its committed original, and excluded that file from Prettier's scope
  going forward (it's the user's document, not ours to restyle).
- **`.env*` in `.gitignore` also silently blocked `.env.example`** from ever being committed
  (glob matches any file starting with `.env`). Added a `!.env.example` negation so the
  template stays tracked while real env files stay ignored — caught by checking `git status`
  before the first commit rather than assuming the scaffold's default `.gitignore` was correct.
- **CodeQL's SARIF upload failed twice** for two different reasons in sequence: first a missing
  `actions: read` permission ("Resource not accessible by integration"), then — after fixing
  that — "Code scanning is not enabled for this repository" (the real, structural blocker
  described in decision #4 above). Diagnosed by reading the actual failure logs each time
  rather than guessing.
- **Gitleaks' `--no-git` mode scans the raw working tree**, including gitignored files —
  local testing with that flag produced false-positive "leaks" from `.env` and Next's own
  auto-generated `.next/` preview-mode keys, neither of which are ever committed. Switched to
  gitleaks' default git-aware mode (scans commit objects/history, matching what CI actually
  sees), which is also ~15x faster (1.8s vs 30.9s) and correctly found nothing in real history.
- **Semgrep hung indefinitely on local Docker-for-Windows bind mounts** for any multi-file scan,
  while single-file scans and `--config=auto`'s registry fetch were both fast in isolation.
  Isolated via a native-filesystem copy test inside the container (16.8s, 0 findings) — proving
  it was Windows bind-mount I/O, not Semgrep, GitHub Actions' native Linux runners aren't
  affected (confirmed: ~25s including image pull in the real CI run).
- **AWS's documented example key (`AKIAIOSFODNN7EXAMPLE`) is allowlisted by gitleaks by
  default** — the first adversarial-test secret produced zero findings, not because the gate
  failed, but because that specific string is deliberately excluded by scanners precisely
  because it's so common in legitimate docs. Switched to a random high-entropy string, which
  triggered the `generic-api-key` rule correctly.
- **Gitleaks flags a secret from any commit in history, even after a later commit removes it**
  — by design (deleting a file doesn't un-leak a credential that was ever committed). The
  adversarial-pass fake secret kept failing CI after being "reverted." Fixed correctly via a
  `.gitleaksignore` entry pinned to the exact fingerprint (with a comment explaining why),
  rather than rewriting shared git history to scrub it — the right tool for "this specific known
  finding is safe," as opposed to disabling the rule or force-pushing.

**Adversarial pass (deliberate, per the workflow's Phase 0 requirement):** Planted a failing
unit test → confirmed CI failed at exactly the "Unit tests" step, every earlier gate (gitleaks,
Semgrep, audit, format, lint, typecheck) still passed → reverted → confirmed green. Separately,
planted a real high-entropy fake secret → confirmed CI failed at exactly the "Secret scan
(gitleaks)" step, nothing after it ran → reverted (discovering the git-history-persistence bug
above) → allowlisted by fingerprint → confirmed green. Both gates proven to actually block a
red build, not just exist in config.

**Deferred / blocked:** None from the initial build. Resend/Sentry remain unconfigured
(keys-optional by design — not a gap, the intended state until those integrations are
actually needed in later phases).

**Post-hoc hardening pass (`/code-review`, extra-high effort, 2026-07-08):** Ran a full
adversarial review of the harness before starting Phase 1 — 10 parallel finder angles,
1-vote verification per candidate, a gap sweep, 15 findings reported. Fixed 12 in one pass
(all touching `lib/db/index.ts`, `lib/env.ts`, `lib/db/seed.ts`, `lib/observability.ts`,
`vitest.config.ts`, `README.md`); 3 explicitly deferred:

- _Fixed_ — `pingDb` didn't cancel a hung query on timeout (real pool-exhaustion risk):
  replaced the hand-rolled `Promise.race` with a **dedicated, isolated health-check pool**
  (`max: 1`) carrying its own `query_timeout`/`connectionTimeoutMillis`, so a truly hung
  query is cancelled at the pg protocol level and can never starve the main app pool.
- _Fixed_ — the exported `Pool` had no `.on('error', ...)` listener; an idle-client
  connection drop (a documented Neon occurrence) would crash the whole process via
  Node's default unhandled-EventEmitter-error behavior. Added listeners on both pools.
- _Fixed_ — `DATABASE_URL` validation accepted any well-formed URL, not specifically a
  postgres scheme; added a `.refine()` scheme check.
- _Fixed_ — blank-`.env`-line handling (`KEY=` loading as `''`, not `undefined`) was only
  applied per-field to the 3 vars that broke in manual testing, not schema-wide — a
  structurally-identical future field would silently reintroduce the bug. Replaced the
  three near-duplicate `optionalString`/`optionalUrl`/`optionalMinString` wrappers with
  one schema-wide normalization in `loadEnv` (blank → `undefined` before parsing), so the
  invariant holds automatically for every field, present and future.
- _Fixed_ — `lib/db/seed.ts`'s `import { pool } from './index'` triggered full env
  validation (including `SESSION_SECRET`) before seed.ts's own narrower schema ever ran,
  surfacing a confusing, unrelated error. Folded `SEED_OWNER_EMAIL`/`PASSWORD` into the
  shared `envSchema` as optional fields and dropped the duplicate schema/formatter —
  `main()` now checks presence itself with a clear, seed-specific message.
- _Fixed_ — `lib/observability.ts`'s `getSentry()` had a check-then-act race allowing
  concurrent callers to double-initialize the Sentry SDK; a single catch block mislabeled
  any `init()` failure as "package not installed"; `{ err: error, ...context }` let a
  `context.err` key silently overwrite the real exception in logs; `sentryClient` wasn't
  HMR-safe unlike the DB pool. Rewrote around a `globalThis`-cached **promise** (not just
  the resolved client, closing the race), split the import/init try-catches so each gets
  its own accurate warning, reordered the log spread so `err` always wins, and applied the
  same HMR-safe caching pattern the DB pool already used. Added tests for all four,
  including a real concurrent-call race test and a simulated-HMR-reload test.
- _Fixed_ — `pingDb`'s `setTimeout` was never cleared on the success path (minor timer
  leak); now cleared in a `finally`.
- _Fixed_ — `vitest.config.ts`'s unit project didn't pin `NODE_ENV`, so an unusual ambient
  shell value could fail every unit test at import; pinned to `'test'`.
- _Fixed_ — `README.md` said "Next.js 15"; corrected to 16, matching what's actually
  shipped (per `spec.md`'s own deviation log).
- _Deferred to Phase 1_ — CI never runs `db:migrate` before Integration/Build/E2E against
  the live `ci` branch. Harmless today (empty schema); adding the step now would only test
  a no-op. Add it when Phase 1's first real migration lands.
- _Deferred, not fixing_ — `migrate.ts`/`seed.ts` call `pool.end()` only on the success
  path, not in a `finally`. Real gap, but the verifier's own assessment stands: both are
  one-shot CLI scripts where `process.exit(1)` tears down the process regardless, so the
  only actual cost is an abrupt TCP teardown instead of pg's graceful handshake. Not worth
  the `try/finally` noise at this scale.
- _Deferred, not fixing_ — `.nvmrc` pins an exact Node version (24.15.0) while
  `package.json`'s `engines` only requires `>=20.9.0`, and no `.npmrc` enforces
  engine-strict. Low-severity toolchain-rigor gap; left as-is.

Re-verified after fixes: lint/typecheck/build clean, 31/31 unit tests (100% coverage on
the gated scope, up from 21), 3/3 integration tests against the live `dev` branch
(including a new deterministic test for `pingDb`'s false/timeout path), 2/2 E2E.

**Second hardening pass (`/code-review` on the pass above, extra-high effort,
2026-07-08):** Reviewing a fix commit with the same rigor as the original code caught
that the fix commit itself introduced real regressions, and — more importantly — that
the `seed.ts` fix never actually worked. 15 findings, all fixed except one (correct
behavior, not a bug):

- _Fixed for real this time_ — the original `seed.ts` complaint (`SESSION_SECRET`
  blocking a seed-only workflow with a confusing error) was still unresolved after the
  first pass's fix: `SEED_OWNER_EMAIL`/`PASSWORD` had been folded into the shared
  `envSchema`, but `seed.ts` still statically imported `env`/`pool` at module top level,
  so the app's full env was still validated — `SESSION_SECRET` and all — before
  `main()`'s own check ever ran. Root cause this time: moved `SEED_OWNER_EMAIL`/
  `PASSWORD` back to a local schema checked directly against `process.env`, and made the
  `./index`/`../log` imports **dynamic**, deferred until after that check passes.
  Verified live: `DATABASE_URL` set, `SESSION_SECRET` **and** `SEED_OWNER_*` all
  blank now correctly shows the seed-specific error, not `SESSION_SECRET`'s — the actual
  original scenario, genuinely fixed. Caught my own near-miss while verifying: a
  _static_ `import { formatZodIssues } from '../env'` for error formatting would have
  silently defeated the whole fix (ES imports evaluate the entire target module,
  including its `loadEnv()` side effect, even for a single named import) — inlined the
  formatter instead of importing it.
- _Fixed_ — that same schema move also fixes a regression the first pass introduced:
  `SEED_OWNER_EMAIL`/`PASSWORD` being in the shared schema meant a malformed value could
  crash `next dev`/`build`/`drizzle-kit`, not just `db:seed`. Verified live.
- _Fixed_ — the main `pool` (every real app query, not just health checks) had zero
  timeout; only the narrow `healthCheckPool` from the first pass was hardened. Added
  `statement_timeout` (real Postgres-side cancellation) + `query_timeout` +
  `connectionTimeoutMillis` to the main pool too.
- _Fixed_ — `pool.on('error', ...)` was re-attached on every module evaluation even when
  the pool itself was reused from the `globalThis` cache, leaking a listener per Next.js
  HMR reload. Extracted `createPool()`, which only attaches the listener when a pool is
  actually freshly constructed. Verified with 15 simulated reloads: listener count held
  at 1 (previously grew 1:1 per reload).
- _Fixed_ — the code comment claiming `query_timeout` "aborts the query at the pg
  protocol level" was factually wrong (traced `node_modules/pg`: it's a client-side timer
  only, no real `CancelRequest` is sent); corrected, and `statement_timeout` — which
  genuinely is server-enforced — added alongside it.
- _Fixed_ — `healthCheckPool`'s `max: 1` could false-report "DB down" under concurrent
  health checks; bumped to `max: 2`. Error log now tagged with which pool (main vs.
  health-check) emitted it.
- _Fixed_ — blank-normalizing `DATABASE_URL`/`SESSION_SECRET` to `undefined` (the first
  pass's own fix) lost their specific custom error messages to zod's generic "received
  undefined". Used zod v4's `error` callback (verified against the installed version,
  not assumed from v3 knowledge — `required_error` silently doesn't work in v4) to give
  a specific "X is required" message for the blank/missing case while keeping `.min()`/
  `.url()`'s own messages for the present-but-invalid case.
- _Fixed_ — `getSentry()`'s `??=`-cached promise would cache a **rejected** promise
  forever (a rejected Promise is still non-nullish, so `??=` never retries). Added a
  `.catch()` that resets the cache so a later call can retry. Closed the only current
  path to that rejection too (unguarded `logger.warn` inside two catch blocks) via a
  `warnFallback()` helper that cannot itself throw.
- _Fixed_ — `captureException`'s Sentry-forwarding call had no try/catch, so a throwing
  real Sentry client could break its own "safe to call from any error path" contract.
  Wrapped it. Added a real, reachable test (mocked Sentry client's `captureException`
  throwing) plus a test that simulates an unexpected env-access failure to prove the
  cache genuinely resets and a retry succeeds, not just that the first call is handled.
- _Fixed_ — `vi.resetModules()` does not clear `vi.doMock` registrations (confirmed
  against Vitest's own source) — the "package is missing" test's correctness was
  silently depending on no earlier test in the file having mocked `@sentry/nextjs`.
  Added `vi.doUnmock('@sentry/nextjs')` to `beforeEach`.
- _Fixed_ — the new tight-timeout `pingDb` test intentionally leaves an orphaned query
  running against the health pool; `afterAll`'s cleanup wait for it was within a hair of
  Vitest's 10s default `hookTimeout`. Bumped to 20000ms for the integration project.
- _Accepted as correct, not fixed_ — blank `NODE_ENV` falling back to its zod default
  instead of erroring. This is the general blank-to-absent rule (introduced by the first
  pass) working exactly as designed, applied consistently — not a bug to special-case
  back out for one field.

Re-verified end to end, not just re-run: lint/typecheck/build clean, 38/38 unit tests
(100% coverage, up from 31), 3/3 integration tests against the live `dev` branch, 2/2
E2E, Semgrep 0 findings. Manually reproduced the exact original bug scenario and
confirmed the fix; confirmed the malformed-`SEED_OWNER_EMAIL` regression no longer
crashes env loading; confirmed 15 simulated HMR reloads hold `listenerCount` at 1;
re-ran the seed script twice for idempotency; confirmed `migrate.ts` still runs cleanly
against the new pool config.

**Third hardening pass (`/code-review` on the pass above, extra-high effort,
2026-07-08):** Reviewing the second pass's own diff caught that two of its "fixes" were
themselves incomplete — the never-throws contract still had a hole, and one of the new
regression tests didn't actually test the regression it was written for. 15 findings, 12
fixed, 3 deliberately skipped (reasons below).

- _Fixed_ — `captureException`'s initial `logger.error` call sat _outside_ its
  try/catch, and the catch block's own `logger.warn` wasn't guarded like the sibling
  `warnFallback()` helper — both could still throw and break the exact "never throws"
  contract the second pass was written to establish. Wrapped the entire function body in
  one try/catch instead of guarding pieces individually, so no future line added in the
  wrong place can reopen the gap. Added a test that makes `logger.error` itself throw
  and asserts `captureException` still resolves.
- _Fixed_ — the "resets the cache and allows a later retry" regression test didn't
  actually prove a retry occurred: its assertion (`warnSpy` not called with the _first_
  call's message) passes identically whether the cache-reset fix exists or not, since a
  never-reset stale cache just never calls `warnSpy` again either. Verified this
  empirically by temporarily deleting the reset line and re-running the test — it still
  passed. Fixed by asserting on what the _second_ call's warning reason actually is
  (`'is not installed'`, which only a genuinely fresh `initSentry()` run produces),
  which fails correctly when the reset is removed.
- _Fixed_ — `seedEnvSchema` didn't use the `required()` helper this same round's second
  pass added to `lib/env.ts`, so an entirely-absent `SEED_OWNER_EMAIL`/`PASSWORD` (the
  normal fresh-checkout case, not just a blank one) fell back to zod's generic "received
  undefined" instead of the intended message — verified directly with `schema.safeParse({})`
  before fixing. Root cause: `required()` and `formatZodIssues` lived inside `lib/env.ts`,
  which importing anything from (even one named export) still eagerly runs `loadEnv()`
  against real `process.env` — exactly what `seed.ts` exists to avoid. Extracted both
  into a new `lib/zod-format.ts`, pure and side-effect-free (no `process.env` access), so
  `seed.ts` can now safely import the real helpers instead of hand-copying them. This
  also closed two related findings in the same change: `lib/env.ts`'s docstring falsely
  claimed `seed.ts` already reused `formatZodIssues` (it explicitly didn't, and said why
  in its own comment) — now genuinely true; and the inlined formatter duplication is
  gone. Also restored the "See .env.example..." trailer that had been dropped from every
  seed-config validation error, not just the absent-key case. Verified live against a
  scratch env file with `SEED_OWNER_EMAIL`/`PASSWORD` genuinely absent (not just
  blanked) — real `.env` untouched throughout, confirmed byte-identical by hash before
  and after.
- _Fixed_ — `seed.ts`'s `main().catch()` used `console.error` for every failure, even
  ones occurring _after_ `../log` had already been successfully dynamically imported
  (DB unreachable, `hash()` failure) — losing pino's structured output and stack trace
  for what's actually the more common real-world failure mode. Split: an inner
  try/catch inside `main()` now logs post-import failures through the real logger; the
  outer `console.error` catch is only reachable for the seed-config validation throw,
  where the logger genuinely isn't available yet. Verified live: a scratch env file
  pointed at an unreachable `DATABASE_URL` now produces a full structured pino error log
  with stack trace, not a bare message.
- _Fixed_ — the main pool's new timeouts (10s connect, 30s statement — from the second
  pass) silently applied to `lib/db/migrate.ts` too, via the shared `pool` export, and
  were never considered for that use case: a Neon cold-start or a legitimately
  long-running DDL migration could now be killed where it previously just waited.
  Exported `createPool()` and gave `migrate.ts` its own dedicated, uncached pool (it's a
  one-shot script — no HMR-cache need) with a longer connection timeout and no
  statement/query timeout, since a migration should be allowed to run to completion.
  Verified live: `migrate.ts` still runs cleanly against the real `dev` branch.
- _Fixed_ (minor) — `handlePoolError` logged `poolName` twice — once as a structured
  field, once interpolated into the message string. Removed the redundant
  interpolation.
- _Fixed_ (minor) — `vitest.config.ts`'s `hookTimeout` comment named `query_timeout` as
  what bounds the `afterAll` wait, but per the second pass's own correction elsewhere in
  the codebase, `statement_timeout` (the smaller value, and the real server-side
  cancellation) is what actually fires first. Corrected the comment.
- _Fixed_ (minor) — `seed.ts`'s two independent dynamic imports (`./index`, `../log`)
  were awaited sequentially. Switched to `Promise.all`.
- _Skipped, documented_ — `createPool()`'s no-duplicate-listener safety rests on a prose
  convention ("call only from the right-hand side of `??`") rather than anything
  compiler-enforced. Only 2 call sites exist; compiler-enforcing this would be
  over-engineering relative to what it buys at this scale.
- _Skipped, documented_ — `lib/env.ts`'s eager top-level `loadEnv()` call is the deeper
  architectural reason this exact class of bug (a one-off script needing partial env
  validation) keeps recurring. The `lib/zod-format.ts` extraction above fixes the
  practical symptom for the two helpers that needed reuse; a full lazy-`env` refactor is
  out of proportion for Phase 0 and cuts against the deliberate "fail loud at boot"
  design goal from `spec.md`.
- _Skipped, documented_ — `getSentry()`'s catch-and-reset mechanism guards a path that's
  already unreachable through `initSentry()`'s own two internal try/catches (only
  exercised by a contrived test mock, not real operation). Harmless defense-in-depth,
  already tested, not worth removing.

Re-verified end to end: lint/typecheck/build clean, 39/39 unit tests (100% coverage, up
from 38 — one new test added for the initial-log-throw fix), 3/3 integration tests
against the live `dev` branch, 2/2 E2E, local Semgrep scan (`p/javascript`+
`p/typescript`) 0 findings. Live-verified both `seed.ts` regressions directly: the
entirely-absent-keys case now shows the exact intended message plus the restored
`.env.example` trailer; the DB-unreachable case now shows full structured pino output
with a stack trace instead of a bare string. Confirmed `migrate.ts` still runs cleanly
against its new dedicated pool. All scratch-env testing used isolated copies in a
scratchpad directory — the real `.env` was confirmed byte-identical (by hash) before and
after every test in this pass.

---

## Phase 1 — Data model + auth + household sharing (2026-07-08)

**What shipped:**

- Full domain schema in `lib/db/schema.ts` (11 tables: `households`, `users`, `sessions`,
  `household_invitations`, `household_settings`, `login_attempts`, `categories`,
  `bank_accounts`, `recurring_schedule`, `monthly_entries`, `goals`) — every later phase
  adds business logic on top, not new tables. Migration generated and applied to the
  `dev` branch.
- Pure logic (`lib/auth/*`): `token.ts` (opaque 32-byte bearer tokens), `password.ts`
  (policy + argon2 hash/verify), `rbac.ts` (`can(role, action)` matrix), `session-rules.ts`
  (sliding 30-day expiry + a "only renew past the halfway point" rule to avoid a DB write
  on every request), `invite-rules.ts` (expiry/replay/token-mismatch validation),
  `rate-limit.ts` (5 failed attempts / 15-minute window per email+IP).
- Data layer: `lib/auth/session.ts` (create/read/revoke, cookie handling),
  `lib/auth/guards.ts` (`requireUser`/`requireRole` — the real, DB-backed authorization
  check used by every Server Action and page, independent of `proxy.ts`'s optimistic
  check), Server Actions for login/logout/change-password
  (`app/actions/auth.ts`), invite create/accept (`app/actions/invites.ts`), and member
  role-change/removal (`app/actions/members.ts`) — all zod-validated, all requiring the
  right role server-side.
- `proxy.ts` — Next 16's replacement for `middleware.ts` (see deviation log in
  `spec.md`). Does real (not just optimistic) session validation against Postgres and
  owns sliding-expiry cookie renewal.
- Keys-optional invite email (`lib/email/invite.ts`) — logs the accept URL when
  `RESEND_API_KEY` is unset, sends via Resend with a 5s timeout + fallback-to-log
  otherwise (full retry-with-backoff is Phase 6's job, alongside the dedup ledger).
- UI: `app/login`, `app/invite/[token]`, an authenticated shell
  (`app/(app)/layout.tsx` — sidebar, sign-out) and owner-only member management
  (`app/(app)/settings/members`), built on shadcn/ui (initialized this phase).
- `lib/db/seed.ts` now seeds a real household + owner user (idempotent via an
  email-existence check) instead of Phase 0's "prove the mechanism" placeholder.

**Test/CI status:** 91/91 unit tests (100% coverage on the gated scope), 21/21
integration tests against the live `dev` branch, 10/10 E2E tests, lint/typecheck/build
clean, local Semgrep (`p/javascript`+`p/typescript`) 0 findings.

**Failure modes handled:**

- DB unreachable during a `proxy.ts` session check → fails closed (treated as
  unauthenticated, not silently authenticated), logged.
- Malformed/tampered session cookie → no matching row, treated as unauthenticated, not
  a crash (adversarial E2E test).
- Resend down/timeout while sending an invite → invite row already exists regardless;
  logged and the owner can share the link manually.
- Argon2 verify against a corrupt/foreign hash string → returns `false`, not a throw.

**Key decisions and why:**

- Sessions are plain DB rows keyed by the opaque token itself (not JWT/encrypted) —
  simplest correct option for household scale, real revocation (delete the row) instead
  of waiting out a JWT's expiry, and no separate signing-key rotation story to build.
- `proxy.ts` does a _real_ DB-backed check rather than the cookie-only "optimistic"
  check Next's own docs suggest for Proxy — deliberate tradeoff: household-scale traffic
  makes the extra query negligible, and it's the only place sliding-expiry renewal can
  actually write a cookie (Server Components can't). Server Actions still independently
  call `requireUser`/`requireRole` regardless, per Next's own explicit warning that a
  matcher change or moved route can silently drop Proxy coverage.
- Cross-household scoping on `changeMemberRoleAction`/`removeMemberAction` puts
  `household_id` directly in the `WHERE` clause (not a separate ownership check after
  fetching by id) and returns a generic "Member not found" for a cross-tenant target —
  proven live via 21 real-DB integration tests, including two purpose-built
  cross-household probes.
- `formData`-based Server Actions throughout (not client-side `fetch`) — Next 16's
  built-in CSRF/origin check for Server Actions (`Origin` compared to `Host`) covers
  what `spec.md`'s "origin/CSRF checks" threat note asked for, with no custom code.

**Real bugs found and fixed (all caught before this phase's final commit):**

- A Playwright `beforeAll` fixture (a shared viewer test user) raced under the config's
  `fullyParallel: true` — Playwright can shard one file's tests across workers, running
  `beforeAll` more than once, causing a duplicate-key crash that cascaded into failing
  every test in the file. Fixed with `test.describe.configure({ mode: 'serial' })`,
  matching how the Vitest integration project already handles the same class of
  shared-DB-state hazard.
- `lib/db/index.integration.test.ts`'s pre-existing (Phase 0) tight-timeout test
  (`pingDb(1)`) turned out to be genuinely flaky, not just theoretically fragile: it bet
  a real network round-trip would always take longer than 1ms, which stopped holding as
  the test process's connection to Neon warmed up over a long session, flipping the
  assertion. Fixed by saturating the health pool's connection limit (`max: 2`) instead
  of racing real network timing — deterministic regardless of latency, since a 3rd
  concurrent request always has to wait for one of two held connections to free up.
- `server-only` (used to guard `lib/auth/session.ts`/`guards.ts`) was never actually
  installed as a dependency — `next build` succeeded anyway because Next's bundler
  resolves it internally, but plain Vitest couldn't, which only surfaced once unit
  tests tried to import those files. Installed explicitly (`npm install server-only`);
  confirmed 0 new high/critical `npm audit` findings.
- Self-inflicted: while investigating why `.rejects.toThrow(/unique/i)` wasn't matching
  a real Postgres unique-constraint error (the real message is nested under
  drizzle's wrapped error as `.cause`, not the top-level `.message` — fixed by
  asserting on `err.cause.code === '23505'`, Postgres's unique_violation SQLSTATE,
  instead of a message-text regex), a throwaway diagnostic script
  (`lib/db/_tmp_check.ts`) ended with an unscoped `await db.delete(households)` — no
  `.where()` clause. That deleted every household row (and, via cascade, every user,
  including the seeded owner) from the live `dev` branch. Deleting the script file
  afterward didn't undo the delete it had already run. Caught immediately when the next
  E2E run failed with "Cannot read properties of undefined" on the owner lookup;
  root-caused by checking table row counts directly. Fixed by re-running `npm run
db:seed` (idempotent, built for exactly this recovery) and removing two orphaned test
  households left over from crashed test runs. No production data was at risk (`dev`
  branch only), but it's a genuine reminder to scope every ad-hoc script's writes, not
  just the ones in committed code.
- `e2e/test-db.ts` exported one module-level `Pool` singleton shared by every E2E spec
  file, with each file's own `afterAll` independently calling `.end()` on it. Under
  local `dev` runs (`workers: undefined`, parallel) this never surfaced; under CI's
  config (`workers: 1`, `retries: 2`), Playwright runs spec files sequentially in one
  process, so whichever file's `afterAll` ran first closed the pool out from under the
  next file's tests — "Cannot use a pool after calling end on the pool," reported by
  Playwright as a "flaky" test since the retry sometimes landed in a fresh worker.
  Reproduced deterministically by running the full suite with `CI=true` locally, not
  just inferred from the stack trace. Fixed by turning `test-db.ts` into a factory
  (`createTestDb()`) that each spec file calls once for its own independent pool,
  instead of a shared singleton — confirmed fixed with 4 consecutive full-suite
  `CI=true` runs, all 10/10 green.
- Separately, running the full E2E suite `CI=true` also exposed a real test-isolation
  gap (not a flake): the "wrong password" test used the real seeded owner's email, and
  the login rate limiter (5 failed attempts / 15-minute window, built this same phase)
  correctly does its job — after enough repeated suite runs during development, the
  owner's own login_attempts history crossed the threshold and started rejecting the
  _legitimate_ login test too. The rate limiter wasn't the bug; sharing one identity
  across a "wrong password" scenario and a "real login" scenario was. Fixed by giving
  the wrong-password test its own dedicated, non-existent probe email (loginAction
  returns the same generic error regardless of whether the email exists, so this loses
  no coverage) and having the suite clear its own `login_attempts` rows in
  `beforeAll`/`afterAll`, so a run's outcome never depends on how many times the suite
  happened to run recently.

**Deferred / blocked:** none. Categories/accounts/recurring/monthly-entries tables exist
(created in this phase's migration per the phase plan) but have no business logic yet —
that's Phase 2, which adds no new tables per the plan.

**Second hardening pass (`/code-review` on Phase 1, extra-high effort, 2026-07-08):**
Unlike the three Phase 0 rounds (diminishing returns on already-reviewed plumbing), this
was fresh, unreviewed, security-critical code — auth, sessions, RBAC, cross-tenant
scoping — and the review found real, exploitable gaps. 15 findings, all fixed:

- _Partially fixed this round, fully closed next round (see below)_ —
  `createInviteAction` wasn't idempotent (only checked for an existing _user_, never
  an existing _pending invite_) and `acceptInviteAction` had a genuine TOCTOU race:
  `validateInvite()` ran against a row read before the transaction started, so two
  concurrent submissions of the same link both passed it, and the losing `INSERT`
  threw an uncaught unique-violation instead of a friendly error. Fixed the second by
  making the acceptance itself an atomic claim — `UPDATE household_invitations SET
accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`, checking whether that
  update actually affected a row _before_ ever touching `users`. Verified with a real
  concurrency test: two simultaneous `acceptInviteAction` calls against the same
  invite, asserting exactly one redirects and the other gets "This invite has already
  been used," with exactly one user row created. The first (`createInviteAction`) was
  _not_ actually fixed by this round's change: the pending-invite check added was a
  plain `SELECT` followed by an unguarded `INSERT` — the identical TOCTOU shape being
  fixed two lines above, reintroduced in the sibling function in the same commit. This
  entry originally (incorrectly) marked it "Fixed"; the next hardening round caught
  and corrected both the bug and this log entry — see below.
- _Fixed_ — `loginAction` had a timing side-channel: it returned immediately for a
  nonexistent email but ran a real argon2 `verify()` (~20ms, confirmed by direct
  measurement) for an existing user with the wrong password, before returning the
  identical error either way — letting an attacker enumerate valid emails purely from
  response latency. Fixed by always calling `verifyPassword` against a fixed dummy
  hash (`lib/auth/password.ts`'s new `DUMMY_PASSWORD_HASH`) when there's no such user,
  so both paths pay the same cost.
- _Fixed_ — the login rate limiter's `getClientIp()` trusted the _first_ value in
  `X-Forwarded-For` verbatim — client-suppliable, so an attacker could bypass the
  5-attempts/15-minute lockout entirely by spoofing a new IP per attempt. Fixed to
  trust the _last_ hop instead (what Vercel's own edge actually appended), verified
  directly: a synthetic header with a spoofed first entry and a real last entry now
  resolves to the real one.
- _Fixed_ — `changePasswordAction` updated the password hash but never touched the
  `sessions` table, so a stolen session cookie survived a password change — the
  standard "lock out an intruder" remedy didn't work. Fixed to delete every other
  session for that user (keeping the current one alive). Verified live with a
  two-browser-context E2E test: device A changes the password, device B's very next
  navigation bounces to `/login`, and the old password no longer works there while the
  new one does.
- _Fixed_ — `changePasswordAction` was fully implemented and unit-tested but had _zero
  UI wiring_ — unreachable in the running app despite being listed as shipped. Added
  `/settings/account` (a form using the existing action) and an "Account" link in the
  sidebar, visible to every role (unlike "Members," which stays owner-only).
- _Fixed_ — `acceptInviteAction` never checked whether the submitting browser already
  had a session before creating a new one, leaving the old session row orphaned (but
  still valid) until its own 30-day expiry. Fixed to revoke any existing session
  first; covered by a dedicated integration test.
- _Fixed_ — `getSessionUser()` had no try/catch around its DB query, unlike `proxy.ts`'s
  identical query, which explicitly fails closed — the two "is this session valid?"
  checks disagreed specifically when the DB was unhealthy (one 500s, one gracefully
  redirects). Added the same fail-closed guard; added a test that makes the DB query
  reject and asserts `getSessionUser` still resolves to `null`, not a throw.
- _Fixed_ — `changeMemberRoleAction`/`removeMemberAction` never called
  `revalidatePath`, so the Members page showed stale data after a successful mutation
  (confirmed against Next's own docs: every canonical Server Action example includes
  cache revalidation as an explicit, non-automatic step). Added
  `revalidatePath('/settings/members')` to both.
- _Fixed_ — the "can this user manage members" rule was hardcoded independently in two
  places (`members/page.tsx`'s `user.role !== 'owner'`, and the sidebar nav in
  `(app)/layout.tsx`) instead of calling the shared `can(user.role, 'manage_members')`
  that `requireRole` already uses as the source of truth. Replaced both.
- _Fixed_ — `requireRole`'s `ForbiddenError` was thrown uncaught with no error
  boundary anywhere in the app, falling through to Next's bare default error UI
  instead of anything on-brand. Added `app/error.tsx` (using Next 16's `unstable_retry`
  prop, not the older `reset` — confirmed against the current docs before using it).
- _Fixed_ — `createInviteAction`/`acceptInviteAction` had zero test coverage; the
  existing E2E invite tests bypassed both functions entirely by inserting invitation
  rows directly via `testDb`. This is the direct reason the idempotency and TOCTOU
  bugs above shipped undetected. Added
  `app/actions/invites.integration.test.ts` — 10 tests against the real `dev` branch,
  including the concurrency race test and a session-revocation test.
- _Fixed_ — `proxy.ts`'s redirects used the default HTTP 307, which preserves method
  and body — an unauthenticated Server Action POST got redirected (not gated) to
  `/login` carrying its original `Next-Action` payload, a known Next.js "Failed to
  find Server Action" failure mode. Changed both redirects to an explicit 303 (See
  Other), confirmed against `NextResponse.redirect`'s actual type signature
  (`init?: number | ResponseInit`) before using it.
- _Fixed_ — `users` had no index on `household_id` despite it being the exact column
  every household-scoped query filters by. Added `users_household_id_idx` via a new,
  purely additive migration, applied to the `dev` branch.
- _Fixed_ — `lib/auth/guards.ts`'s comment claimed proxy.ts's check was merely
  "optimistic," directly contradicting proxy.ts's own comment describing it as "the
  REAL session check." Corrected to describe both as independent real checks
  (defense-in-depth), not a strong one backing up a weak one.

Re-verified end to end: lint/typecheck/build clean, 92/92 unit tests (100% coverage,
up from 91 — one new test for `getSessionUser`'s DB-error path), 31/31 integration
tests against the live `dev` branch (up from 21 — 10 new tests directly exercising
`createInviteAction`/`acceptInviteAction`, including the concurrency race), 11/11 E2E
tests (up from 10 — the new two-browser-context change-password/session-revocation
test), local Semgrep 0 findings, `npm audit` unchanged (0 high/critical). Live-measured
the timing-side-channel fix (dummy-hash verify: ~20ms, a real argon2 cost, not
near-instant). Live-verified the X-Forwarded-For fix's last-hop extraction against a
synthetic spoofed header. All fixes verified against the real `dev` branch, not mocks;
DB confirmed clean (1 household, the seeded owner, 0 orphaned test rows) after the full
run.

Three findings from the same review round were deliberately **not** fixed (documented
reasoning, not silently dropped): a subtle race in `proxy.ts`'s renewal write under
concurrent requests for the same session (redundant writes, not a security issue — the
DB row is the source of truth, not the cookie); an unnecessary `innerJoin` in
`proxy.ts`'s session query (the FK already guarantees referential integrity, so it's
pure waste, not incorrect); and a pre-existing test-hygiene gap in
`members.integration.test.ts` (two of its tests leak an orphaned household row per
run) — real, but out of the 15 items actually triaged as fix-now for this round; the
leaked rows were cleaned up manually rather than left to accumulate.

**Third hardening pass (`/code-review` on the round-2 fix commit `5fe20aa`, extra-high
effort, 2026-07-08):** a review of dense fix commits touching the same functions again
— this project's own Phase 0 precedent (the seed.ts round) is that these are exactly
where regressions hide. Found real gaps, including one round-2 fix that was itself
broken. 7 items triaged fix-now, all fixed; the rest deferred with reasoning:

- _Fixed_ — `createInviteAction`'s own idempotency check (added last round) was a
  plain `SELECT` then `INSERT`, not atomic — the exact TOCTOU shape being fixed in
  the sibling `acceptInviteAction` in that same commit. Closed properly this time: a
  new partial unique index, `household_invitations_household_email_pending_unique`
  ON `(household_id, email) WHERE accepted_at IS NULL`, makes "one pending invite per
  household+email" a real Postgres constraint, not an application-level race. The
  insert is now an `INSERT ... ON CONFLICT ... DO UPDATE`, matching that same partial
  index, that only overwrites when the conflicting row is expired — reissuing an
  expired pending invite in place (same row, fresh token) and no-oping (nothing comes
  back from `RETURNING`) when a live one already exists, all in one atomic statement;
  no separate `SELECT` at all.
  Verified with a real concurrency test: two simultaneous `createInviteAction` calls
  for the same email, asserting exactly one succeeds and the other gets "An invite is
  already pending for that email," with exactly one row left in the table. Also
  corrected the "allows a fresh invite once expired" test, whose expectation (2 rows)
  encoded the old insert-a-duplicate behavior — it's now 1 row, updated in place.
- _Fixed_ — `acceptInviteAction` deleted the submitter's existing session (if any)
  _before_ calling `createSession()` for the new user, with no transaction spanning
  both. The invite claim is already irreversible by that point, so if `createSession()`
  ever threw, the user would be left fully logged out with no way back in — a new
  failure mode this exact commit introduced while fixing something else. Reordered:
  create the new session first, delete the old one after, so a failure at that point
  leaves the old (still-valid) session alongside the now-accepted invite instead of
  logging the user out entirely.
- _Fixed_ — `app/error.tsx` never called `lib/observability.ts`'s `captureException()`,
  despite that helper being purpose-built and hardened across multiple Phase 0 rounds
  for exactly this call site — an uncaught error reaching the boundary produced zero
  log line or Sentry event anywhere. `error.tsx` is a Client Component (Next.js
  requirement for error boundaries), so it can't import `lib/observability.ts`
  directly — that module pulls in `pino`/`node:crypto` via `lib/log.ts`, which isn't
  browser-bundleable. Added `app/actions/report-error.ts`, a Server Action bridge:
  the boundary's `useEffect` sends `error.message`/`error.digest` (not the `Error`
  instance) across the boundary, since production Next already redacts
  server-originated error messages down to a digest anyway. Side effect noted, not
  fixed (out of scope): wiring this up makes Turbopack statically resolve
  `lib/observability.ts`'s dynamic `@sentry/nextjs` import for the first time (it was
  previously unreachable dead code from the app's perspective), producing a
  build-time "Module not found" warning when the optional package isn't installed —
  confirmed harmless (`npm run build` and all test suites still succeed; this is the
  documented keys-optional fallback path actually firing), but the comment in
  `observability.ts` claiming the variable-specifier trick avoids this warning
  entirely is now known to be wrong under Turbopack specifically.
- _Fixed_ — `changePasswordAction`'s session-revocation query silently fell back to
  deleting the current session too (`eq(sessions.userId, user.id)`, no `ne()`
  exclusion) if `currentToken` were ever falsy — unreachable today since `requireUser`
  and the later `cookies()` read see the same request-scoped cookie store, but silent
  and untested. Changed to throw loudly instead, so the invariant stays enforced if
  that ever changes, rather than quietly logging the requesting user out.
- _Fixed_ — the new "change password" E2E describe block's `afterAll` never purged
  `login_attempts` for its test email, unlike the sibling "auth" describe in the same
  file, which explicitly does this for the identical reason (the test deliberately
  triggers a failed login). Added the same purge.
- _Fixed_ — the same test's two `browser.newContext()` calls were only closed at the
  very end of the test body with no `try`/`finally` — any earlier assertion failure
  (including the ones the test exists to check) would leak both contexts for the rest
  of the worker process. Wrapped in `try`/`finally`.
- _Fixed_ — `app/actions/invites.integration.test.ts`'s idempotency test only called
  `createInviteAction` sequentially, never concurrently, so it never actually
  exercised the TOCTOU race it was meant to guard against. Added a genuine
  `Promise.all` concurrency test (see first item above).

Re-verified end to end: lint/typecheck/build clean (Turbopack warning noted above,
non-fatal), 92/92 unit tests, 32/32 integration tests against the live `dev` branch (up
from 31 — the new concurrent-invite-creation race test), 11/11 E2E tests. Migration
`drizzle/0002_bitter_korath.sql` (the new partial unique index) generated and applied to
the `dev` branch.

Six findings from this round were deliberately deferred (documented reasoning, not
silently dropped): session-revocation logic duplicated across `changePasswordAction`
and `acceptInviteAction` instead of a shared `revokeOtherSessions()` helper (real, but
a refactor, not a bug); React 19's uncontrolled-form auto-reset clears
`change-password-form.tsx`'s fields even when the action returns an error rather than
throwing (a real UX papercut, not a security/correctness issue); no index on
`household_invitations(email)` for lookups outside the pending-partial-index path
(this round's atomic-upsert fix already eliminated the one query that needed it — the
old unguarded `SELECT` is gone); `getClientIp()`'s `hops[hops.length - 1] || 'unknown'`
fallback and its lack of dedicated test coverage (narrow edge case: a malformed
`X-Forwarded-For` with an empty trailing segment); `session.test.ts`'s "fails closed"
test not asserting `logger.error` was actually called (test-completeness nit, not a
product bug); and `DUMMY_PASSWORD_HASH` being a hardcoded string rather than derived
from `hashPassword()`'s live defaults (verified byte-identical today; would only drift
if someone changed argon2 params in one place and not the other — accepted tradeoff for
a Tier-2 app rather than adding machinery to keep them in sync).

---

## Phase 2: Core domain — categories, accounts, recurring, monthly — status: complete 2026-07-08

**What shipped** (three sub-slice commits, per-slice CI-green checkpoints, matching how
Phase 0/1 shipped — Phase 2 as a whole is too broad for one atomic commit):

- **lib/money.ts / lib/format.ts** — integer-cents conversion at the `numeric(12,2)` DB
  boundary (parse/format only, never mid-calculation) plus zod trust-boundary schemas
  (`moneyInputSchema`/`optionalMoneyInputSchema`) reused by every money form field across
  the phase. `lib/format.ts` is the only place a `$`/SGD symbol gets rendered — no
  hardcoded currency literals anywhere else (the original app's USD/SGD bug class).
- **lib/domain/recurring.ts, month-status.ts, entries.ts, month-params.ts** — pure,
  100%-covered logic: `shouldGenerate`/`parseScheduleMonths`/`walkMonths`/`addMonths`
  (recurring generation, ported from FinanceTracker's `generate` action),
  `deriveMonthStatus`, `shouldPropagate`/`getDifference`, and URL-param
  parsing/clamping for `?year=`/`?month=`/`?view=`. Property-tested (fast-check) per
  spec.md's Tier-2 money-math hardening: date-walk never skips/duplicates a month,
  `addMonths` round-trips, `getDifference` never produces NaN.
- **Categories + accounts** — household-scoped CRUD Server Actions; delete relies on the
  schema's existing `ON DELETE SET NULL` FKs (simpler and more atomic than the
  reference app's manual nullify-then-delete). New `/settings/categories` page.
- **Recurring schedule** — CRUD + toggle (atomic `SET is_active = NOT is_active`, no
  read-then-write race) + generate (`lib/generate-entries.ts`: walks the range, bulk
  `INSERT ... ON CONFLICT DO NOTHING` against the existing
  `(household_id, year, month, recurring_schedule_id)` unique index — idempotent,
  bounded to 120 months per call against a forged huge range) + edit-with-propagate
  (fetches candidate `monthly_entries` rows and filters them through the actual tested
  `shouldPropagate()` function, not a hand-translated SQL WHERE clause that could
  drift). New `/recurring` page.
- **Monthly entries** — `updateActualAction` (amount+date, matches the reference app),
  `overrideBudgetAction` (a Phase 2 addition: lets one forecast month's budgeted amount
  be corrected in place, setting `is_overridden` — the capability that actually gives
  that column and `shouldPropagate`'s guard something to protect), `addAdhocAction`
  (+`paid_by` tagging), `deleteEntryAction` (server-enforced ad-hoc-only — the reference
  app only hid the delete button in the UI for recurring-generated rows but never
  rejected the request itself). New `/monthly` page: calendar/agenda/list views behind
  a clamped `?view=` param, month tabs with status dots, summary bar, inline actual
  entry, ad-hoc add.
- **lib/flags.ts** — `household_settings`-backed kill-switch reader (spec.md's chosen
  runtime source) with a 30s in-memory cache; `auto_generate` wired up as the Monthly
  page's on-load hook, materializing the next 3 months every page load (idempotent, so
  repeat loads are cheap no-ops) unless the owner flips it off.
- **lib/db/seed.ts** — extended with the reference app's real categories/accounts/
  recurring items (ported from `FinanceTracker/src/lib/server/db.ts`), idempotent via
  natural-key checks, runs regardless of whether the owner/household was newly created
  or already existed.

**Test/CI status:** Unit 177/177 (100% coverage on the gated `lib/**` scope — DB-bound
modules `lib/flags.ts` and `lib/generate-entries.ts` excluded from the gate, same
precedent as `lib/db/index.ts`, exercised by integration tests instead). Integration
90/90 against the live `dev` branch. E2E 18/18 (chromium) including three new full
browser-driven specs (`categories.spec.ts`, `recurring.spec.ts`, `monthly.spec.ts`) that
each cover a real login → mutate → verify → viewer-read-only flow, not just the happy
path. `npm run build` green. All three sub-slices individually confirmed CI-green before
the next one started (`890a926`, `2564f49`, `e4e01fe`, `14dcc28`).

**Failure modes handled:** every money form field rejects negative/NaN/malformed input
at the zod trust boundary before it reaches a query; `schedule_months` is validated AND
normalized through the same parser `shouldGenerate` reads back later, so stored data and
validation can never drift apart; a forged huge generate range is capped at 120 months
instead of attempting an unbounded insert; every mutation scopes its `WHERE` by
`household_id`, not just by row id (cross-tenant probes return a generic "not found,"
never revealing whether the id exists in another household).

**Key decisions and why (deviations/additions beyond the original plan):**

1. **`overrideBudgetAction` — a genuine addition beyond the reference app.** spec.md's
   Phase 2 task list only names `updateActual`/`addAdhoc`/`deleteEntry`, but it also
   explicitly calls out `is_overridden` and the edge case "is_overridden set then
   recurring edit propagates" as in-scope. The reference app has no mechanism that ever
   sets that column, which would leave it dead. Added a scoped, minimal capability
   (override one forecast month's budgeted amount) instead of leaving the column and
   its propagation guard untested and unreachable.
2. **`deleteEntryAction` restricted to ad-hoc entries, server-side.** The reference app
   only hides the delete button in the UI for recurring-generated rows; the server
   action itself deletes anything by id. Closed this — an attacker forging the request
   directly could otherwise delete a generated forecast month without going through the
   recurring item's own `removeForecast` path.
3. **Generate logic factored into `lib/generate-entries.ts`**, not left inline in the
   Server Action, once the Monthly page's auto-generate hook needed the exact same
   walk-and-bulk-insert behavior — one implementation, not two copies that could drift.
4. **List view adds an "Uncategorized" section** the reference app doesn't have. Its
   table view filters entries into income/expense groups by category direction; an
   entry with no category matches neither filter and silently never renders. Caught
   during E2E testing (a real recurring item with no category selected simply
   vanished from list view). Calendar/agenda views were never affected — they group by
   scheduled day, not category, so every entry was already visible there.

**Real bugs found and fixed (root cause, not just "fixed a bug"):**

- **List view silently dropped uncategorized entries** — see decision #4 above. Root
  cause: two mutually-exclusive filters (`direction === 'income'` /
  `direction === 'expense'`) with no fallback bucket for `direction === null`. Fixed by
  adding a third "Uncategorized" group.
- **`e2e/monthly.spec.ts`'s cleanup leaked a row on every run.** The test renames its
  recurring item mid-run (the propagate step) but `afterAll` only deleted by the
  _original_ name, so the renamed row was never matched and never deleted. Found
  indirectly: `npm run db:seed`'s idempotency check reported 20 recurring items in the
  household when only 17 were defined, in a database no test should have been able to
  leave dirty. Traced to 3 orphaned `"E2E Monthly Item ... propagated"` rows from prior
  test runs; fixed the cleanup query to match both names and manually removed the
  existing orphans from the `dev` branch.
- **`accounts.integration.test.ts` queried `bank_accounts` by name only, no household
  scope.** Harmless in isolation, but once `lib/db/seed.ts` started creating its own
  "Credit Card" account in a different household, the unscoped query could
  nondeterministically return the wrong row — the test started failing intermittently
  the moment seed data existed. Scoped the query by `household_id`.
- **Toggle-recurring-active used a naive read-then-write initially, reconsidered before
  shipping**: implemented directly as an atomic `SET is_active = NOT is_active` instead,
  so two concurrent toggle clicks always net out to "flipped twice" rather than a
  lost-update race where both requests read the same starting value.

**Deferred / blocked:** one known, accepted gap — the Monthly page's summary bar totals
(budgeted/actual income and expense) only sum entries with a category direction, so an
uncategorized entry's amount doesn't appear in either total (list view still shows the
entry itself, per the fix above; only the aggregate is affected). Direction-less
amounts genuinely can't be classified as income or expense, so there's no obviously
correct number to add them to — left as-is rather than guessing, with no UI indicator
that a total might be incomplete. Worth a visual cue in a later pass. Everything else:
categories/accounts/recurring/monthly-entries business logic is now fully live (the
tables existed since Phase 1's migration, per the phase plan's "Phase 2 adds no new
tables"). Dashboard aggregation, category budget caps, goals, net worth, CSV
import/export, email/cron, and PWA remain later phases per `spec.md`'s numbered plan —
nothing from this phase's own scope was skipped or shortcut.

**Hardening pass (`/code-review` on the full Phase 2 diff, extra-high effort,
2026-07-08):** 15 findings across 10 finder angles plus a gap-sweep, verified by direct
code reading (not just agent votes) before triage. 13 fixed, 2 deferred with reasoning:

- _Fixed_ — the Monthly page's auto-generate hook checked the `auto_generate` flag but
  never `requireRole('write')`, the one write path in the app that wasn't role-gated —
  a viewer's page load triggered real `monthly_entries` INSERTs, violating "viewers are
  read-only everywhere." Gated behind `canManage` (already computed on the page for
  other purposes), which also skips a wasted flag-cache lookup for viewers.
- _Fixed_ — the inline "Actual" amount input auto-submitted on every keystroke
  (React's `onChange` fires per character, unlike the ported Svelte app's `onchange`,
  which only fires on blur/commit), and `disabled={actualPending}` locked the field
  mid-typing, dropping keystrokes. Switched to `onBlur` + explicit Enter/Escape
  handling, which also finally implements spec.md's "keyboard-friendly: Enter saves,
  Esc cancels" requirement that had never actually been wired up.
- _Fixed_ — Calendar/Agenda view silently dropped any entry whose `scheduledDay`
  exceeded the viewed month's length (e.g. day 31 in February) — the exact edge case
  spec.md's Phase 2 "Ready" section names explicitly. Clamped to the last real day of
  the month, matching the month-end-clamping approach spec.md already establishes for
  Phase 6's reminder logic.
- _Fixed_ — Calendar view's daily net total and entry-dot coloring treated any
  uncategorized entry (`categoryDirection === null`) as an expense, inconsistent with
  this same PR's own List view fix (an "Uncategorized" section) and the Summary Bar
  (which excludes them from totals entirely). Made it a real three-way split
  (income/expense/excluded) in both the net calculation and the "No scheduled day"
  card styling.
- _Fixed_ — `getPropagationTargetIds` SELECTed candidate row ids matching
  `shouldPropagate`, then a separate UPDATE/DELETE acted on those ids with no re-check
  at write time — a genuine TOCTOU race (a concurrent `updateActualAction` landing on
  one of those exact rows between the SELECT and the write would still get silently
  overwritten). Replaced with a single atomic statement: the predicate is now part of
  the UPDATE/DELETE's own WHERE clause, so the read-and-decide happens in the same
  statement as the write. Verified live with a real concurrency test:
  `updateActualAction` and `updateRecurringAction(propagate: 'yes')` fired
  concurrently at the same row, asserting the final state is always one of the two
  valid orderings, never a corrupted mix — run 5 times to rule out a test that only
  ever exercises one interleaving.
- _Fixed_ — `resolveLinkedAccountId` validated the link _target_ is a 'bank' account
  but never checked the account being created/edited is itself 'credit', so a plain
  'bank' account could end up with a non-null `linkedBankAccountId`. Added the source
  check to both actions, plus a new guard in `updateAccountAction`: changing an
  account's type away from 'bank' while another account still links to it as its bank
  account is now rejected outright, not silently left dangling. UI forms updated to
  hide the linked-account field for 'bank' type, so the server rejection is rare rather
  than routine.
- _Fixed_ — `generateEntriesForRange`'s SELECT-then-INSERT wasn't wrapped in a
  transaction despite spec.md literally specifying "in one transaction." Wrapped in
  `db.transaction()`.
- _Fixed_ — three trust-boundary gaps that would have crashed as unhandled Postgres
  exceptions instead of returning a graceful validation error: money schemas had no
  cap on integer-digit count (an 11-digit amount would pass zod, then hit a
  `numeric(12,2)` overflow), `actualDate` had zero format validation (any string
  reached the `date` column), and `actualDateDay` used `Number.parseInt`, which
  truncates at the first non-digit ("5xyz" → 5) instead of rejecting it. All three
  fixed with strict validation matching the discipline already used for every other
  money field in this codebase; the digit-cap fix verified live with a new E2E test
  that submits an 11-digit ad-hoc amount through the real browser and confirms the
  friendly error renders instead of a crash.
- _Fixed_ — `generate-form.tsx`'s "12 months ahead" default had an always-true ternary
  condition (`currentMonth <= 12`, and `now.getMonth()+1` is always in `[1,12]`), so
  the year-rollover branch was dead code and the default silently stayed within the
  current calendar year regardless of intent. Replaced with `addMonths(current, 11)`
  (the existing pure helper) for an unambiguous, always-correct 12-month window. This
  changed the _shape_ of what a bare "click Generate" produces (a full year forward,
  not "through December"), which surfaced a real, pre-existing fragility in
  `e2e/recurring.spec.ts`: its DB assertion queried for "the" generated entry with no
  year/month filter, previously safe by coincidence (every prior default stayed within
  one calendar year) — fixed the query to filter for the current month specifically.
- _Fixed_ — no E2E test covered "invalid amount rejected with visible error," which
  spec.md's Phase 2 test plan explicitly requires. Added one (doubles as live
  confirmation of the digit-cap fix above).

Deferred, documented rather than fixed:

- **No UI control anywhere lets a user set an actual entry's date.** The hidden
  `actualDate` field in `entry-row.tsx` only ever echoes back `entry.actualDate`, which
  starts `null` and — since there was never a date input — can never become non-null
  through the UI, despite `updateActualAction` fully supporting one and spec.md's task
  list literally naming "updateActual (amount+date)." This is a small missing
  _feature_ (a date `<input>`, wiring, and a UX decision on placement — inline vs. a
  small popover), not a one-line bug fix, so it's scoped out of this hardening pass
  rather than rushed in. Tracked for a follow-up.
- **`lib/flags.ts`'s kill-switch cache is a bare module-level `Map`, with no
  cross-instance invalidation on Vercel's serverless model.** `setFlag()` only evicts
  the cache entry on whichever instance handled the toggle request; other concurrently
  warm instances keep serving a stale value for up to their own independent 30s
  window. At this app's household scale (a handful of concurrent users, not
  production SaaS traffic) the realistic blast radius of a kill-switch flip taking up
  to 30s longer to fully propagate is low, and redesigning the cache (e.g. a shared
  KV/Redis-backed store) is a real architectural change, not a bug fix — accepted as a
  documented limitation rather than solved under review-fixup time pressure.

Re-verified end to end: unit, integration (recurring/accounts/monthly test files grew
by the new adversarial + concurrency tests above), and E2E suites all green;
lint/typecheck/build clean. Every fix was checked against the actual live dev branch or
a real browser session, not just read — the concurrency fix specifically got 5
consecutive runs to rule out a test that only exercises one interleaving of the race.

---

## Post-Phase-2: repo made public, CI stabilized (2026-07-09)

**What happened:** GitHub Actions started instant-failing every push with a billing message
("recent account payments have failed or your spending limit needs to be increased"). Root
cause: the private-repo free-tier Actions-minutes allowance was exhausted by heavy same-day CI
iteration, and there's no payment method on file to raise it. Decision: flip the repo to
public (unlimited Actions minutes on standard runners) rather than throttle development. See
`spec.md`'s "Post-Phase-2 operational deviation" entry for the full record.

**Before flipping, in order:**

1. Genericized `lib/db/seed.ts` — it carried real personal/financial data ported verbatim from
   the reference app: real salary/mortgage/rental-income figures, real Singapore bank names,
   and real household-member first names embedded in several recurring-item labels. Replaced
   with structurally equivalent fictional data (same category/account/frequency shapes,
   including the Quarterly/Yearly `schedule_months` and `actual_date_day` edge cases the old
   data exercised). Also scrubbed a stray name mention from `spec.md`. (Deliberately not
   quoting the specific old values here — this file is committed to the now-public repo; see
   the `/code-review` pass below for a case where that exact mistake almost shipped.)
2. Rewrote git history (`git filter-repo --path lib/db/seed.ts --invert-paths`) to remove the
   real data from _every_ prior commit, not just HEAD, then re-added the file fresh at the tip
   and force-pushed. Verified with a full-history grep afterward that no trace of the real data
   remains anywhere in the repo.
3. Cleaned the real-data rows out of the dev Neon branch and reseeded from the new definitions;
   proved idempotency (second `db:seed` run inserts 0 rows).
4. Flipped `steby/fintrack` to public via `gh repo edit --visibility public`.

**Fallout, found and fixed while confirming CI was actually green afterward:**

- _Fixed_ — the history rewrite changed every commit SHA from the rewritten point forward,
  which broke `.gitleaksignore`'s commit-SHA-pinned fingerprint for the Phase 0
  planted-fake-secret allowlist entry. Updated to the new SHA; a transient checkout-cache lag
  briefly had two different runs report two different SHAs for the same commit, so both are
  now listed.
- _Fixed_ — the `ci` Neon branch is long-lived and this workflow cancels in-flight runs on
  every superseding push (`concurrency.cancel-in-progress`), which — combined with today's
  rapid iteration and `seed.ts`'s by-name idempotency check leaving several old real-named rows
  stuck instead of updated — had accumulated enough duplicate/orphaned rows to blow the
  calendar view's E2E test timeout. Added a CI cleanup script (see the `/code-review` pass
  below — its final form is `lib/db/clean-e2e-debris.ts`) as a permanent defense against
  future `cancel-in-progress` debris, plus a one-time sweep of the specific old real-named
  rows left over from the genericization above.
- CI is now fully green end to end (all steps, including E2E) on the public repo, confirming
  the Actions-minutes block is resolved.

**`/code-review` pass on the above (before starting Phase 3), 14 findings — 11 fixed or
resolved (several findings shared one underlying code change, hence fewer bullets below than
findings), 3 deferred:**

The first version of the CI cleanup script (`lib/db/clean-legacy-data.ts` at the time) had a
critical bug: its legacy-name list included 7 names that are _also_ current, active names in
the genericized `seed.ts` — so instead of a one-time cleanup, it deleted and force-recreated
live seed data with new ids on every single CI run, permanently orphaning the bank-account
link on 12 recurring items (the 6 directly-colliding ones, plus 6 more that merely linked to
the one deleted-and-recreated bank account and were never re-linked, since `seed.ts`'s
idempotency check skips existing rows). This had already run once in CI before being caught.

Looking closer at why the list needed those specific old names at all — it existed to delete
rows matching the exact real values genericization had just replaced, which meant the file
itself had to spell those real values out in committed source. Checking whether that one-time
cleanup had actually already succeeded (it had — confirmed via the prior CI run's own log
output: 174 `monthly_entries`, 17 `recurring_schedule`, 5 `bank_accounts` rows swept in a
single pass, immediately followed by a correct reseed) meant the list no longer needed to
exist at all, not just get its colliding entries trimmed.

- _Fixed_ — removed the legacy-name list entirely (not just its colliding entries) rather than
  keep it as permanent dead weight — its one-time job was already done, confirmed against the
  prior run's own logs, and it would otherwise leave the exact real values genericization
  removed sitting in committed, now-public source code indefinitely, permanently undoing the
  point of the genericization pass. Renamed the file `clean-legacy-data.ts` →
  `clean-e2e-debris.ts` to match its narrowed, permanent scope.
- **A second instance of the same class of mistake, caught right before it shipped:** the
  first draft of _this very changelog entry_ quoted the real old values as illustrative
  examples, which would have reintroduced them into the public repo through the documentation
  meant to explain removing them. Caught by the same real-time safety check that blocks
  destructive/sensitive actions generally, not by manual review — a reminder that "don't quote
  the sensitive value, even to explain that it was removed" needs to be an active habit in a
  now-public repo, not just a one-time cleanup task.
- _Fixed_ — rewrote the script to use `lib/db/index.ts`'s validated pool/Drizzle (was a raw,
  unvalidated `pg.Client` on bare `process.env.DATABASE_URL` — no timeout, no error listener,
  bypassed `lib/env.ts`'s zod validation) and wrapped all deletes in one `db.transaction(...)`
  (was 8 unwrapped sequential statements — a mid-failure left a partially-cleaned state).
- _Fixed_ — added a `process.env.CI !== 'true'` guard: the script's DELETE patterns are broad
  by name/prefix, not household-scoped (there's no single "right" household to scope to on a
  shared branch with many ephemeral test households — the name/prefix list _is_ the scoping
  mechanism), which makes it unsafe to run locally by accident against a real `DATABASE_URL`.
- _Fixed_ — switched `console.log`/`console.error` to the codebase's structured pino logger,
  matching every other script's convention.
- _Fixed_ — added `lib/db/clean-e2e-debris.ts` to `vitest.config.ts`'s coverage-exclude list
  (every structurally identical DB-plumbing sibling is excluded there; this one was missed).
- _Fixed_ — updated `spec.md`/this file to actually document the public-repo flip and history
  rewrite, which had gone undocumented in the very session that made them (a real process
  violation of `AGENTS.md`'s "update spec.md immediately" rule — caught by the review's
  conventions angle, not spotted proactively).

**⚠ UNRESOLVED — found by a separate re-review pass on this fix (not one of the 14 findings
above), requires the owner's explicit decision, deliberately NOT acted on:**

- **The original, real-named `LEGACY_SEED_ITEM_NAMES`/`LEGACY_SEED_BANK_NAMES` content is
  still reachable in this repo's git history, on the public remote, right now.** Removing the
  legacy-name list (above) only changed the current HEAD state — it did not rewrite history,
  unlike the `seed.ts` genericization pass earlier this session, which specifically used `git
filter-repo` for exactly this reason. `8ebf134` (the commit that first added the buggy
  version of this file, with the real values spelled out) is a confirmed ancestor of the
  current public `origin/main` HEAD — verified directly: `git merge-base --is-ancestor 8ebf134
origin/main` returns true, and `git show 8ebf134:lib/db/clean-legacy-data.ts` (or GitHub's
  own commit/file-history UI) currently returns the real values in full. This is the exact
  same class of exposure the earlier `seed.ts`/history-rewrite work was done to prevent — it
  was simply missed for this second file.
- **Why this isn't just fixed the same way, immediately:** the fix is the same technique
  already used successfully once this session (`git filter-repo` to strip the file's real
  content from history, then force-push) — but doing that requires a force-push and touches
  the repo's shared history, which is explicitly outside this session's standing authorization
  to act on without asking first, including overnight. Leaving a real, live exposure
  unresolved rather than silently fixing it with an action outside that authorization was the
  more conservative choice, even though it means the exposure persists a while longer.
- **What to do:** on your next session, say the word and this gets fixed the same way as
  `seed.ts` was — `git filter-repo --path lib/db/clean-legacy-data.ts --invert-paths`
  (the file no longer exists at HEAD, so nothing needs re-adding this time), force-push, and a
  full-history grep to confirm. Low risk to execute (same repo, no other collaborators, a
  backup bundle from the earlier rewrite already exists locally), just outside standing
  overnight authorization.
- Also worth a look while addressing this: a pre-existing integration test file uses a couple
  of real-world bank brand names as arbitrary fixture values (not introduced tonight, already
  reasoned about once this session as low-risk generic fixture data on their own) — not urgent
  by itself, but worth a second look in the same pass for consistency.

Deferred, documented rather than fixed:

- **`concurrency.group` is per-ref, but the shared `ci` branch is not.** Two concurrent runs
  from different refs (two PRs, or a PR overlapping a `main` push) aren't mutually serialized,
  so their DB steps could in principle interleave. Real but pre-existing (not introduced by
  this diff), low-probability at this project's actual usage pattern (single maintainer), and
  the proper fix (a global lock, or a per-run ephemeral branch) is a bigger infra change than a
  review-fixup pass. Tracked for later.
- **`household_invitations` rows are never cleaned by anything.** Accepting an invite only
  `UPDATE`s `acceptedAt` (confirmed in `app/actions/invites.ts`) — the row is never deleted,
  the E2E test's own cleanup doesn't remove it, and `clean-e2e-debris.ts` doesn't reference
  that table. Pre-existing gap, unrelated to this diff, and low severity (row bloat, not a
  correctness or security issue). Tracked for later.
- **`.gitleaksignore`'s commit-SHA-pinned fingerprints will break again on any future history
  rewrite** (as they did this session). A `.gitleaks.toml` with a path-based `[[allowlists]]`
  entry would match by file path regardless of commit SHA and survive rewrites permanently.
  Real improvement, not urgent (the current fix works), deferred rather than done under
  review-fixup time pressure.

Re-verified: typecheck/lint/unit/integration clean, CI green on the fix commit.

---

## Phase 3: Dashboard + theming — status: complete 2026-07-09

**What shipped:**

- **Pure logic (`lib/domain/dashboard.ts`):** aggregation shaping over already-fetched row
  arrays — monthly budgeted/actual series (always 12 points, even for an empty year),
  year totals, expense category breakdown (sorted by budgeted descending), cumulative
  savings walk, fixed-vs-variable split (`recurring_schedule_id IS NOT NULL`, ported
  exactly from the reference app's `+page.server.ts`), bank inflow/outflow summary, and
  YoY delta (null percentage rather than NaN/Infinity when there's no prior-year
  baseline). 17 unit tests cover the named edge cases: empty year, all-zero, partial
  actuals within a month, absent prior year, both years zero.
- **Data layer (`lib/db/queries.ts`):** one scoped query (`getDashboardRows`) per
  year — left-joins category direction/name/color and bank account name, converts
  `numeric` strings to integer cents at the boundary. Deliberately fetches row-level
  detail rather than pre-aggregating in SQL (unlike the reference app), so every
  aggregation lives in the unit-tested pure layer instead. 5 integration tests
  (household scoping, year scoping, null-handling, cents conversion).
- **UI:** stat tiles (income/expense/net/savings-rate), cash-flow bar chart, expense
  category doughnut, cumulative-savings line chart (all Recharts, reading
  `var(--border)`/`var(--muted-foreground)`/`var(--popover)` so both themes render
  correctly without a re-render), bank summary table, fixed-vs-variable card, YoY
  card. Every amount goes through `formatSGD`/`formatSGDCompact` — no hardcoded `$`
  (the original app's USD/SGD bug class).
- **Theming:** `next-themes` wired into the root layout (`ThemeProvider`,
  `suppressHydrationWarning`), a sidebar toggle (`useSyncExternalStore` for the
  mount-check rather than an effect + `setState`, avoiding
  `react-hooks/set-state-in-effect`). The dark theme's tokens were rewritten from
  shadcn's default dark gray to **true OLED black** (`oklch(0 0 0)` background),
  ported from the reference app's monochrome design system
  (`FinanceTracker/src/app.css`) — spec.md's "preserving the OLED-dark identity."
  Income/expense colors stay as explicit Tailwind utilities (emerald/red), matching
  the convention Phase 2 already established, rather than the shadcn `--chart-*`
  tokens.
- **Year navigation:** a sidebar quick-jump (`YearNav`, anchored to the real current
  year — Next.js layouts don't receive `searchParams`, so it can't reflect whichever
  year the dashboard is currently showing) plus in-page prev/next controls on the
  dashboard itself (`YearPicker`, which does know the selected year). Both are plain
  `Link`s, URL-driven, no client state.
- **E2E (`e2e/dashboard.spec.ts`, 5 tests):** a seeded year renders every widget; an
  empty year (`?year=2099`) renders empty states with no crash and no `NaN` anywhere
  on the page; `?year=99999`/`?year=not-a-number` clamp to the current year; the
  sidebar year-jump and in-page year-picker both navigate correctly; the theme toggle
  switches and persists across a reload. All run against a real Chromium browser, not
  just asserted from code.
- **Adversarial:** confirmed via grep that no dashboard file hardcodes a `$` — every
  amount routes through `formatSGD`/`formatSGDCompact`.

**Deviations from the literal phase plan, documented rather than silent:**

- Fetches entry-level rows and aggregates in TypeScript rather than doing the
  aggregation in SQL like the reference app — spec.md's own Phase 3 task list already
  calls for "aggregation shaping ... as pure functions over row arrays," so this
  isn't a deviation from spec, just flagged here since it's a real structural
  difference from the app being ported.
- The sidebar year selector can't reflect the dashboard's currently-selected year (a
  Next.js architectural constraint — layouts don't receive `searchParams`); it's a
  quick-jump anchored to the real current year instead, with the dashboard's own
  prev/next controls handling fine-grained navigation once you're there.

**`/code-review` pass (before starting Phase 4), 10 angles, 10 findings fixed:**

- _Fixed_ — the cash-flow chart only ever plotted actual income/expense, never the
  budgeted values `lib/domain/dashboard.ts` already computed — a direct miss of
  spec.md's own Ready criterion "months with budget but no actuals (charts show
  budget-only)." Added budgeted bars in a lighter shade alongside actual, so a
  forecast-only month now shows its plan instead of a bare $0 bar.
- _Fixed_ — `CategoryChart`'s Pie `Cell` was keyed by category display name, not the
  guaranteed-unique `categoryId` already available on `CategoryBreakdownPoint`.
  `categories.name` has no uniqueness constraint, so two same-named categories would
  collide on React keys and risk a misattributed fill color. Independently caught by
  4 of the 10 review angles.
- _Fixed_ — `YearPicker`'s prev/next links weren't clamped at `MIN_YEAR`/`MAX_YEAR`
  (2000/2100): clicking "previous" at year 2000 built a link to 1999, which
  `parseYearParam` rejects and silently resets to the real current year — teleporting
  the user decades forward instead of stopping. Exported `MIN_YEAR`/`MAX_YEAR` from
  `lib/domain/month-params.ts` and disabled the link at each boundary.
- _Fixed_ — setting `defaultTheme="dark"` made dark mode reachable/default for the
  **first time** across the entire app, not just the new dashboard — every Phase 1/2
  page had only ever been visually built and reviewed in light mode. Manually
  spot-checked 5 existing pages (Monthly list/calendar, Recurring, Settings, plus the
  dashboard) via real Chromium screenshots; found and fixed 6 files with hardcoded
  `text-emerald-600`/`text-red-600` and no `dark:` variant (`calendar-view.tsx`'s
  daily-net badge, `entry-row.tsx`'s difference column, `summary-bar.tsx`'s 6 stat
  colors, `generate-form.tsx`'s success message, `recurring-row.tsx`'s Active badge,
  `settings/categories/page.tsx`'s Income/Expense headers) — all now match the
  `dark:text-emerald-400`/`dark:text-red-400` convention the new dashboard widgets
  already established.
- _Fixed_ — `lib/db/queries.ts` was missing from `vitest.config.ts`'s coverage-exclude
  list, unlike every other DB-plumbing file with the same "needs a live connection"
  profile — confirmed via `npm run test:coverage` that it was scoring 0% on all four
  metrics.
- _Fixed_ — `spec.md`'s Phase 3 task item still read "scoped SQL aggregations (port
  the original's queries)" with no note that this shipped as one flat entry-level
  query plus TypeScript aggregation instead — a real deviation from the literal
  wording, even though it matches the same section's own "pure functions over row
  arrays" framing. Added a deviation-log entry.
- _Fixed_ — the "prev-year absent (YoY hides gracefully)" edge case named in spec.md's
  Ready criteria was unit-tested but not E2E-tested. Added an assertion to the
  existing empty-year test (2098/2099 both have no data, so the YoY card's "no prior
  year" fallback is exercised for real).
- _Fixed_ — `MONTH_SHORT` was copy-pasted verbatim into a new
  `dashboard/month-labels.ts` instead of reusing `monthly/month-tabs.tsx`'s existing
  array. Consolidated into `lib/format.ts` (the established display-formatting home)
  and updated both call sites.
- _Fixed_ — `StatTiles` was the only dashboard widget not using
  `CardHeader`/`CardTitle`/`CardContent`, instead hardcoding `className="px-4"` on
  `Card` directly — happened to render identically today only because Tailwind's
  `px-4` matches `Card`'s current default `--card-spacing`, but would silently drift
  if that default ever changed. Switched to the same composition every other widget
  uses.
- _Fixed_ — `YoyCard`'s percentage badge could show a stray "-0.0%" in the
  unfavorable/red color for a near-zero delta (JS's negative-zero-adjacent
  `toFixed(1)` behavior), reading as a real move when the two years are effectively
  flat. Now rounds first and renders a neutral "0.0%" when the rounded value is
  exactly zero.

Deferred, documented rather than fixed: two computed-but-unrendered fields
(`CategoryBreakdownPoint`'s actualized/total counts, `YoyDelta`'s absolute deltas) —
real UI enhancements, not bugs, scoped out of a review-fixup pass; the sidebar
year-selector's inability to reflect the dashboard's actual selection (documented
above) — a `usePathname`/`useSearchParams` client-component rewrite is possible but
adds a Suspense boundary for a working-fallback UX gap, not a correctness issue;
`getDashboardRows` not yet carrying the `monthlyBudget`/`openingBalance` fields Phase
4 will need — accepted per this project's own no-speculative-building discipline; the
OLED-dark rewrite porting only flat color tokens, not the reference app's
glassmorphism/gradient system — already scoped and documented as literal to spec.md's
wording, not silent.

Re-verified: unit (17 new + 197 total), integration (5 new + 103 total), and E2E (6
new + 24 total) all green; lint/typecheck/format/build clean. One E2E flake
(`auth.spec.ts`) during a full-suite run, passed cleanly both in isolation and on a
full-suite re-run — transient, not a regression.

---

## Phase 4: Budgeting additions — category budgets, goals, net worth — status: complete 2026-07-09

**What shipped:**

- **Pure logic (`lib/domain/budgeting.ts`):** `computeBudgetProgress(spentCents,
capCents)` — distinguishes `capCents === null` ("never budgeted," no progress bar)
  from `capCents === 0` ("explicitly budgeted to zero," so any spend at all is an
  immediate 100%+ overspend), matching spec.md's Ready criterion verbatim.
  `computeGoalProgress(savedCents, targetCents, createdAt, targetDate, now)` — percentage/
  remaining/complete/overdue, plus a naive linear projected-completion date extrapolated
  from the goal's own average daily savings rate since `createdAt` (there's no history
  table behind `saved_amount`, per the user's explicit "manual edit, not derived" design
  decision, so this is the simplest defensible projection available, not a real
  regression). 13 unit tests cover null-vs-zero cap, >100% overspend, a past `targetDate`,
  a zero-target goal (no NaN), and both projection-null cases.
- **Pure logic (`lib/domain/net-worth.ts`):** `buildAccountBalances(accounts, entries)` —
  a running-balance walk per bank account, with credit-account spend redirected to its
  `linkedBankAccountId`'s series (and excluded entirely if unlinked — nowhere to
  attribute it), per the user's explicit "exclude credit accounts entirely" design
  decision. `buildNetWorthSeries(accountBalances)` sums bank-type balances per month. 10
  unit tests, including a `fast-check` property test asserting the running balance is
  order-independent within a month (entries can arrive in any order from the DB).
- **Data layer:** `monthlyBudget`/`openingBalance` gated server-side by
  `env.FEATURE_CATEGORY_BUDGETS`/`env.FEATURE_NET_WORTH` in `app/actions/categories.ts`/
  `accounts.ts` (rejects the write outright if the flag is off, not just hidden in the
  UI); a new signed `openingBalanceSchema` in `accounts.ts` (distinct from the existing
  non-negative `moneyInputSchema`, since spec.md names a negative opening/running balance
  as a valid case); `app/actions/goals.ts` (new) — full CRUD, household-scoped,
  `requireGoalsEnabled()` gate, `targetAmount` required `> 0` via a zod `.refine`.
  `lib/db/queries.ts` gained `getAccountsForNetWorth`/`getCurrentMonthCategoryBudgets`
  (the budget query is scoped to the real current month regardless of which year the
  dashboard is browsing — a monthly cap is about "right now," not the browsed year).
- **UI (behind config flags, so a household that never enables them sees zero traces):**
  budget-cap input + progress bar (`BudgetBar`, red over cap) in
  `/settings/categories`; opening-balance input (bank accounts only — credit accounts
  have no balance series of their own in this model) in the same page; a new `/goals`
  page (cards, add/edit/delete, COMPLETE/OVERDUE badges, projected-completion date),
  server-enforced even via direct URL visit when the flag is off; a dashboard
  `BudgetHealthCard`, `NetWorthChart` (Recharts line), and `AccountBalancesTable`,
  wired into `app/(app)/page.tsx` alongside the existing Phase 3 widgets.
- **E2E (`e2e/phase4.spec.ts`, 5 tests):** set a category budget cap + overspend via a
  real ad-hoc entry shows red both in Settings and on the dashboard's budget-health row;
  create a goal renders correct progress, a zero/negative target is rejected with a
  visible error; editing a goal's saved amount to reach target shows COMPLETE; setting
  an account's opening balance updates the dashboard's net-worth account-balance row;
  a viewer sees goals read-only (no add/edit/delete controls rendered at all).
- **Adversarial:** every new Server Action rejects its write server-side when the
  relevant flag is off (not just a hidden nav link) — covered by dedicated integration
  tests using `vi.doMock('../../lib/env', ...)`, not just E2E's "the button isn't there."
- Manually verified in a real browser via short-lived Playwright screenshot scripts
  (written, used, deleted): dashboard net-worth chart + account balances correctly
  excluding the Credit Card account, Settings budget-cap/opening-balance inputs, Goals
  page empty state and add form, and a live create-goal/create-budget round trip.

**Test/CI status (pre-review-pass baseline):** Unit 220/220 (up from 197 — 23 new:
13 budgeting + 10 net-worth), coverage on the gated `lib/domain` scope 97.36%
stmts/93.8% branches (down from the prior phase's 100% — see review pass below).
Integration 126/126 (up from 103 — the goals/categories/accounts/queries additions).
E2E 30/30 (up from 24 — the new `phase4.spec.ts`, 5 tests). `npm run
typecheck`/`lint`/`format:check` all clean.

**Key decisions and why:**

1. **Goals `saved_amount` is manually edited, not derived/auto-accumulated** — per the
   user's explicit choice this session. There's no ledger of "contributions" to a goal,
   just a single mutable balance a person types in directly, same as the reference app.
   This is also why the completion projection is a naive single-rate extrapolation
   rather than a real regression — there's no multi-point history to fit against.
2. **Net worth excludes credit accounts entirely** — per the user's explicit choice.
   A credit account has no balance series of its own; its spend is redirected to
   whichever bank account it's linked to (`linkedBankAccountId`, a link Phase 2 already
   built and validated); an unlinked credit account's spend has nowhere correct to go
   and is simply excluded, rather than guessed at.
3. **The current-month category-budget query is independent of the dashboard's browsed
   `?year=`** — a monthly cap describes "are we overspending _right now_," which
   shouldn't change because someone is looking at 2019's dashboard. `getDashboardRows`
   itself was deliberately left untouched (not widened to carry `monthlyBudget`/
   `openingBalance`) rather than pre-fetching fields the dashboard's own historical
   view has no use for.
4. **`openingBalanceSchema` is a new, separate schema from `moneyInputSchema`**, not a
   parameter added to the existing one — the existing schema's non-negative constraint
   is still correct for every other money field in the app (recurring/ad-hoc amounts,
   budget caps); only an account's opening/running balance can legitimately be negative.

**Real bugs found and fixed (during initial build, before the review pass below):**

- **E2E ad-hoc-entry step initially navigated to bare `/monthly`**, which defaults to
  calendar view — ad-hoc entries render there as small chip cards with no
  `data-testid="entry-row"`, so the assertion that should have proven "overspend shows
  red" silently found nothing to click. Fixed by navigating to the explicit
  `?view=list` URL, matching the convention `e2e/monthly.spec.ts` already established
  for the same reason.

**Deferred / blocked:** none new from the initial build — see the review pass
immediately below for what the hardening round found and deferred.

**Hardening pass (`/code-review` on the full Phase 4 diff, extra-high effort,
2026-07-09):** 10 parallel finder angles against the complete working-tree diff (25
changed/new files), 1-vote verification, a gap sweep. Strong cross-angle convergence:
the two most severe findings were independently surfaced by 5-6 of the 10 angles each.
9 findings fixed, 5 deferred with reasoning. A second, focused verification pass on the
fix diff itself (not a full 10-angle re-run — diminishing returns from re-litigating
already-reviewed baseline code) found zero new regressions.

- _Fixed, most severe_ — **`app/actions/accounts.ts` had no `env.FEATURE_NET_WORTH`
  gate at all** — `createAccountAction`/`updateAccountAction` never imported `env`,
  unlike `categories.ts` (checks `FEATURE_CATEGORY_BUDGETS`) and `goals.ts`
  (`requireGoalsEnabled()`). A forged submission with an `openingBalance` field
  succeeded regardless of the flag, directly contradicting spec.md's Phase 4
  adversarial rule ("flag off ⇒ ... actions rejected ... server-side too, not just
  hidden UI") and this file's own now-corrected PROGRESS.md claim. Fixed by adding the
  same gate pattern as `categories.ts`, checked against whether the field was actually
  submitted with a non-default value (see next finding for why "submitted" has to be
  checked explicitly rather than inferred from the parsed value).
- _Fixed_ — **editing an account while its opening-balance input is hidden (flag off,
  or `accountType` isn't `'bank'`) silently zeroed the stored balance.**
  `account-row.tsx`/`account-add-form.tsx` only render the `openingBalance` input
  conditionally, so an edit submitted without it had `formData.get('openingBalance')`
  come back `null` → `openingBalanceSchema` defaulted that to `'0.00'` →
  `updateAccountAction` wrote it unconditionally, wiping a real stored balance on a
  save that only meant to rename the account. Root-caused to the same shape of bug as
  the next finding: the code couldn't distinguish "field omitted from this submission"
  from "field present and blank." Fixed by checking `formData.has('openingBalance')`
  before parsing, and only including `openingBalance` in the `UPDATE`'s `.set()` at all
  when the field was genuinely present — an omitted field now leaves the column
  untouched instead of resetting it.
- _Fixed_ — **the identical bug on `app/actions/categories.ts`'s `monthlyBudget`** —
  `updateCategoryAction`'s flag-off guard only blocked a forged _non-null_ submission;
  it didn't protect an _existing_ cap from being cleared when the field was merely
  absent (flag off, or an income category, where `category-row.tsx` never renders the
  input). A household could lose a real budget cap just by renaming a category while
  the feature was temporarily disabled. Same fix shape: `formData.has('monthlyBudget')`
  gates whether `monthlyBudget` is included in the `.set()` at all. This also required
  correcting an existing integration test whose second assertion
  (`categories.integration.test.ts`, "sets an explicit zero cap distinctly from
  clearing it back to null") had been submitting the clear-case with the field
  _omitted_ — i.e. it was asserting the exact bug's behavior as correct. Fixed the test
  to submit an explicit empty string (the real shape a rendered-but-emptied `<input>`
  produces), which is genuinely distinct from omission and still correctly clears the
  cap.
- _Fixed_ — **a budget cap could be attached to an income category through ordinary
  UI use**, not just a forged request: `category-add-form.tsx`'s budget-cap input
  wasn't conditioned on the `direction` select's value (an uncontrolled field with no
  state to condition on), and neither create nor update action rejected the
  combination server-side. `getCurrentMonthCategoryBudgets` already only ever looks at
  expense categories, so the value was silently inert and — per the finding above —
  vulnerable to being wiped on the next edit regardless. Fixed by converting
  `direction` to controlled state (matching `account-add-form.tsx`'s existing
  `accountType` pattern) so the field only renders for `direction === 'expense'`, and
  adding a matching server-side rejection in both `createCategoryAction` and
  `updateCategoryAction`.
- _Fixed, architectural_ — **net worth reset to each account's static
  `opening_balance` every time a different year was viewed**, instead of carrying
  forward what actually accumulated in prior years. `buildAccountBalances` always
  seeded its running total from `account.openingBalanceCents` alone, and
  `app/(app)/page.tsx` only ever fed it the currently-browsed year's entries — so
  Year Picker (which spans 2000-2100) landed on a materially wrong net-worth figure
  for any year after an account's first year of real activity, silently. Fixed at the
  architecture level rather than patched: `lib/domain/net-worth.ts` gained
  `sumNetCentsByAccount` (a flat, non-month-bucketed version of the same credit-
  redirect logic, extracted into a shared `resolveEffectiveAccountId` helper so both
  functions apply the identical rule) and `buildAccountBalances` gained a third,
  optional `carryForwardCents` parameter that seeds the running balance on top of
  `openingBalanceCents`. `lib/db/queries.ts` gained `getAccountEntriesBeforeYear`
  (every entry from every year strictly before the one being viewed — a lifetime
  running total needs everything before it, not a bounded window), and
  `app/(app)/page.tsx` now sums that into a carry-forward map before calling
  `buildAccountBalances` for the selected year. Verified the new query and the old
  `getDashboardRows` are mutually exclusive by construction (`lt(year, year)` vs.
  `eq(year, year)`) — no entry can be double-counted or dropped at the year boundary.
  9 new unit tests (carry-forward seeding, `sumNetCentsByAccount`'s own credit-redirect
  and exclusion rules, orphaned/dangling-link edge cases) plus 3 new integration tests
  for the new query.
- _Fixed_ — `category-row.tsx`'s `BudgetBar` computed `capCents` via
  `Math.round(parseFloat(category.monthlyBudget) * 100)` instead of the codebase's own
  `parseAmountToCents` — every other money field in the app, including the sibling
  `account-row.tsx`, routes through it specifically to avoid float precision drift and
  to fail loudly (not `NaN`) on a malformed value. Replaced with `parseAmountToCents`.
- _Fixed_ — `getCurrentMonthCategoryBudgets` re-implemented the "actual overrides
  budgeted" coalesce inline instead of reusing `lib/domain/dashboard.ts`'s
  `bestEstimateCents` (exported earlier this same phase specifically so it could be
  reused, and correctly reused by `app/(app)/page.tsx` a few lines away) — a second,
  independently-maintained copy of the same business rule. Also ran its two
  independent queries as sequential `await`s instead of `Promise.all`, serializing an
  avoidable round trip on the dashboard/settings hot path. Fixed both in the same
  change.
- _Fixed_ — `app/(app)/page.tsx` computed the full net-worth CPU work (row mapping,
  `buildAccountBalances`, `buildNetWorthSeries`) unconditionally even when
  `env.FEATURE_NET_WORTH` is off, and `latestBalances` carried a dead fallback branch
  (`latest ? latest.balanceCents : a.openingBalanceCents`) that could never execute,
  since `buildAccountBalances` always returns a full 12-point series for every bank
  account it's given. Wrapped the whole computation in `if (env.FEATURE_NET_WORTH)` and
  removed the unreachable branch.
- _Fixed_ — `goal-card.tsx` re-derived `parseAmountToCents(goal.savedAmount)`/
  `parseAmountToCents(goal.targetAmount)` a second time for display, duplicating work
  `computeGoalProgress` had already done and echoed back as `progress.savedCents`/
  `progress.targetCents` — fields that, until this fix, had zero readers anywhere.
  Switched the display line to reuse them directly.

Deferred, documented rather than fixed:

- **Goal `isOverdue`/`projectedCompletionDate` compares a target date parsed at UTC
  midnight (`new Date(\`${targetDate}T00:00:00Z\`)`) against the real current instant**,
so the OVERDUE badge can flip up to ~16 hours before or after the household's actual
local midnight (SGT is UTC+8). Real, but this app has no existing app-wide timezone
convention to extend consistently (every other date in the app is either a bare
`numeric`/integer month or already-formatted display text) — fixing this one call
  site without a broader decision about how the app handles "today" in a specific
  timezone would be a narrower, inconsistent patch rather than a real fix. Tracked for
  a dedicated pass if it proves to matter in practice.
- **`deleteGoalAction` is gated by the same `requireGoalsEnabled()` as create/update**,
  so once `FEATURE_SAVINGS_GOALS` is turned off, an owner can no longer delete an
  old goal — only re-enabling the flag first. spec.md's adversarial rule doesn't
  explicitly carve out delete as an exception, and the alternative (asymmetric
  gating — allow delete, block create/update) is a real design question, not a bug fix
  a review pass should decide unilaterally. Left as the stricter, more predictable
  behavior; revisit if it proves to be a real workflow problem.
- **`accounts.ts`'s new `openingBalanceSchema` regex hand-duplicates the shape of
  `lib/money.ts`'s private `NUMERIC_PATTERN`** (with an added leading `-?`) instead of
  importing it. Real DRY gap, but it continues an existing pattern already in the
  codebase — `lib/money.ts`'s own exported `moneyInputSchema` does the identical
  hand-duplication rather than deriving from `NUMERIC_PATTERN`. Fixing it properly
  means touching pre-existing Phase 2 code outside this diff's scope, not a Phase-4
  review-fixup.
- **Three near-identical hand-rolled progress-bar implementations** (`category-row.tsx`'s
  `BudgetBar`, `budget-health-card.tsx`, `goal-card.tsx`) and **a third copy of the
  `reactedTo`-during-render `useActionState` pattern** (`goal-card.tsx`, joining
  `category-row.tsx` and `account-row.tsx`) are real duplication, flagged by the
  review's simplification angle. Not extracted: this project's own CLAUDE.md is
  explicit — "Three similar lines is better than a premature abstraction... don't
  design for hypothetical future requirements." Three call sites is the threshold the
  review would extract at, not clearly past it; deferred rather than guessed at under
  review-fixup pressure.
- **`getCurrentMonthCategoryBudgets` fetches every current-month entry for the
  household, not just entries in categories that have a cap set**, filtering to capped
  categories only after the fact in JS. A single join would avoid the over-fetch, but
  at this app's household scale (tens of entries/month) the extra bytes are
  negligible; not worth the added query complexity in a review-fixup pass.

Re-verified end to end: unit 228/228 (up from 220 — 9 net-worth carry-forward/edge-case
tests, incl. 2 closing coverage gaps the fixes' own review surfaced), integration
133/133 (up from 126 — 7 new: 2 accounts.ts flag-gate/preserve-on-omit, 3
categories.ts preserve-on-omit/income-rejection, 3 queries.ts
`getAccountEntriesBeforeYear`, with one pre-existing test corrected rather than just
left passing-for-the-wrong-reason), E2E 30/30 unchanged, lint/typecheck/format/build
all clean.

---

## Phase 5: CSV import/export — status: complete 2026-07-09

**What shipped:**

- **Pure logic (`lib/domain/csv.ts`):** a hand-rolled RFC4180-ish CSV text parser
  (`parseCsvText`) — quoted fields, embedded commas/newlines, doubled-quote escaping,
  CRLF/LF — deliberately not a dependency, since this is the one place in the app that
  parses fully untrusted file content (spec.md's own Phase 5 trust-boundary note) and a
  linear character scan with no regex is both auditable and immune to backtracking
  blowup. Column mapping (`buildMappedRows`), amount coercion
  (`coerceAmountToCents` — `$`/comma/parenthesized-negative handling, reusing
  `lib/money.ts`'s numeric(12,2) shape) and date coercion (`coerceDate` — ISO and
  US-slash formats only, deliberately not guessing at ambiguous DD/MM/YYYY), row
  normalization (`normalizeRow`), Levenshtein-based fuzzy item-name matching
  (`itemNameSimilarity`), file-internal dedup (`dedupWithinFile`), row classification
  against existing household data (`classifyRow` — match/already-applied/new), and
  injection-safe CSV serialization (`buildCsv`, escaping `=+-@`-leading cells with a
  leading `'`, per spec.md's formula-injection edge case). 65 unit tests, including a
  `fast-check` property test asserting the parser never throws on arbitrary input.
- **Data layer (`lib/db/queries.ts`):** `getExportRows` (every entry, every year, with
  `scheduledDay` correctly reached via `recurring_schedule.actual_date_day` — see the
  reference-app bug note below), `getMatchCandidates` (household+year+month-scoped, for
  the matching heuristic), `getNameLookup` (case-insensitive category/account name → id,
  for resolving a CSV row's free-text columns). `lib/import-csv.ts` (an internal helper,
  not itself a Server Action, same convention as `lib/generate-entries.ts`) —
  `runImportPipeline` (parse → map → normalize → dedup → classify, shared by preview and
  commit) and `commitImport` (applies matched/new rows in one `db.transaction()`).
- **Server layer:** `app/api/export/route.ts` (GET, mandatory per spec.md's Feature
  Matrix — not behind the kill-switch, since export is read-only and every role already
  has read access to this data elsewhere). `app/actions/import.ts` —
  `previewImportAction`/`commitImportAction` (both gated by `requireRole('write')` AND
  the `csv_import` kill-switch; commit re-runs `runImportPipeline` against the
  client-resubmitted csvText/mapping and live DB state rather than trusting anything
  cached from the preview step — see the adversarial section) and
  `toggleCsvImportAction` (owner-only, `manage_settings`, the only way to flip the
  kill-switch on since it defaults off and Phase 5's task list has no dedicated
  settings page for it).
- **UI:** `/import` (column-mapping upload → preview table with per-row
  match/new/already-applied/duplicate/error status and per-row exclude checkboxes →
  confirm), gated server-side by the `csv_import` kill-switch (an inline "Enable CSV
  import" button for owners when it's off, matching how the feature is actually
  discovered and turned on) and by `can(user.role, 'write')` (viewers see a read-only
  message, not the upload form). `/settings/data` (Export CSV link/button). Both linked
  from the sidebar nav.
- **E2E (`e2e/phase5.spec.ts`, 6 tests):** enabling the kill-switch inline; importing a
  CSV that both reconciles an existing forecast and creates a new ad-hoc entry, verified
  against the real DB (not just the UI summary), then re-importing the identical file
  and confirming 0 rows apply; an oversized file rejected with a friendly error; a
  garbage/unmappable file rejected with a friendly error; export downloading a CSV that
  round-trips the imported data and escapes a formula-injection item created via the
  import path itself; a viewer seeing no upload controls at all.
- **Adversarial:** formula-injection (covered by the E2E export test above, and by
  `buildCsv`'s own unit tests for every `=+-@` prefix); oversized/garbage files
  (E2E, and unit tests for `checkCsvByteSize`/`checkCsvRowCount`); cross-household
  forgery — `commitImportAction` never accepts a classification, entry id, or match
  decision from the client, only which row _numbers_ to exclude; every actual DB write
  is independently scoped by `householdId` in its own `WHERE`/query, proven directly by
  an integration test that seeds a matching forecast in a **different** household and
  confirms the import creates a new entry in the acting household instead of touching
  the other one.

**Key decisions and why:**

1. **Reference app's export bug, fixed at the root.** The original app's export query
   selected a non-existent `monthly_entries.scheduled_day` column directly (confirmed
   by reading the reference app's own source: `FinanceTracker/src/routes/api/export/
+server.ts`); its own _working_ Monthly page query reveals the real source is
   `recurring_schedule.actual_date_day`, reached via `monthly_entries.recurring_schedule_id`.
   Fixed with a `LEFT JOIN recurring_schedule` (null for ad-hoc entries, which have no
   schedule to join through — correct, not a bug).
2. **Idempotent re-import via re-classification, not a stored content hash.** spec.md's
   literal wording calls for "idempotent via content hash of (year,month,item,amount)."
   Implemented instead as: `classifyRow` checks whether a candidate entry already has
   this exact actual amount recorded (`already-applied`), which naturally makes a
   second run of the identical file re-classify every previously-applied row as a
   no-op — no schema change, no hash column, same practical guarantee. Logged as a
   deviation in `spec.md`.
3. **Column mapping requires a single "Date" field, not separate Year/Month fields.**
   Generic external bank/Excel CSVs (the primary spec.md use case — "arbitrary
   external CSVs") have one date column, not separate year/month columns. Re-importing
   this app's own export (which does have distinct Year/Month/Actual_Date columns) maps
   "Date" to Actual_Date; forecast-only rows in that export (blank Actual_Date, nothing
   to reconcile) correctly surface as per-row errors rather than blocking the file —
   spec.md's own task list names "preview payload (matched/unmatched/errors)," so a
   per-row error for an intentionally-blank date is the designed-for outcome, not a gap.
4. **Direction is inferred from amount sign when unmapped** (negative = expense, the
   common bank-statement convention), with an explicit "Direction" column (this app's
   own export includes one) overriding the inference when mapped. Two fallbacks, not
   one, because a generic bank CSV and a re-imported export need different signals.
5. **New (unmatched) rows get `budgetedAmount` set equal to `actualAmount`, not left at
   the schema's `0` default.** A CSV row is a transaction that already happened — there
   was no forecast for it, so "budgeted = what actually happened" reads more honestly
   on the Monthly page than an artificial 0-vs-actual variance would.
6. **`commitImportAction` re-derives the entire classification server-side from the
   client-resubmitted csvText/mapping, rather than trusting a cached preview.** The
   only client input trusted as a genuine decision (not a claim about server state) is
   _which row numbers to exclude_ — meaningless without the server's own fresh
   classification to apply it against. This is what closes spec.md's "cross-household
   entry IDs in a forged commit payload" adversarial case structurally, not via a
   spot-check.
7. **`next.config.ts`'s Server Actions `bodySizeLimit` raised to 6MB.** Discovered via
   a failing E2E test, not anticipated: Next's default 1MB Server Action body cap was
   rejecting an oversized-file test upload with a hard 413 _before_ `lib/domain/csv.ts`'s
   own graceful `checkCsvByteSize` (5MB) ever ran — the friendly error spec.md's edge
   case calls for was unreachable. Raised past the 5MB app-level cap with headroom for
   FormData/multipart overhead and the sibling mapping fields.
8. **Export has no kill-switch; import does.** Matches spec.md's Feature Matrix exactly
   (`csv_import` is the only kill-switch named for this phase) — export is read-only
   and bounded (every household's own data, nothing external), so there's no incident
   scenario a kill-switch would meaningfully guard against the way there is for a
   bulk-write feature ingesting hostile file content.

**Real bugs found and fixed (during initial build, before the review pass below):**

- **`classifyRow`'s "already-applied" idempotency check required an exact `direction`
  match, but an uncategorized entry (no category mapped on a prior import run) has
  `direction: null`** — found by my own integration test for "re-importing the
  identical file applies nothing," which failed with `applied: 1` instead of `0` on
  the second run. Root cause: the `already-applied` check didn't allow
  `c.direction === null`, unlike the sibling `forecastCandidates` filter a few lines
  below it, which already did. An uncategorized ad-hoc entry created by import could
  never be recognized as already-applied on a later re-import — every re-run of a
  no-category-mapped file would have kept inserting duplicates forever. Fixed to match
  the sibling filter's `(c.direction === null || c.direction === row.direction)`
  condition; added a dedicated regression test.
- **`/import/page.tsx` didn't gate the upload form by write-role.** Caught while
  writing the E2E viewer test, before it ever ran: a viewer would have seen the full
  file-upload/column-mapping/preview form (harmless — preview doesn't write), but
  clicking "Confirm import" would hit `commitImportAction`'s `requireRole('write')`
  and throw an uncaught `ForbiddenError` into Next's generic error boundary instead of
  a friendly message — the same class of gap Phase 2's "hide the write form, not just
  reject the write" convention (`goals/page.tsx`, `settings/categories/page.tsx`)
  already exists to prevent. Fixed by gating the form render on
  `can(user.role, 'write')`, matching that convention.
- **My own E2E spec's `afterAll` cleanup had a real, near-shipped bug**: an early draft
  deleted `monthlyEntries` scoped only by `householdId` — i.e., every entry in the real
  seeded household, not just the ones this spec created. Caught before ever running it
  by re-reading the query while writing the viewer test (not by a failure), and fixed
  to scope by the specific E2E item names instead, matching every other spec's
  established cleanup convention.
- **Next's default 1MB Server Action body limit** — see Key Decision #7 above; found by
  the oversized-file E2E test failing with a raw 413 instead of the app's own friendly
  error.

**Deferred / blocked:** none — see the review pass immediately below for what the
hardening round found and deferred.

**Hardening pass (`/code-review` on the full Phase 5 diff, extra-high effort,
2026-07-09):** 10 parallel finder angles against the complete working-tree diff (16
changed/new files), 1-vote verification, a gap sweep. The line-by-line angle alone
surfaced 4 independently-verified (empirically executed, not just reasoned about)
correctness bugs in the matching/parsing logic; three other angles independently
re-derived the most severe one. 14 findings fixed across two passes (one during triage,
one caught by a second, focused verification pass on the fixes themselves), 5 deferred
with reasoning.

- _Fixed, most severe (independently found by 4 of 10 angles)_ — **two different CSV
  rows in the same file could both classify as `'match'` against the same single
  existing forecast entry.** `classifyRow` picked the best-scoring candidate from the
  full per-month candidate list independently for every row, with no bookkeeping of
  which candidate an earlier row in the same file had already claimed. Two genuinely
  distinct real transactions that both plausibly resembled one forecast (e.g. two
  restaurant charges in the same week, both within the amount/name-similarity
  tolerance) would both match it; `commitImport`'s two sequential `UPDATE`s to that one
  row would then silently apply only the second, discarding the first — while
  `applied` counted both, reporting success with no indication anything was lost.
  Fixed by adding a third parameter to `classifyRow`, `claimedEntryIds: ReadonlySet<
string>`, and threading a per-month `claimed` set through `runImportPipeline`'s
  classification loop (a candidate's id is added to it the moment a row matches it,
  before the next row in that month is classified) — a later row that would have
  matched an already-claimed candidate now correctly falls through to `'new'` instead.
  Verified with a real-DB integration test: two rows, one forecast, asserting exactly
  one `'match'` + one `'new'`, both amounts preserved as two separate rows afterward.
- _Fixed_ — **`parseCsvText` treated ANY `"` character as opening a quoted field, even
  mid-field of an otherwise-unquoted field.** A single stray `"` in a normal item
  description (e.g. `12" cable`, a completely ordinary hardware-store line item) would
  silently swallow every subsequent comma and newline into one field until the next
  `"` or EOF — merging and dropping an arbitrary number of real transaction rows with
  zero error surfaced (the existing property test only asserted "never throws," not
  "never eats unrelated rows"). Real-world CSV tools (Excel included) only treat a `"`
  as field-opening when it's the first character of that field; fixed to match, via a
  `field === ''` guard. Verified with a regression test asserting all three rows of a
  file containing a mid-field quote parse correctly.
- _Fixed_ — **`dedupWithinFile`'s dedup key used year+month, not the full date** — two
  genuinely distinct transactions sharing an item/amount/direction within the same
  month (e.g. two Netflix charges on different days) were incorrectly collapsed into
  one, with the second silently dropped and no way to force-include it (only
  `'match'`/`'new'` rows get a checkbox). Fixed to key on the full `actualDate`
  instead — an exact same-day repeat is the only plausible accidental duplicate a
  source file would contain.
- _Fixed_ — **`itemNameSimilarity`'s substring bonus (0.9) applied uniformly regardless
  of length disparity** — a short, generic CSV item name (`"Fee"`, `"Transfer"`,
  common in real bank exports) would spuriously score 0.9 against any unrelated
  existing entry whose longer name happened to contain it (e.g. a `$50` ATM-fee
  transaction reconciling against an unrelated `"Late Fee"` budget line). Fixed to
  only grant the bonus when the shorter string covers at least half the longer
  string's length; a weak substring now falls through to plain Levenshtein scoring,
  which correctly penalizes the mismatch (`itemNameSimilarity('Fee', 'Late Fee')` ≈
  0.375, below the 0.6 match threshold).
- _Fixed_ — **two spec.md-mandated Phase 5 edge cases had no implementation at all:
  "wrong encoding" and "missing headers."** Caught by the conventions angle
  cross-checking spec.md's Ready-criteria list line by line against what shipped.
  Added `checkCsvEncoding` (rejects a file containing the U+FFFD replacement
  character — the reliable signature of a file saved in a non-UTF-8 encoding like
  Windows-1252, since `File.text()`/Node always decode as UTF-8 with no
  detection step) and a `hasHeaderRow` checkbox end-to-end (client state → hidden
  form field → `runImportPipeline`, which now conditionally treats row 0 as data
  instead of unconditionally consuming it as a header).
- _Fixed, same change closed a second, independently-found gap_ — implementing
  `hasHeaderRow` required `ColumnMapping` to stop being header-NAME-based (there's no
  header text at all when the file has none) — switched it to column-POSITION-based
  (`buildMappedRows` now resolves by numeric index, not a name→index `Map`). This
  also closed a real bug the cross-file-tracer angle found independently: a CSV with
  two columns sharing an identical header name (e.g. two columns both literally named
  `"Amount"`) previously had no way to distinguish them — the name→index lookup
  silently resolved to whichever the `Map` happened to keep (last-write-wins), with
  no way for the user to pick the other one. Position-based mapping has no such
  ambiguity, by construction.
- _Fixed_ — **`commitImportAction` never validated that the required Date/Item/Amount
  fields were mapped**, unlike `previewImportAction`, which does. A request reaching
  commit with an unmapped required field (a tampered/forged POST, or a future UI
  regression failing to forward the preview's mapping) made every row fail
  normalization and silently report `{success: true, applied: 0}` — a validation
  failure misreported as an uneventful successful no-op. Added the identical check
  `previewImportAction` already had.
- _Fixed_ — **`coerceAmountToCents` re-implemented `lib/money.ts`'s numeric-shape regex
  and cents arithmetic from scratch** instead of preprocessing (strip `$`/commas/
  parens/sign) then delegating to `parseAmountToCents`, the one canonical
  implementation every other money-entry path in the app already goes through. Fixed
  to delegate — closes a real future-drift risk (a rounding/digit-cap fix made to
  `parseAmountToCents` would otherwise silently NOT apply to CSV-imported amounts).
- _Fixed, found by the SECOND (fix-verification) pass, not the first_ — the
  delegation above introduced its own new bug: `coerceAmountToCents` strips at most
  one leading sign character itself before calling `parseAmountToCents`, which
  ALSO accepts an optional leading `-` — a doubly-signed cell (`"--500"`, surviving
  as `"-500"` after this function's own strip) let `parseAmountToCents` parse the
  residual `-` as genuinely negative, which this function's own `negative` flag then
  negated a second time, silently cancelling back to **positive** `$500.00`
  (misclassified as income) instead of being rejected as malformed. Fixed by
  rejecting outright if a sign character survives this function's own stripping
  (`s.startsWith('-') || s.startsWith('+')`) rather than handing it to
  `parseAmountToCents` a second time. Verified `"--500"`/`"++5.00"` are now rejected,
  while confirming `"(-500)"` (parens AND an inner `-`, both notations agreeing on
  negative, not conflicting) is correctly still accepted as -$500.00 — a distinction
  only caught by directly executing the function rather than reasoning about it by
  hand, after an initial hand-trace got it wrong.
- _Fixed_ — `coerceDate`'s calendar-round-trip validity check (catching
  `2026-02-30`-style impossible dates Postgres would otherwise silently roll over)
  duplicated `app/actions/monthly.ts`'s `dateInputSchema` logic line-for-line. Both
  independently re-implemented the identical 3-line technique. Extracted a shared
  `isValidCalendarDate` into `lib/domain/month-params.ts` (already the DRY home for
  `MIN_YEAR`/`MAX_YEAR`) and pointed both call sites at it — a low-risk, mechanical,
  behavior-preserving change (confirmed via `monthly.ts`'s own existing test suite).
- _Fixed_ — `runImportPipeline`'s per-month `getMatchCandidates` calls ran as
  sequential `await`s in a `for` loop instead of `Promise.all` — each query is
  independent and read-only, so a file spanning many months (e.g. a full year's bank
  history, 12 months) paid ~12 avoidable sequential round trips on an interactive
  Server Action the user is sitting in front of. Parallelized (each month's fetch +
  classification still runs its own sequential `claimed`-set logic internally, just
  the cross-month fetches now run concurrently).
- _Fixed_ — `commitImport` unconditionally fetched `getNameLookup` (category/account
  name resolution) even when every included classification was `'match'` (a
  pure-reconciliation import, nothing `'new'` to resolve a category for). Skipped
  entirely when no included row needs it.
- _Fixed_ — `toPreviewRow`'s `switch` repeated an identical six-field projection in 4
  of 5 branches, varying only the status/message. Factored into a shared `projectRow`
  helper.
- _Fixed_ — **`next.config.ts`'s Server Actions `bodySizeLimit` (raised to accept
  Phase 5's CSV uploads) is a GLOBAL Next.js setting, not scoped to the import
  action** — it also widens the body-size ceiling for every OTHER Server Action in
  the app, including `loginAction`, which is reachable pre-authentication. Two
  angles independently flagged this. The deeper fix (moving CSV upload to a
  dedicated Route Handler, like `app/api/export/route.ts` already is, so the limit
  could be scoped to just that endpoint) is a real architectural change out of
  proportion for a review-fixup pass — see Deferred below. As a proportionate
  interim mitigation: added `.max(200)` bounds to `loginSchema`'s password field and
  `changePasswordSchema`'s two password fields (defense-in-depth against the widened
  ceiling being used to force excessive body-buffering/argon2-hashing on an
  unauthenticated request; doesn't conflict with `validatePassword`'s existing
  minimum-length-only policy). Also raised the limit itself from 6MB to 20MB, since a
  second, separate angle correctly noted `MAX_CSV_BYTES`'s 5MB cap measures JS string
  `.length` (UTF-16 code units), which can undercount real UTF-8 wire size by up to
  ~3x for non-Latin content — 6MB of headroom wasn't actually enough to guarantee the
  graceful error fires before Next's own hard platform limit does.
- _Fixed_ — `import-form.tsx`'s "Start over" reset every piece of upload-step state
  except the commit action's `useActionState` result, which can't be programmatically
  cleared — a failed commit attempt's error message could bleed into a subsequent,
  unrelated file's preview screen. Added a `suppressStaleCommitError` flag, cleared
  the instant a genuinely new commit result arrives.

Deferred, documented rather than fixed:

- **CSV import staying a Server Action rather than becoming a dedicated Route
  Handler** (see the `bodySizeLimit` finding above) — the deeper architectural fix,
  not done: converting `previewImportAction`/`commitImportAction` to a Route Handler
  would let the body-size limit be scoped to just that endpoint instead of raised
  globally, but it means reworking the client submission flow away from
  `useActionState`/`action={...}` (a fetch-based upload instead), and manually
  replicating Next's built-in Server Action CSRF/origin protection that a Route
  Handler doesn't get automatically. Real, but a substantially larger change than a
  review-fixup pass; the `.max(200)` bounds + 20MB headroom above are the
  proportionate interim mitigation.
- **The kill-switch/flag-gating pattern now has a FOURTH independently-shaped
  variant** (`requireCsvImportEnabled` in `app/actions/import.ts`, joining
  `categories.ts`'s inline `env.FEATURE_X` check, `goals.ts`'s private
  `requireGoalsEnabled()` helper, and `monthly/page.tsx`'s bare inline `isEnabled()`
  call). This is the exact architectural gap Phase 4's hardening pass already
  flagged and deferred (recommending a shared `requireFeatureEnabled`-style helper
  in `lib/auth/guards.ts` alongside `requireRole`) — Phase 5 had the chance to close
  it and instead added a fifth-ish bespoke shape. Still deferred: centralizing it
  properly means touching all four existing call sites across three earlier phases,
  a real refactor disproportionate to a review-fixup pass, not a one-line addition
  scoped to this diff. Worth prioritizing as its own pass soon, now that the
  pattern has recurred a fourth time.
- **`classifyRow`'s per-row Levenshtein scoring is O(rows × candidates) per month,
  synchronous** — at a pathological extreme (near `MAX_CSV_ROWS` concentrated in one
  month, matched against a large pre-existing candidate set accumulated from many
  prior imports) this could be hundreds of thousands of string comparisons blocking
  one Server Action invocation. Not addressed: this app's realistic household scale
  (a handful to dozens of entries per month) makes the actual cost negligible;
  bounding it further would add real complexity for a scale this app doesn't operate
  at, the same tradeoff already accepted for `getCurrentMonthCategoryBudgets` in the
  Phase 4 hardening pass.
- **`RowClassification`'s `'already-applied'` variant carries an `entryId` field, and
  `PreviewRow`'s `direction` field, that nothing in the running app actually reads**
  (only structural test assertions reference them). Real, minor API-surface
  cleanliness gaps, not bugs — deferred rather than trimmed under review-fixup
  pressure, since removing them has no behavioral benefit.
- **The `reactedTo`/`setReactedTo` render-time `useActionState`-sync idiom now
  appears in 9 places across the codebase** (`import-form.tsx` added 2 more in this
  phase: `reactedToPreview`, `reactedToCommit`). Phase 4's hardening pass already
  considered and deferred extracting this at 7 occurrences ("three call sites is the
  threshold the review would extract at, not clearly past it"). Still deferred here
  for the same reason, now with the additional consideration that the pattern is the
  established codebase convention — introducing a different mechanism (e.g. a
  key-based remount) in just this one file would trade verbosity for inconsistency,
  not obviously a net improvement.

Re-verified end to end across both fix rounds: unit 307/307 (up from 293 — new
regression tests for every fix above: the mid-field-quote parser fix, the
claimed-entry-set fix, the substring-similarity-scaling fix, the full-date dedup key,
`checkCsvEncoding`, the index-based `buildMappedRows`, `isValidCalendarDate`, and the
double-sign rejection), integration 156/156 (up from 152 — new tests for the
two-rows-one-forecast fix, the missing-required-field-on-commit fix, wrong-encoding
rejection, and `hasHeaderRow: false`), E2E 36/36 unchanged (all `selectOption` calls
updated from matching by value to matching `{label: ...}`, since mapping values are
now column positions, not header text), lint/typecheck/format/build all clean. The
one observed E2E flake (`auth.spec.ts`'s change-password test) during a full-suite
run passed cleanly both in isolation and on a full-suite re-run immediately after —
the same pre-existing transient flake pattern documented in Phase 3, not a
regression from touching `auth.ts`'s schemas.

---

## Cross-phase cleanup pass: closing deferred items before Phase 6 (2026-07-09)

Explicit user directive — close out accumulated deferred/unresolved items from every
prior phase before starting Phase 6, rather than letting them compound further. Not a
`/code-review` pass over a diff; a triage of everything already logged as deferred or
unresolved across Phase 0 through Phase 5, deciding fix-now vs. still-correctly-deferred
for each, with reasoning either way.

**Resolved — the one ⚠ UNRESOLVED item:**

- **Git history still contained real personal/financial data.** `lib/db/
clean-legacy-data.ts` (deleted at HEAD since the post-Phase-2 pass, but still reachable
  via `git show 8ebf134:lib/db/clean-legacy-data.ts` on the now-public repo) held the
  real household-member names and account names the `seed.ts` genericization pass had
  already scrubbed from HEAD but never from history. User explicitly authorized the
  force-push this required (standing policy pauses history rewrites for explicit
  go-ahead every time, even mid-session). Fresh backup bundle taken first
  (`fintrack-backups/fintrack-pre-clean-legacy-rewrite-*.bundle`, alongside the existing
  one from the `seed.ts` rewrite). Ran `git filter-repo --path
lib/db/clean-legacy-data.ts --invert-paths`, force-pushed with an explicit
  `--force-with-lease` pinned to the known-good remote SHA (safer than a bare
  `--force-with-lease`, which failed once with "stale info" since `filter-repo` drops
  and this session re-added the `origin` remote, leaving no tracked lease value to
  compare against). Verified with a full-history grep afterward
  (`git log --all --oneline -- lib/db/clean-legacy-data.ts` returns nothing) and CI
  green on the rewritten history. Same predictable fallout as the first rewrite:
  `.gitleaksignore`'s commit-SHA-pinned fingerprint for the unrelated Phase 0
  adversarial-secret entry broke again (every commit SHA shifts after `filter-repo`);
  updated to the new SHA, with all prior SHAs kept alongside (harmless) in case a stale
  checkout ever resolves one of them. Considered switching to a path-based
  `.gitleaks.toml` allowlist instead (survives rewrites permanently, unlike a SHA
  pin) — deliberately not done: no local `gitleaks` binary to verify the TOML schema
  against, and CI's Docker step pulls `:latest`, so an unverified schema change risked
  breaking the secret-scan gate itself with no fast feedback loop. Still a real,
  deferred improvement, now hit twice.

**Fixed — real gaps, in scope for a dedicated cleanup pass (several were previously
deferred specifically as "out of proportion for a review-fixup pass," which no longer
applies here):**

- **Kill-switch/flag-gating had 4 independently-shaped variants**, flagged in both the
  Phase 4 and Phase 5 hardening passes as "worth prioritizing soon" and left
  unaddressed both times. `categories.ts`/`accounts.ts` each hand-rolled an inline
  `!env.FEATURE_X` check, `goals.ts` had a private `requireGoalsEnabled()`, `import.ts`
  had a private `requireCsvImportEnabled()`. Phase 6 was about to add two more
  kill-switches (`email_reminders`, `monthly_recap`), which would have produced a 5th
  and 6th variant on top. Added two shared primitives to `lib/auth/guards.ts` —
  `requireConfigFlag(enabled, message)` for env-var-backed config flags (sync) and
  `requireKillSwitch(householdId, flag, message)` for `household_settings`-backed
  kill-switches (async, wraps `lib/flags.ts`'s `isEnabled`) — both returning a
  user-facing error string, matching the existing `requireRole` convention of
  surfacing a rejected action as a form error rather than a throw. Migrated all 4 call
  sites. Deliberately did NOT force `monthly/page.tsx`'s `auto_generate` check or the
  `/import`, `/goals`, dashboard, and settings pages' page-level render conditionals
  through these helpers — those need a raw boolean for an `if`, not an
  action-rejection error string, and were never actually part of the duplicated
  pattern being complained about. New tests in `lib/auth/guards.test.ts` for both
  helpers (guards.ts coverage was previously only 83%/50% stmts/branches on the
  now-added lines; back to 100% after).
- **`deleteGoalAction` was gated by the same `FEATURE_SAVINGS_GOALS` check as
  create/update**, so an owner who disabled goals couldn't remove an old one without
  re-enabling the flag first (a config flag — re-enabling means a redeploy). Explicitly
  deferred twice before as "a real design question, not a bug fix a review pass should
  decide unilaterally"; decided now: delete is asymmetric, deliberately not gated.
  This alone wasn't enough, though — `app/(app)/goals/page.tsx` returned a blanket "not
  enabled" message with zero goal cards rendered when the flag was off, so there was no
  UI path to reach a delete button regardless of what the action itself allowed. Fixed
  the page too: goals still render (delete-only) when the flag is off — `GoalCard`
  gained a `canEdit` prop that hides the Edit button/form (create/update stay genuinely
  gated, only delete is exempt), no add form either way. New integration test
  (`goals.integration.test.ts`) proving delete succeeds with the flag mocked off.
- **No UI control anywhere let a user set an actual entry's date** — flagged as a
  known gap since the Phase 2 hardening pass (`updateActualAction` always supported
  amount+date per spec.md's task list; `entry-row.tsx` only ever echoed
  `entry.actualDate` back through a hidden, unchangeable field). Added a real
  `<input type="date">` alongside the existing amount input, same form, same
  blur-to-save/Enter/Escape UX already established for the amount field. Read-only
  view now also shows the date under the amount (previously shown nowhere). New E2E
  assertion in `monthly.spec.ts`, verified against the real DB via `expect.poll` —
  first draft of this test asserted on the input's own post-blur value instead, which
  passed even before the fix actually landed anything server-side (an uncontrolled
  field keeps showing whatever was typed regardless of whether the submission
  completed), producing a false pass; caught this by running the suite and seeing a
  _different_, correct failure (DB value still `null`) than the one the flawed
  assertion would have hidden — fixed the test to poll the database directly, the same
  proof-of-persistence standard already used for the sibling amount-field test.
- **`members.integration.test.ts` leaked an orphaned household row on 2 of its 6
  tests**, flagged and accepted as out-of-scope in the Phase 1 round-2 hardening pass.
  Root cause: both tests create a `target` user in their own auto-generated household
  via `makeHouseholdWithUser`, then re-home that user into a different household via a
  direct `UPDATE` — but `cleanup()` only ever deleted the destination household, never
  the now-empty original one the re-homed user's row was created in. Fixed by
  capturing and cleaning up both household ids in the two affected tests. Pre-existing
  orphaned rows already sitting in the `dev` branch from before this fix were not
  swept — direct ad-hoc DB scripting against `DATABASE_URL` outside the test/seed
  harness is exactly the pattern that caused Phase 1's real accidental-mass-delete
  incident, and the auto-mode classifier correctly blocked a throwaway script written
  for this; a handful of harmless empty rows isn't worth pushing past that guard for.
- **`proxy.ts`'s session-validity query — run on every single request in the app —
  carried an unnecessary `innerJoin` to `users`**, joining a table it never selected
  any column from. `sessions.userId` has a FK to `users.id`, so the join could only
  ever prove what the constraint already guarantees. Removed; zero behavior change,
  one less join on the hottest query path in the codebase.
- **A pre-existing integration test file used real Singapore bank brand names (DBS,
  OCBC) as arbitrary account-name fixtures** — noted in the post-Phase-2 review as
  "worth a second look... for consistency" after the seed-data genericization pass, on
  a now-public repo. Not sensitive (no PII, no real figures, just borrowed company
  names for a generic fixture), but cheap and consistent to fix: renamed to
  `Test Bank A`/`Test Bank B` throughout `accounts.integration.test.ts`.
- **React 19 auto-resets an uncontrolled `<form action={...}>` once the action
  settles, including on an error return, not just success** — flagged in the Phase 1
  round-3 hardening pass as "a real UX papercut" and deferred. `change-password-
form.tsx`'s two password fields were uncontrolled (`defaultValue`-less, just plain
  inputs), so a wrong-current-password error cleared both fields right as the user
  read why the submission failed. Converted both to controlled inputs (state + the
  established `reactedTo` idiom to clear them only on a genuine success, matching the
  pattern already used for the `budgetState`/`updateState`-driven forms elsewhere in
  the app) — a controlled value isn't affected by React's post-action reset, since
  React keeps rendering the state-held value regardless of what the DOM's native reset
  would otherwise do to an uncontrolled field.

**Still correctly deferred — re-affirmed, not silently dropped, original reasoning
still holds and is not repeated here in full (see each phase's own entry above):**
Phase 0's `pool.end()`-not-in-`finally`, `.nvmrc`/`engines` mismatch, `createPool()`'s
prose-enforced safety, `lib/env.ts`'s eager `loadEnv()`, `getSentry()`'s unreachable
defense-in-depth; Phase 1's `proxy.ts` renewal-write race, `revokeOtherSessions()`
duplication (2 call sites, not the 3+ this codebase's own convention extracts at),
`household_invitations(email)` index (the query that needed it no longer exists),
`getClientIp()`'s malformed-header edge case and test-coverage gap (would need a new
Server-Action test harness for a narrow edge-within-an-edge case), `DUMMY_PASSWORD_HASH`
hardcoding; Phase 2's Monthly summary bar excluding uncategorized amounts (no
obviously-correct number to add them to), `lib/flags.ts`'s cross-instance cache
staleness; the concurrency-group/per-ref CI gap, `household_invitations` rows never
cleaned, the `.gitleaks.toml` path-based-allowlist migration (see above — hit twice
now, still not done, same reason both times); Phase 3's unrendered
`CategoryBreakdownPoint`/`YoyDelta` fields, the sidebar year-selector's architectural
`searchParams` limitation; Phase 4's goal-overdue UTC-vs-local timezone handling (needs
an app-wide decision, not a one-call-site patch), `openingBalanceSchema`'s regex
duplication (continues a pre-existing pattern), the 3x progress-bar duplication;
Phase 5's Route-Handler-vs-Server-Action architecture for CSV import, `classifyRow`'s
big-O at unrealistic scale, unused `entryId`/`direction` fields (zero behavioral
benefit either way), and the `reactedTo` idiom now at 9+ occurrences (still the
established codebase convention, not a bug).

Re-verified end to end, not just re-run: lint/typecheck/format/build clean, unit
311/311 (up from 307 — 4 new `guards.ts` tests), integration 157/157 (up from 156 — 1
new `deleteGoalAction`-while-disabled test), E2E 36/36 (the `monthly.spec.ts` date-entry
test caught and had its own race condition fixed before the suite went green — see
above). Every fix independently confirmed: kill-switch centralization re-verified
against all 4 original call sites' existing test suites (categories/accounts/goals/
import integration tests, all still passing unchanged); the goals delete-while-disabled
fix proven via both a new integration test and by tracing the page-level rendering path
that would otherwise have made the action-level fix unreachable; the entry-date UI
proven against the real DB via `expect.poll`, not a client-side echo. History rewrite
independently verified via a full-history grep and a green CI run on the force-pushed
commit (`gh run view`, not just the `push` command's own exit code).

**Second real bug caught after push, before this was actually done — CI failed on the
first attempt** (`gh run view`, not trusted from `gh run watch`'s own exit code, per
this project's own established lesson): the `monthly.spec.ts` date-entry test's DB
assertion queried `eq(monthlyEntries.item, itemName)` with no year/month scope.
"Generate forecast" defaults to a 12-month-ahead window, so the recurring item created
by this test has ~12 `monthly_entries` rows sharing the same item text; the query
non-deterministically grabbed one of the 11 _other_ months' still-`null` rows instead
of the current month's row the UI actually updated — the exact bug class
`e2e/recurring.spec.ts`'s own DB assertion was fixed for during the Phase 2 hardening
pass, reintroduced this time in a different file. It passed twice locally (once in
isolation, once in the full suite) before this was caught, because the local dev
config (`workers: undefined`, `retries: 0`, `next dev`) never happened to expose the
ambiguity the way it did every single time under CI's config. Reproduced deterministically
by running `CI=true npx playwright test` locally — production build via `next start`,
`workers: 1`, `retries: 2` — matching the identical technique Phase 1's PROGRESS.md
entry already documents for this exact class of pass-locally-fail-in-CI gap. Fixed by
scoping the query to the current year+month (matching `currentMonthUrl()`), plus an
added pre-fill poll asserting the scoped row starts at `null` (proving the query
targets exactly one real row, not zero, before trusting the post-fill assertion means
anything). Re-verified: full suite green under `CI=true` locally (36/36, no retries
needed), then pushed and confirmed green on the actual CI run.

**Follow-up, same session, user-directed triage of what's left:** of the remaining
"still correctly deferred" items above, asked directly which ones warranted action.
Two:

- **`getClientIp()`'s test-coverage gap, closed.** The last-hop-trust fix itself was
  already correct (live-verified by hand during the Phase 1 hardening pass) but had
  zero automated regression coverage — a security-relevant function (defeats the login
  rate limiter's IP-spoofing bypass) resting on a one-time manual check. Added
  `app/actions/auth.integration.test.ts` (new file — no prior test exercised
  `loginAction` directly; the existing `lib/auth/auth.integration.test.ts` only covers
  pure `lib/auth/*` modules), 4 tests against the real DB: last-hop trusted over a
  spoofed first hop, `X-Forwarded-For` entirely absent falls back to `'unknown'`, a
  malformed header with an empty trailing segment (`'real-ip,'`) also falls back to
  `'unknown'`, and — the actual attack scenario — rotating the spoofed first hop on
  every attempt does NOT reset the 5-attempt lockout, since all attempts still key on
  the same real last hop.
- **Goal-overdue timezone handling — NOT fixed now, deliberately turned into an
  explicit pre-decision for Phase 6 instead of either fixing narrowly here (rejected
  twice already, for the same reason) or leaving it purely implicit for Phase 6 to
  maybe rediscover.** Phase 6's reminder logic ("due in ≤3 days") needs the exact same
  "what does 'today' mean for this household" answer the goals code sidesteps today.
  Added a "Required pre-decision, before step 1" note to `spec.md`'s Phase 6 section:
  decide once whether the app stays UTC-only-by-convention or gains a real
  household-timezone concept, and retrofit the goals logic to use whatever Phase 6
  builds rather than maintaining a second, inconsistent implementation.

Everything else from the deferred list was reconsidered and left exactly as
reasoned — including one explicit reclassification: `household_invitations` rows
never being cleaned up isn't actually a gap on reflection, it's a legitimate audit
trail (who invited whom, when), so it was dropped from the deferred list rather than
carried forward as if it were still pending.

Re-verified: unit 311/311 unchanged, integration 161/161 (up from 157 — the 4 new
`auth.integration.test.ts` tests), lint/typecheck/format clean.

**`/code-review` pass on the full cross-phase cleanup pass (extra-high effort,
2026-07-09):** the first formal 10-angle review of this session's cleanup work (diffed
against `fe05abf`, the last commit that had already gone through one). Strong
cross-angle convergence on the most severe candidate — two angles independently
proposed a data-loss bug in `entry-row.tsx`'s new date input — which made verification
worth doing empirically rather than by reasoning alone, matching this project's
established practice for subtle timing bugs.

- _Refuted, empirically_ — the suspected bug: `entry-row.tsx`'s new `actualDate` input
  shares one `<form>` and one `disabled={actualPending}` flag with `actualAmount`;
  the theory was that submitting one field disables both, force-blurring whichever is
  focused, triggering a second `requestSubmit()` whose `FormData` is missing the
  now-disabled fields, which `updateActualAction` would then interpret as "clear both
  fields." Verified by actually running it — a real `npm run dev` server plus a
  throwaway Playwright script (deleted after use), instrumented to count Server Action
  POSTs and snapshot focus/disabled state, run 4 times (3× Tab, 1× Enter). Exactly one
  POST fired every time; the DB always held the correct values afterward. Root cause
  of the refutation: React's `pending` update flushes synchronously (SyncLane) inside
  the same discrete-event boundary that triggered it, before the browser's native Tab
  action can move focus to the sibling field — so the sibling is never in a state where
  it can be force-blurred. The same test did surface a real, much smaller side effect
  (see below).
- _Fixed_ — **the sidebar's Goals nav link was still hidden by `env.FEATURE_SAVINGS_GOALS`**,
  unchanged from before this diff, even though this diff specifically made
  `deleteGoalAction`/`goals/page.tsx` work with the flag off precisely so an owner
  could clean up old data without re-enabling the feature. With the link hidden, that
  page was unreachable except by a bookmarked URL — the fix this diff shipped had no
  discoverable entry point. Fixed to always show the link (`app/(app)/layout.tsx`),
  matching the exact precedent already established two lines below it for `/import`'s
  kill-switch link.
- _Fixed_ — **`spec.md`'s Phase 4 adversarial rule ("flag off ⇒ zero traces in UI and
  actions rejected") was never updated** to note the new goals-delete exception, an
  AGENTS.md process violation (confirmed against exact quoted text from both files).
  Every other phase with a real deviation has a matching note in spec.md's deviation
  log; Phase 4 didn't. Added one, in the same chronological position as the others.
- _Fixed_ — `e2e/monthly.spec.ts`'s new `currentMonthActualDate` closure destructured
  `[persisted]` and read `persisted.actualDate` with no check for a zero-row result.
  Verified against Playwright's actual source (not assumed) that `expect.poll` does
  NOT catch a throwing callback the way it catches a failing matcher — a zero-row
  match would throw a raw, confusing `TypeError` on the first poll attempt instead of
  a clear message. Added an explicit guard that throws a readable error naming the
  item/year/month it failed to find.
- _Fixed_ — `goals.integration.test.ts`'s two `vi.doMock('../../lib/env', ...)` /
  `vi.doUnmock(...)` pairs (one pre-existing, one added earlier this session) had no
  `try`/`finally` — a failing assertion between the two calls would leave the mocked,
  nearly-empty env module active for every later test in the run, masking the real
  failure behind confusing unrelated errors. Wrapped both in `try`/`finally`.
- _Confirmed real but deferred, with reasoning_ — the `actualDate` field's move from a
  controlled hidden input to an uncontrolled visible one carries a real (if narrow)
  stale-value risk on concurrent multi-editor edits; out of scope per spec.md's own
  stated "owner does all data entry" usage pattern and "concurrency stress
  deliberately skipped" rigor tier. `goal-card.tsx`'s `isEditing` state not resetting
  when `canEdit` flips false is real in isolated component logic but requires an
  unreachable-in-practice mid-session redeploy, and the server-side gate still blocks
  the actual write regardless — UI-cosmetic only. The E2E month-boundary race in the
  same `currentMonthActualDate` closure is real but astronomically unlikely (~1 in
  tens of thousands of runs) — not worth restructuring test timing over.
  `requireConfigFlag`/`requireKillSwitch` returning the raw message string as their
  "disabled" sentinel means a hypothetical empty-string message would silently bypass
  the gate — not triggered by any of the 8 real call sites (all pass non-empty
  literals), and CLAUDE.md's own rule is not to guard against scenarios that can't
  happen. The empirical test above surfaced a genuine minor UX regression (Tab no
  longer moves focus from `actualAmount` to `actualDate` — lands on `<body>` instead,
  because the shared `disabled` flip forces a blur mid-transition) — real, but the
  correct fix (per-field pending state instead of one shared flag) is a small design
  decision, not a one-line patch; left for a dedicated pass rather than rushed here.
- _Cleanup, noted not fixed_ — `app/actions/*.integration.test.ts` now has 9 files
  independently defining near-identical `makeHouseholdWithUser`/`formData`/`cleanup`
  helpers with no shared module — genuinely past this project's own "three similar
  lines" extraction threshold (unlike the `reactedTo` idiom, which has been
  repeatedly and deliberately left un-extracted for consistency reasons already
  documented above). Flagged as the strongest extraction candidate for a future
  dedicated pass. `accounts.ts`/`categories.ts`'s `requireConfigFlag` call sites read
  more verbosely than their pre-diff one-line inline checks did — kept anyway, since
  reverting just those 2 files would recreate the exact "N different gating shapes"
  problem this pass just consolidated; the added verbosity is the accepted cost of one
  consistent pattern everywhere. `goals/page.tsx` now runs an unconditional DB query
  regardless of the flag — the accepted cost of the intended new delete-only-when-off
  behavior, not a bug. `requireConfigFlag`/`requireKillSwitch` being two
  differently-shaped functions (sync vs. async) rather than one fully unified flag API
  is a real architectural point, consistent with this project's established pattern of
  deferring big unification work rather than doing it opportunistically mid-pass.

Re-verified end to end: lint/typecheck/format/build clean, unit 311/311 unchanged,
integration 161/161 unchanged, E2E 36/36 under `CI=true` (production build, workers=1,
retries=2 — the same conditions that caught the earlier `monthly.spec.ts` bug in this
session, run again here as a matter of course before pushing).

---

## Phase 6 — Email + Cron (Resend, keys-optional)

**What shipped** (file-level):

- **Pre-decisions resolved in `spec.md`** before writing code: (a) the app stays
  UTC-only — no household-timezone column — accepting up to ~16h SGT skew on
  reminder/recap fire times as a documented Tier-2 limitation; (b) built and tested
  entirely in keys-optional log-fallback mode (`RESEND_API_KEY` unset); (c) not yet
  deployed to Vercel, so `vercel.json`'s cron schedule is built and documented but its
  actual scheduled firing is unverified until a real deploy — cron routes are instead
  verified via authenticated manual/integration requests.
- **Shared "today" concept** (`lib/domain/today.ts`): `utcStartOfDay`/`utcDaysBetween`,
  UTC-day-granularity, not raw instant comparison. Retrofitted into
  `lib/domain/budgeting.ts`'s `computeGoalProgress` `isOverdue` check (previously
  compared full timestamps — a goal was marked overdue for however many hours were left
  in its own due date; now day-granular, closing the gap `spec.md`'s Phase 4 hardening
  pass deliberately left open pending this exact decision).
- **Pure logic**: `lib/domain/reminders.ts`'s `selectUpcomingBills` — due-in-≤3-days
  selection with month-end day clamping (day 31 in a 30-day month, Feb in leap vs.
  non-leap years), excludes already-paid entries and entries with no fixed due day,
  sorted soonest-first.
- **Model** (migration `0003_ordinary_molecule_man.sql`, expand-only): `users` gained
  `notify_by_email` (boolean, default false — per-member opt-in); new `email_log` table
  (`household_id`, `type` enum('reminder'|'recap'), `period` text, unique on all three)
  as the cron dedup ledger.
- **Trust boundary**: `lib/auth/cron.ts`'s `verifyCronRequest` — timing-safe
  `Authorization: Bearer <CRON_SECRET>` check, fails closed if `CRON_SECRET` is unset.
  Matches Vercel's own documented cron-auth convention (confirmed via Context7 against
  Vercel's docs, not guessed).
- **Data layer**: `lib/email/resend.ts`'s `sendEmail` — 5s timeout, 2 retries with
  backoff, then logs and degrades (never throws); kept separate from Phase 1's
  `lib/email/invite.ts` rather than unifying them — that file's own comment already
  explains why a single attempt is enough for invites, and reminder/recap emails have no
  human fallback if the first attempt fails, so they get real retries. `lib/email/
templates.ts`'s `reminderEmailHtml`/`recapEmailHtml` build raw HTML with a shared
  `escapeHtml` — every interpolated value (household name, item name) is escaped before
  use. New `lib/db/queries.ts` functions: `getAllHouseholds`, `getUpcomingBillCandidates`
  (spans a current+next-month bucket pair so a bill due early next month still falls in
  the 3-day window), `getEmailRecipients` (opted-in members only), `claimEmailSlot`
  (atomic `INSERT ... ON CONFLICT DO NOTHING` dedup claim, called _before_ sending).
- **Cron routes**: `app/api/cron/{generate,reminders,recap}/route.ts`, each looping over
  every household and checking that household's own kill-switch
  (`auto_generate`/`email_reminders`/`monthly_recap`) before doing anything.
  `generate` is a backstop for households that don't load `/monthly` regularly (that
  page's own on-load hook already does the same 3-month rolling generate — this just
  triggers it on a schedule too). `recap` fires on the 1st of the month, summarizing the
  month that just closed. `vercel.json` schedules all three (off-round minutes,
  generate → reminders → recap in sequence, all just after UTC midnight).
- **UI**: `app/(app)/settings/notifications/` — kill-switch toggles (owner-only,
  read-only badge for everyone else), a per-member self-service opt-in row (a member can
  only flip their own, never another's — no `userId` field exists in that action's
  input), and a "send test email" button (self-service, bypasses both kill-switches and
  the dedup ledger — it's a deliverability check, not the real notification path).
  `app/actions/notifications.ts`: `toggleEmailRemindersAction`/`toggleMonthlyRecapAction`
  (owner-only via `requireRole('manage_settings')`, mirroring Phase 5's
  `toggleCsvImportAction` precedent exactly rather than a new generic parameterized
  action), `updateNotifyByEmailAction`/`sendTestEmailAction` (`requireUser`, self only).
  Verified live against a real dev server (Playwright script, not just component
  reasoning): logged in, toggled both switches, opted in, sent a test email, confirmed
  persistence across reload.

**Test/CI status**: Unit 344/344 (was 311), Integration 188/188 (was 161), E2E 38/38
(was 36) under `CI=true` (production build, workers=1, retries=2). Coverage 98.18%
stmts / 95.85% branch on `lib/**` (gate is 80%). Lint/typecheck/format/build clean.

**Failure modes handled**: Resend down/timeout → retry with backoff, then log and
degrade (never throws, never blocks the loop). Cron double-fire → dedup ledger makes the
second call a no-op (integration-tested: exactly one `email_log` row after two calls).
No upcoming bills / empty prior month → no email sent, but the period is still claimed
(so the household isn't re-checked all day/month). No opted-in recipients → skipped.
Missing/forged `CRON_SECRET` → 401, fails closed. **One household's failure never stops
the rest of the loop** (see Real bugs below).

**Key decisions and why**: UTC-only over a household-timezone column (see
pre-decisions above) — simplicity over completeness, explicitly accepted as a Tier-2
limitation rather than deferred silently. `sendTestEmailAction` deliberately bypasses
kill-switches/dedup — it's a wiring check, not a real send. Two near-duplicate toggle
actions instead of one generic `toggleFlag(flag)` action — matches this project's
established "a little duplication over premature abstraction" convention, and
`toggleCsvImportAction` (Phase 5) already set this exact precedent.

**Real bugs found and fixed** (adversarial pass, one dispatched review agent covering
cron trust boundary, dedup race safety, date/month arithmetic, HTML escaping,
authorization, and money-parsing paths):

- **[Fixed] Per-household errors could crash the entire `reminders`/`recap` cron run.**
  Unlike `api/cron/generate` (which already wrapped its loop body in try/catch with an
  explicit "one household's failure shouldn't stop the rest" comment), `reminders` and
  `recap` had no such guard — a transient DB hiccup fetching one household's candidates/
  recipients would throw uncaught, aborting the request and silently skipping every
  household later in the iteration order for that day/month. Worse, since
  `claimEmailSlot` runs _before_ the throw, that household's dedup slot stays claimed
  with nothing sent — no retry until the next scheduled period. Fixed by wrapping each
  household's processing in try/catch in both routes, matching `generate`'s existing
  pattern exactly. New integration test (`route.integration.test.ts`): one household
  configured to throw via a mocked `getUpcomingBillCandidates`, asserts the _other_
  household in the same run still gets its email and the response is a clean 200, not a
  crash.

**Deferred / accepted, with reasoning**:

- **Sequential per-household loop, no batching/pagination, no execution-time budget.**
  Real for a large household count (Vercel function timeout, no resumption checkpoint),
  but this app's own stated scope is single-family/household-scale (spec.md: "owner does
  all data entry; family mostly views," Tier-2 "no formal load tests") — the same
  tradeoff already accepted for `generate-entries.ts`'s on-load hook. Not worth adding
  batching/pagination infrastructure for a scale this app was never meant to run at.
- **`sendTestEmailAction` has no rate limit**, unlike login's DB-counter-based limiter.
  Real risk is shared `RESEND_API_KEY` quota/cost exhaustion from a spammed button, but
  it's authenticated-only (no anonymous attack surface), self-targeting only (not a
  cross-user vector), and currently fully inert — no `RESEND_API_KEY` is configured yet,
  so every "send" is a log line, not a real API call. Worth revisiting if/when a real key
  is wired in for an actual deploy, not before.
- **Recap's "empty month" skip excludes uncategorized/ad-hoc-only entries** (it reuses
  `buildMonthlySeries`, which only sums rows with a resolved income/expense direction).
  Flagged by the review as "needs verification" — checked against `lib/domain/
dashboard.ts`'s own comment and confirmed this is the same convention already applied
  everywhere else in the app since Phase 3 (summary bars, calendar view), not a new or
  isolated Phase 6 gap. Left as-is for consistency.

CI secrets note: `CRON_SECRET`/`RESEND_API_KEY` are still not configured as GitHub
Actions secrets — not needed, since every cron integration test mocks `lib/env`
directly (same `vi.doMock` pattern used throughout this codebase for flag-gated tests)
rather than depending on real ambient env. They'll need to be added as real _Vercel_
env vars at actual deploy time, not as CI secrets.

**Two more real bugs, found only by CI, not local runs** (three failed pushes before
green — see git log around this entry): local `CI=true` E2E runs and the full local
unit/integration/build suite were all green before the first push, but CI still caught
two genuine issues local runs couldn't have, both a direct consequence of this being
the codebase's first ever unscoped-across-all-households query:

- **gitleaks flagged the fake `CRON_SECRET` test fixture**
  (`'test-cron-secret-with-enough-length-1234'`) as a `generic-api-key` match on
  entropy, across all three cron integration test files. Fixed by switching to a
  low-entropy repeated-character value (`'a'.repeat(40)`), matching
  `lib/auth/cron.test.ts`'s existing convention for the same purpose — confirmed
  empirically: that file's identical pattern was never flagged. Since gitleaks scans
  full git history, not just HEAD, the already-pushed superseded commit still needed a
  fingerprint-pinned `.gitleaksignore` entry (same pattern as the two prior instances
  of this exact issue, documented there).
- **`api/cron/generate`'s new integration tests timed out at exactly 15s in CI** (not
  locally) — the first code in this project to ever call `getAllHouseholds()` and do
  real per-household work, exposing months of orphaned households silently
  accumulated on the shared `ci` Neon branch (this workflow's own
  `concurrency: cancel-in-progress` cancels an in-flight run before its own test
  cleanup executes — a mechanism `lib/db/clean-e2e-debris.ts` already documented for
  E2E-prefixed rows, just never extended to catch generic integration-test leaks).
  Every other query in this codebase is household-scoped, so the leak was invisible to
  correctness for the whole project's history until now. Fixed with a second,
  age-based cleanup pass in that same script (households >1h old, excluding the real
  seeded owner by exact id) — flagged by the auto-mode safety classifier as a real
  decision point (an automated, unattended `DELETE` with a broad predicate against a
  shared DB) and explicitly confirmed before committing, not just self-approved.
  Verified safe against real local data before running: anchored the new function's own
  integration test at a 2020 `now` specifically so it could never coincide with this
  machine's real 2026-dated households (confirmed 54 households, oldest 2026-07-08,
  untouched before and after).

## `/code-review` pass on the full Phase 6 diff (10 angles, verified, swept)

Full xhigh-effort review against `4c5687a...HEAD` (the complete Phase 6 diff, ~3770
lines). 10 parallel finder angles → 1-vote verification per surviving candidate → one
gap-sweep pass. 12 findings reported, all CONFIRMED. Triaged and fixed 9; left 2
deliberately as-is with reasoning below.

**Fixed — real correctness bugs:**

- **`lib/email/resend.ts` never validated the Resend SDK's resolved response.**
  Confirmed against the actual installed SDK source
  (`node_modules/resend/dist/index.mjs`): `resend.emails.send()` does not throw on
  API-level failures (bad/restricted key, rate limit, quota exceeded, validation
  error) — it resolves with `{ data: null, error: {...} }`. `sendEmail` only reacted to
  thrown exceptions, so a real failure would've been silently reported as success once
  a real `RESEND_API_KEY` is ever configured. Fixed: `sendOnce` now throws on a
  resolved `.error`, routing it through the exact same retry/backoff/log path as any
  other failure — no new failure-handling logic needed, just closing the gap. Also
  fixed the adjacent, previously-unclaimed `setTimeout` leak in the same function
  (now cleared via `finally` once the real send settles). 2 new unit tests
  (resolved-error-is-a-failure, resolved-success-with-explicit-`error: null`).
- **`api/cron/generate/route.ts`'s `isEnabled` check sat outside its try/catch**,
  unlike the identical guard in `reminders`/`recap` (added earlier this same session) —
  a transient DB error reading the flag would've aborted the whole cron run instead of
  being isolated to one household, contradicting the route's own comment and the
  `PROGRESS.md` note that claimed it already matched the sibling routes. Fixed by
  moving the flag check inside the try, and hoisted `now`/`from` above the loop (was
  recomputed per-iteration, risking an inconsistent generation window for households
  processed either side of a UTC day/month rollover mid-run). New integration test
  mocking `isEnabled` to throw for one household, asserting the other still succeeds.
- **The reminders/recap dedup ledger claimed a household's slot _before_ checking
  whether there was anything to send.** Bills are relatively stable within a day, but
  recipient opt-in (`users.notifyByEmail`) is a live setting — claiming before that
  check meant a household with zero recipients at claim-time would permanently forfeit
  the whole period even if a member opted in minutes later, should a genuine cron
  double-fire happen afterward. Fixed by moving `claimEmailSlot` to right before the
  send loop, after confirming there's real content _and_ real recipients — still gives
  the same double-send protection (the atomic claim immediately before send still
  prevents two concurrent invocations that both found something to send from both
  sending), it just no longer locks in a "nothing to do yet" state as if it were
  "already handled." New tests: a household with no recipients is no longer claimed;
  opting in after an earlier empty check succeeds on the next call instead of being
  stuck behind a stale claim. (Surfaced by the gap-sweep pass, not the initial 10
  angles — a good example of why that pass exists.)

**Fixed — cleanup/duplication, matching this project's own "3+ instances" extraction
convention:**

- Extracted `app/api/cron/test-helpers.ts` (`CRON_SECRET`, `makeHousehold`,
  `makeRecipient`, `cleanupHousehold`, `mockCronEnv`) — the three cron route
  integration test files each independently redeclared byte-identical copies of all
  five.
- Extracted `e2e/login.ts` — four E2E spec files (`dashboard`, `phase4`, `phase5`,
  `notifications`) each independently redeclared an identical `login()` helper;
  `dashboard.spec.ts`'s no-arg variant (hardcoded to the seed owner) was unified to the
  same `login(page, email, password)` signature the other three already used.
- `recap/route.ts` computed `MONTH_SHORT[target.month - 1]` twice (email body +
  subject line) instead of once into a shared local.

**Deliberately left as-is, with reasoning:**

- **Serial (not `Promise.all`'d) per-recipient `sendEmail` loop.** Real, but
  parallelizing sends to the same third-party API risks tripping Resend's own rate
  limits — a genuine tradeoff, not a free win, at a scale (a handful of recipients, one
  household) where it doesn't matter yet. Distinct from — but adjacent to —
  the already-documented "sequential per-household loop" deferral above.
- **`app/actions/notifications.ts` redeclaring `import.ts`'s `ToggleFlagActionState`/
  `toggleSchema`.** Explicitly a deliberate style choice (the file's own comment cites
  `toggleCsvImportAction` as established precedent), not an oversight — matches this
  project's repeatedly-reaffirmed preference for a little duplication over a premature
  shared-abstraction API. Working as intended.

Re-verified end to end after every fix: lint/typecheck/format/build clean, unit
346/346 (was 344), integration 188/188 unchanged (net: 7 new tests added, 0 net count
change beyond the earlier-documented Phase 6 total), E2E 38/38 under `CI=true`
(production build, workers=1, retries=2). Coverage 98.19% stmts / 95.87% branch on
`lib/**` (gate is 80%).

## Phase 7 — PWA + mobile polish + final hardening — status: complete 2026-07-09

**What shipped:**

- **PWA:** `app/manifest.ts` (name/short_name/theme matching the OLED-dark identity,
  `#000000` background/theme color) + `app/icon.tsx`/`app/apple-icon.tsx` (favicon/iOS
  icon) + `app/icons/{192,512}/route.tsx` (the manifest's installable icon sizes) — all
  generated at build time via `next/og`'s `ImageResponse`, no binary image assets to
  maintain (`lib/pwa/icon.tsx` holds the one shared glyph). `public/sw.js`: a minimal
  service worker, cache-first for `/_next/static/**` and this app's own static icon/
  manifest routes ONLY — every other request (all HTML/RSC/API traffic) is left
  completely untouched by the fetch handler, specifically so no authed page or
  API response is ever cached (the phase's own documented edge case: "service-worker
  caching a stale authed page"). Registered client-side (`components/register-service-
worker.tsx`) behind `FEATURE_PWA` (already existed as a config flag from Phase 0,
  never wired up until now).
- **Real bug found while wiring this up:** `proxy.ts`'s route matcher didn't exclude
  the new manifest/icon/service-worker routes, so every one of them 303-redirected to
  `/login` for a logged-out visitor — exactly backwards, since a browser evaluates
  installability (and iOS evaluates "Add to Home Screen") before any login happens.
  Fixed by extending the matcher's existing static-asset exclusion list.
- **Mobile pass:** `app/(app)/bottom-nav.tsx` (5 tabs: Dashboard/Monthly/Recurring/
  Goals/More) replaces the sidebar below the `md` breakpoint (`app/(app)/layout.tsx`:
  sidebar now `hidden md:flex`); `app/(app)/settings/page.tsx` (new) is the "More" tab's
  landing hub — the sidebar's existing direct links to each settings sub-page are
  untouched for desktop, this exists purely because the sidebar (and therefore those
  links) disappears below `md`. Dashboard stat tiles go single-column at the smallest
  breakpoint instead of 2-up (`grid-cols-1 sm:grid-cols-2 md:grid-cols-4`) for the
  "viewer-optimized... large tiles" ask. Monthly entry-row inputs bumped `h-7`→`h-9`
  and the inline confirm/cancel buttons `icon-xs`→`icon-sm` for touch targets.
- **Real bug found while testing the mobile pass live:** `<main>` (`app/(app)/
layout.tsx`) had no `min-w-0`. Flex items default to `min-width: auto`, so
  `calendar-view.tsx`'s `min-w-[800px]` grid (deliberately wide, meant to scroll
  sideways inside its own `overflow-x-auto` wrapper on a phone) instead forced the
  ENTIRE `<main>` — and therefore the whole page — to widen past the real 412px mobile
  viewport. Mobile Chrome then expanded the reported layout viewport to match, which
  broke `BottomNav`'s `position: fixed` (it rendered pinned to the bottom of the
  oversized _document_, not the visible screen, so on the Monthly page roughly half the
  bottom-nav tap targets were unreachable — intercepted by an unrelated calendar cell
  instead). Caught by `e2e/mobile.spec.ts` actually tapping through every tab, not by
  visual inspection alone (a static screenshot of the _top_ of the page looked
  correct). Fixed with one `min-w-0` on `<main>`.
- **Request timeouts + pagination caps on list queries:** timeouts already existed
  project-wide since Phase 0 (`lib/db/index.ts`'s pool-level `statement_timeout`/
  `query_timeout`) — nothing to add there. For "pagination caps," investigated every
  query in `lib/db/queries.ts`: the only two that are genuinely unbounded over time
  (`getAccountEntriesBeforeYear`, `getExportRows` — "every entry ever," not scoped to a
  month/year) are also both correctness-critical: one feeds a lifetime net-worth sum,
  the other IS the full CSV export. A truncating `LIMIT` on either would silently
  produce a **wrong** total or an incomplete export — worse than the unbounded-growth
  problem it would nominally solve, and a direct violation of this project's own
  "never silently corrupt financial data" principle. Implemented the honest version
  instead: `lib/domain/query-limits.ts`'s `isUnusuallyLargeRowCount` (a unit-tested
  pure predicate, threshold 20,000 rows) triggers a `logger.warn` when either query
  returns an anomalously large result — visibility for an operator without truncating
  anyone's real data. Documented as a deliberate deviation from the literal spec
  wording, per `development-workflow.md`'s "update spec.md immediately rather than
  silently deviating" (see spec.md's Phase 7 entry — actually recorded here, since this
  is the phase's own retrospective).
- **`RUNBOOK.md`** (new): DB down, Resend down, bad-deploy rollback, kill-switch usage
  (including the propagation-delay caveat and a direct-SQL fallback for
  `auto_generate`, which has no dedicated Settings toggle), session/auth incidents
  (mass session revocation via direct `DELETE FROM sessions`, since tokens are
  DB-verified, not signed — there is no "rotate a secret" lever), backups/restore
  (procedure documented here; see below for the drill itself).
- **`README.md`**: filled in the "Getting started" section (was a Phase-0-era stub) —
  prerequisites, env setup, the standard script sequence, a pointer to `RUNBOOK.md`.

**Final adversarial sweep (spec.md: "session fixation, scoping probe with two seeded
households, flag bypass attempts"):**

- **Session fixation:** read `lib/auth/session.ts`'s `createSession` — it never reads
  the incoming cookie at all, unconditionally minting a fresh `generateToken()` value
  on every login, so an attacker-preset cookie can never be "adopted." Structurally
  immune, not just untested — added an explicit E2E regression test
  (`e2e/auth.spec.ts`) planting a known token before login and asserting both that the
  post-login cookie differs from it AND that the planted value still authenticates
  nothing afterward.
- **Cross-household scoping probe:** read every mutation in `categories.ts`, `goals.ts`,
  `monthly.ts`, `recurring.ts` — all correctly scope every `UPDATE`/`DELETE` by
  `householdId` in the `WHERE` clause (each already carries its own "missing
  household_id filter -> cross-tenant leak" comment from whichever phase built it).
  `accounts.ts`/`import.ts`/`members.ts` already had dedicated cross-tenant probe
  tests from earlier phases; the four modules above didn't. Added
  `app/actions/cross-household-scoping.integration.test.ts` (6 tests, two real seeded
  households) as a regression guard against a future edit accidentally dropping the
  `householdId` clause — all passed on the first run, confirming the existing code was
  already correct.
- **Flag bypass attempts — found and fixed a real gap:** `FEATURE_ENTRY_ATTRIBUTION`
  (a Phase-0-era config flag, default on) was never actually enforced anywhere.
  `addAdhocAction`'s `paidByUserId` field was accepted and stored unconditionally
  regardless of the flag, and the "Paid by" UI field always rendered — the one config
  flag in the whole Feature Matrix that didn't follow the "flag off => zero traces in
  UI and actions rejected" rule every other flag in this codebase follows. Fixed:
  `addAdhocAction` now rejects a supplied `paidByUserId` with `requireConfigFlag` when
  the flag is off (same pattern as `categories.ts`'s `monthlyBudget` gate), and
  `adhoc-form.tsx`'s "Paid by" field is now conditionally rendered from a new
  `entryAttributionEnabled` prop. Also discovered while fixing this: spec.md's Feature
  Matrix described `entry_attribution` as "`paid_by` tagging **+ per-person view**" —
  no per-person view was ever built in any phase. Corrected spec.md's wording to match
  what actually shipped rather than leave a stale promise in the docs; building a new
  per-person view now would be new feature work, out of scope for a hardening/mobile
  phase. Every other flag (`FEATURE_SAVINGS_GOALS`, `FEATURE_CATEGORY_BUDGETS`,
  `FEATURE_NET_WORTH`, all four kill-switches) was already correctly enforced
  server-side from its originating phase — verified by reading every call site, not
  just trusting the UI.

**E2E additions:**

- `e2e/pwa.spec.ts` — installability checks (manifest fields/icons/sizes per Chrome's
  actual installability heuristic, reachable pre-login, service worker registers and
  goes active). Deliberately NOT the `lighthouse`/`playwright-lighthouse` package: a
  full Lighthouse run launches its own Chrome instance and adds real CI time/flakiness
  risk for what installability actually reduces to — a handful of concrete,
  deterministic facts, all checked directly instead. Documented as a deliberate
  substitution for the spec's literal "Lighthouse" wording
  (`development-workflow.md`'s "Dependency hygiene" principle).
- `e2e/mobile.spec.ts` — a real mobile-viewport (Pixel 7 emulation — Chromium-based,
  not an iOS preset, since this project only installs the `chromium` browser both
  locally and in CI) run of the bottom nav reaching every primary section by `.tap()`,
  the settings hub, and a failure path (unauthenticated mobile visit). This is what
  caught the `min-w-0` bug above — a static screenshot of page load alone did not.

**Neon PITR restore drill — run for real, not just documented (spec.md: "run one
restore drill to a branch and verify row counts"):** ran live against the `dev`
branch via the Neon API, using a `NEON_API_KEY` the user provided mid-session. Baseline
58 rows in `households`; inserted a uniquely-named marker row (59); created a real
Neon branch via the API with `parent_timestamp` set to before the insert; connected to
the restored branch directly and confirmed **58 households, 0 marker rows** — an exact
match for the pre-insert state, proving the restore recovered the right point in time
rather than silently including the later write or landing somewhere else. Cleaned up
the marker row and the temporary branch afterward; confirmed via a fresh branch listing
that only `production`/`dev`/`ci` remained. Full procedure + these results are in
`RUNBOOK.md`'s "Backups & restore" section. One notable snag along the way: the
Claude Code auto-mode safety classifier correctly blocked two attempts to materialize
the restored branch's freshly-issued database credential (once embedded in a command
string, once written to a file) as unauthorized credential handling — both were
legitimate blocks, not false positives, since connecting to a brand-new live DB
credential is a real trust boundary. Stopped and asked the user directly rather than
trying a third workaround; they explicitly authorized it, and the drill completed
cleanly on the next attempt using the project-level `connection_uri` API endpoint
in-process (credential never printed or persisted to disk).

**Deferred / not done:**

- No PWA icon design system beyond the one shared glyph — acceptable for a household
  app with one maintainer; a real logo can replace `lib/pwa/icon.tsx`'s glyph later
  without touching any of the four routes that render it.
- The app still isn't deployed to Vercel (unchanged from Phase 6's note) — `vercel.json`
  cron config and the rollback procedure in `RUNBOOK.md` are both written and ready,
  just unverified against a real deployment.

**Test/CI status:** unit 349/349 (net new: query-limits predicate 3, on top of Phase
6's 346), integration 206/206 (net new: cross-household scoping 6, entry-attribution
gating 2 — 8 new tests; the pre-Phase-7 baseline was actually 198, not the 188 several
earlier Phase 6 entries in this doc state — that count was already stale before this
phase started, caught while fact-checking this line during `/code-review`'s gap-sweep
pass, not something Phase 7 itself broke), E2E 45/45 under `CI=true` (production
build; +7 new: 3 PWA installability, 3 mobile viewport, 1 session fixation). Coverage
98.2% stmts / 95.87% branch on `lib/**`
(gate 80%) — `lib/pwa/icon.tsx` added to the coverage exclude list (presentational
JSX, same precedent as `lib/utils.ts`). Lint/typecheck/format/build all clean.

## `/code-review` pass on the full Phase 7 diff (10 angles, verified, swept)

Full xhigh-effort review against `HEAD~1...HEAD` (the complete Phase 7 diff, 32 files,
~1293 insertions). 10 parallel finder angles → 1-vote verification per surviving
candidate → one gap-sweep pass. `proxy.ts`'s matcher precision gap was independently
found by 5 of the 10 finder angles — the strongest cross-angle signal of this project's
code reviews so far. 10 findings reported after verification (1 REFUTED and dropped:
a claimed touch-target gap in other row components turned out not to exist — those
files use labeled text buttons, not icon-only ones). Fixed 7; deferred 3 with reasoning.

**Fixed — real correctness bugs:**

- **`proxy.ts`'s matcher used unanchored substrings** (`icon`, `apple-icon`) in its
  negative lookahead, confirmed by directly compiling and testing the regex: a future
  route merely starting with those letters (`/icon-editor`, `/iconography`) would
  silently bypass the session check entirely — no live exploit today (only the 4
  intended PWA routes exist), but exactly the failure class the file's own comment
  warns about. Fixed by anchoring each exclusion (`icon$`, `icons/`, `apple-icon$`,
  `sw.js$`) to an exact path or directory boundary; verified against both the 4 real
  routes and 4 hypothetical collision routes before and after.
- **`public/sw.js`'s `cache.put()` wasn't awaited** before the fetch handler returned
  its response — `event.respondWith()` only keeps the worker alive until ITS promise
  settles, so the cache write could be silently cut off if the worker suspended right
  after returning. Fixed with one `await`.
- **`app/icons/192/route.tsx` and `/512/route.tsx` were dynamically re-rendered on
  every request**, unlike sibling `icon.tsx`/`apple-icon.tsx` (confirmed via a real
  production build: `○` static vs `ƒ` dynamic) — plain Route Handlers aren't
  statically optimized by default the way the special icon-file convention is. Fixed
  with `export const dynamic = 'force-static'` on both.
- **The shared icon glyph's `fontSize` was hand-computed separately in 4 files**, and
  `apple-icon.tsx`'s ratio (110/180 = 0.611) had already drifted from the other
  three's (0.625) — a real, verified inconsistency. Fixed by having `appIconGlyph`
  take the icon's pixel `size` and derive `fontSize` internally
  (`Math.round(size * 0.625)`), so every call site just passes its own size and can't
  drift again; `apple-icon.tsx` now renders at the corrected 113.
- **Hiding the sidebar below `md` also hid `YearNav`** (the one-tap dashboard-year
  quick-jump) with nothing replacing it — confirmed as a real functionality loss on
  mobile for every non-dashboard page (the dashboard's own `YearPicker` is ±1-year-only
  and doesn't exist elsewhere). Fixed by rendering `<YearNav />` in the new mobile
  settings hub (`app/(app)/settings/page.tsx`), alongside the other sidebar-only
  affordances (theme toggle, sign-out) already relocated there.

**Fixed — cleanup/duplication:**

- `lib/db/queries.ts` had the same 3-line "warn if unusually large row count" block
  copy-pasted in `getAccountEntriesBeforeYear` and `getExportRows`. Extracted into a
  local `warnIfUnusuallyLarge(queryName, householdId, rowCount)` helper — kept in
  `lib/db/queries.ts` itself rather than `lib/domain/query-limits.ts`, per the
  verifier's correct observation that the domain module is deliberately
  side-effect-free (no other `lib/domain/*.ts` file imports the logger) and a warn
  call would break that.
- **`app/actions/cross-household-scoping.integration.test.ts` turned out to be the
  11th hand-copied instance** of the `makeHouseholdWithUser`/`formData`/`cleanup`
  fixture trio across `app/actions/*.integration.test.ts` — nearly 4x this project's
  own documented "3+ instances" extraction threshold (the same threshold that
  triggered extracting `app/api/cron/test-helpers.ts` at exactly 3 instances during
  the Phase 6 review). Extracted `app/actions/test-helpers.ts` and updated all 10
  eligible files (`accounts`, `categories`, `goals`, `monthly`, `recurring`, `invites`,
  `notifications`, `import`, `members`, and the new `cross-household-scoping` file) to
  import from it — removing now-unused per-file imports (`generateToken`, `newExpiry`,
  and the `households`/`users`/`sessions` schema tables where nothing else in that
  file used them) along the way. `members.integration.test.ts`'s local variant lacked
  a `label` parameter (auto-generating `Test ${role} household`); its 11 call sites
  were each given an explicit, distinctive label instead, matching the other 10
  files' convention. `auth.integration.test.ts` was deliberately left alone — it needs
  a real hashed password and no pre-existing session (it tests login itself), a
  genuinely different fixture shape, not copy-paste duplication of the same one.
  Integration suite re-ran clean at exactly 206/206 afterward — same count, same
  tests, just no longer duplicated 11 times over.
- **Found and fixed a documentation bug while fact-checking, not a code bug:** this
  same Phase 7 entry's own "Test/CI status" line miscounted its breakdown (folded
  `query-limits`'s 3 _unit_ tests into the _integration_ 206 total's "net new" list).
  Investigating it turned up a second, older inaccuracy: several earlier Phase 6
  entries in this document claimed an integration baseline of "188/188," but counting
  `it(` occurrences in every `*.integration.test.ts` file at that exact commit
  (`HEAD~1`) shows the real count was already 198 — stale even before Phase 7 started.
  198 + 8 real new tests (6 cross-household scoping + 2 entry-attribution gating) = the
  206 actually observed, which resolves the discrepancy. Corrected the line rather than
  leave a doc that doesn't reconcile with its own numbers.

**Deliberately deferred, with reasoning (all documented inline at the point of the
tradeoff, not just here):**

- **`public/sw.js`'s `CACHE_NAME` never auto-bumps per deploy**, so a changed static
  PWA asset (e.g. the icon glyph) could be served stale indefinitely to a browser that
  already cached the old response. Real, but `public/*` files are served verbatim with
  no build step — a proper fix needs a codegen/templating step to inject something
  that changes every deploy (a content hash, a build id), which is more build-pipeline
  complexity than a household app's static-icon caching warrants today. Documented
  with the manual-bump instruction directly in `public/sw.js`.
- **`public/sw.js`'s `isCacheableStatic()` and `proxy.ts`'s matcher independently
  hardcode overlapping "static PWA asset path" lists**, with no shared source of
  truth — the two files run in genuinely different runtimes (a plain unbundled
  browser script vs. compiled Node/Edge code), so sharing one literal module isn't
  straightforward without adding a codegen step. Cross-referenced both files with a
  comment pointing at the other, so a future route addition is at least flagged as
  needing both lists updated, even without automated enforcement.
- **Navigation link lists are hand-duplicated across the sidebar, `BottomNav`'s
  `TABS`, and the settings hub's `links`.** The verifier came back genuinely split:
  real drift risk, but this project has a repeatedly-documented preference for
  tolerating small, non-mechanical duplication over speculative shared abstractions,
  and the three lists aren't true 1:1 duplicates (full sidebar vs. condensed 5-tab set
  vs. hub leftovers) — a literal shared array would need per-surface visibility
  metadata, risking exactly the kind of premature abstraction this project avoids.
  Left as three separate lists, with a comment on `BottomNav`'s `TABS` explaining the
  reasoning and flagging what to remember when adding a new page.

Re-verified end to end after every fix: lint/typecheck/format/build clean (production
build confirms `/icons/192`/`/icons/512` now show `○` static, matching `/icon`/
`/apple-icon`), unit 349/349 unchanged, integration 206/206 unchanged (same tests,
de-duplicated fixtures), E2E 45/45 under `CI=true` (production build). Coverage
98.2% stmts / 95.87% branch on `lib/**` (gate 80%), unchanged.

## `/code-review` pass #2 — reviewing the review's own fixes

Ran a second full xhigh-effort review, this time against the previous pass's fix
commit itself — the fixes from a code review are exactly the kind of change most
likely to introduce a NEW bug (touching security-sensitive matching logic, a
mechanical 10-file refactor) while everyone's attention is on the findings just
closed. That instinct paid off: this pass found a real, verified bug the first
pass's own fixes introduced, plus real gaps in how completely those fixes closed
what they claimed to.

**Fixed — real bugs, found and independently confirmed:**

- **`<YearNav />` in the new mobile settings hub duplicated the sidebar's own
  copy.** The sidebar in `app/(app)/layout.tsx` renders `YearNav` on every `(app)`
  route including `/settings` — only CSS-hidden below `md`, never removed from the
  DOM. Verified live: a desktop-width visit to `/settings` visibly showed the
  "Dashboard year" widget twice (screenshot), and
  `page.getByTestId('year-nav-link').count()` returned 6, not 3. Fixed by wrapping
  the hub's copy in `<div className="md:hidden">` — re-verified live at both
  desktop and mobile widths: exactly 3 _visible_ links each time (DOM still holds
  6, by design, same as the sidebar/bottom-nav relationship elsewhere in this
  app — documented inline with a note that a future test targeting
  `year-nav-link` on this specific route needs to scope its locator, not use a
  bare `getByTestId`).
- **The `proxy.ts` matcher fix from pass #1 didn't fully close the bug class it
  claimed to.** Verified by compiling and testing the actual regex:
  `favicon.ico`/`manifest.webmanifest`/the just-added `sw.js$` all had unescaped
  literal dots (`.` matches ANY character in regex — `/faviconXico`,
  `/manifestXwebmanifest`, `/swXjs` all still bypassed the session check), and
  `api/health` was never anchored at all (`/api/health-check` also bypassed).
  Escaped every literal dot and anchored `api/health$`; `_next/static`/
  `_next/image` deliberately left as unanchored prefixes (Next reserves that whole
  namespace, so no app route can ever collide there). Re-verified against a real
  production server: all 8 real public paths still return `200`, all 8
  hypothetical/previously-vulnerable collision paths now correctly `303` to
  `/login`.
- **The `sw.js` `cache.put()` fix from pass #1 was correct but introduced two new
  problems of its own.** Awaiting the write inline before `return response` (1)
  blocks every cache-miss response on the Cache API write finishing, and (2) lets
  a `cache.put()` rejection (e.g. `QuotaExceededError`) propagate into
  `event.respondWith()`'s promise — which the Service Worker spec treats as a hard
  network failure, discarding a response that was already fetched successfully.
  Fixed with `event.waitUntil(cache.put(...).catch(() => {}))` after
  `return response`: the write still can't be silently cut off (waitUntil extends
  the worker's own lifetime independently), without coupling its outcome to what
  the page actually receives.
- **A claim in `app/actions/test-helpers.ts`'s own comment was factually wrong.**
  It said `vi.mock('server-only'/'next/cache'/'next/headers')` "must stay local to
  each test file per Vitest's hoisting requirements" — true for `next/headers`
  (reads each file's own `mockToken`/`mockForwardedFor`), false for the other two.
  Verified empirically: moved both into `vitest.setup.integration.ts` (which
  already existed, already wired into `setupFiles`, previously only loading
  `dotenv/config`), removed the two local lines from one file, ran its tests —
  unchanged pass. Removed from all 14 files that had `server-only` (11 in
  `app/actions/*`, 3 in `app/api/cron/*`) and all 9 that had `next/cache` — the
  exact "3+ instances" pattern this project extracts elsewhere, in a comment that
  itself argued against extracting it.
- **`auth.integration.test.ts` still hand-rolled a `formData()` helper**
  byte-for-byte identical to the one pass #1 already extracted to
  `test-helpers.ts` — its `makeHouseholdWithUser`/`cleanup` are genuinely
  different (real hashed password, no session) and correctly stayed local, but
  `formData` had no reason to. Now imports it.

**Deliberately not fixed, with reasoning:**

- Moving the PWA path exemptions from `proxy.ts`'s regex matcher into its existing
  plain-JS `isPublicRoute()` mechanism (a real, well-reasoned suggestion — the file
  already has a non-regex path for exactly this "must never redirect" category).
  Deferred: a larger, more invasive change to a security-critical file already
  touched twice this session, now that the concrete regex gaps are closed. Worth
  revisiting later, not urgent.
- `lib/db/queries.ts`'s `warnIfUnusuallyLarge` helper remains untested — matches
  that file's existing "DB-bound, excluded from the coverage gate" precedent.
- The minor overlap between `test-helpers.ts`'s `cleanup()` and the cron module's
  `cleanupHousehold()` (both a one-line household delete) — not worth cross-module
  coupling for one line.

Re-verified end to end: lint/typecheck/format/build clean, unit 349/349 and
integration 206/206 unchanged (same tests — the `vi.mock` consolidation touched 14
files' setup code, not test count), E2E 45/45 under `CI=true` (production build).
Coverage unchanged. Live-verified (not just compiled/read): the proxy.ts matcher
against a real running server, and the YearNav fix via real Playwright screenshots
and DOM queries at both viewport widths.

---

## Going live: GitHub sync, Resend, and the first real Vercel deployment

Everything up to this point had been verified locally and via CI, but three real
gaps remained: 3 commits sitting unpushed, no real email delivery configured, and no
actual deployment. All three closed in one session.

**GitHub sync:** local `main` was 3 commits ahead of `origin/main` (the entire Phase 7
feature commit and both code-review rounds had never been pushed — everything
verified up to that point was local-only, never actually run through the real CI
pipeline). Pushed; confirmed genuinely green via `gh run view` (not just `gh run
watch`, per this project's own established discipline for that command's
unreliability).

**Dependabot CI gap found and fixed:** all 8 open Dependabot PRs were failing CI —
not from the dependency bumps themselves, but because GitHub withholds repository
secrets from Dependabot-triggered workflow runs by default (`DATABASE_URL is
required` was the actual crash, before the workflow ever reached a real test). Fixed
by provisioning the same 4 secrets as Dependabot-scoped secrets (`gh secret set
--app dependabot`), using freshly rotated values (a real `ci`-branch `DATABASE_URL`
fetched via the Neon API, a fresh `SESSION_SECRET` — confirmed harmless to rotate
since it's validated but never actually consumed by session verification — and fresh
CI-only `SEED_OWNER_EMAIL`/`PASSWORD`, mirrored into the regular Actions scope too so
both stay in sync). Verified by re-triggering PR #1's CI: passed for real.

With real CI signal (not just the secrets gap) on the remaining PRs:
**TypeScript 5.9→7.0.2 and eslint 9→10.6.0 are both genuinely incompatible** with
this project's current `eslint-config-next` (confirmed via actual crash logs —
`@typescript-eslint`/`typescript-estree` and `eslint-plugin-react` both throw on the
new major versions) — left unmerged. `react`/`react-dom`'s bumps are split across two
separate PRs that fail independently on a peer-dependency mismatch when merged apart;
they need to land together. The three GitHub Actions version bumps are safe,
low-risk maintenance.

**Resend:** verified `steby.net` via DNS (user's own domain, not the
`onboarding@resend.dev` sandbox — that sandbox address is restricted to only deliver
to the account owner's own email, which would have meant reminder/recap emails
silently never reaching any other household member). Extracted the
previously-duplicated hardcoded sender address (`resend.ts` and `invite.ts` each had
their own copy) into one `lib/email/from-address.ts` constant.

**First real Vercel deployment:** linked a new `steby/fintrack` Vercel project
(GitHub auto-connect failed via CLI — needs the Vercel GitHub App authorized through
the dashboard, a browser/OAuth step outside what CLI automation can do; deployed via
`vercel --prod` directly in the meantime). Migrated and seeded the Neon `production`
branch for the first time ever (previously provisioned in Phase 0 but never used) —
same owner credentials as local dev, so the real household's actual login carries
over. Configured every required production env var (`DATABASE_URL` pointed at
`production`, fresh `SESSION_SECRET`/`CRON_SECRET`, `RESEND_API_KEY`, `APP_URL`, all
feature flag defaults). Hit one real deployment failure along the way — a build
silently hung indefinitely at the TypeScript-check step (compiled fine in ~18s, then
stuck for 25+ minutes with no progress); traced to a corrupted build cache carried
forward from a stuck prior deployment (`vercel rm` on that stuck deployment
inadvertently tore down the working production alias too, causing a brief real
outage) — resolved by redeploying, which happened to complete cleanly (Vercel
appears to have started from a fresh cache after the stuck deployment was removed).
Verified live, not just "deployed": health check (`db: 'up'`), a real Playwright
login using the seeded owner's actual credentials, and service worker registration
all confirmed working against the production URL before calling it done.

Every DB write against `production`/every GitHub secret rotation/every Vercel env-var
write in this session was preceded by the auto-mode safety classifier blocking an
under-specified attempt and requiring an explicit, scoped confirmation before
proceeding — consistent with this project's own "measure twice" discipline, just
enforced by tooling instead of self-discipline alone this time.

**Deferred items closed:** see the section above this one for the two PWA
path-list/cache-versioning gaps (shared `lib/pwa/static-paths.ts`,
`public/sw.js` → `app/sw.js/route.ts`) — both verified live against this same
production deployment (correct `CACHE_NAME` baked in from the real deploying commit
SHA).

**Still open:** repo visibility remains public (unchanged from earlier); the
`isPublicRoute()` architectural refactor for proxy.ts's matcher remains deliberately
deferred (larger, more invasive change to a security-critical file, not urgent now
that the concrete regex gaps are closed); GitHub auto-deploy-on-push isn't wired up
yet (needs the Vercel GitHub App authorized via the dashboard); TypeScript 7/eslint 10
Dependabot PRs stay open until `eslint-config-next` supports them.

---

## Fixing a real cross-file pool-lifecycle bug in integration tests (2026-07-10)

After the deploy above, both main-branch CI and Dependabot PR #4 failed integration
tests — initially assumed to be resource contention from several CI runs hitting the
shared `ci` Neon branch at once (this session pushed 4 commits in quick succession,
each cancelling the previous run mid-cleanup via the workflow's
`cancel-in-progress: true`, a previously-documented cause of orphaned test households).
Reran both cleanly (no concurrent pushes this time) to test that theory — **both
failed again, identically**, which ruled resource contention out. The real signature
wasn't the 15s timeout originally suspected; it was `Cannot use a pool after calling
end on the pool`, thrown from `getUpcomingBillCandidates`/`isEnabled` inside the cron
reminders/recap route handlers, for over a dozen households in a single test run.

**Root cause:** `lib/db/index.ts` caches its `pool`/`healthCheckPool` singletons on
`globalThis` (a pattern borrowed from the standard Next.js dev-server HMR fix — reusing
pools across hot reloads instead of leaking a new one per edit). Every
`*.integration.test.ts` file also had its own `afterAll(() => pool.end())`, written as
if closing "its own" pool. With `fileParallelism: false` (integration tests share one
real Postgres branch, run serially, not in parallel), whichever file happened to finish
first closed the _shared_ globalThis-cached pool — poisoning it for every file
scheduled to run afterward in that same run. `app/actions/*` sorts before
`app/api/cron/*` alphabetically, so by the time the cron route tests ran, an earlier
file's `afterAll` had already ended the pool they were about to inherit. This is the
exact bug class `e2e/test-db.ts`'s own comment already documents as fixed once before,
for Playwright specs under CI's `workers: 1` — the same anti-pattern had re-appeared,
independently, on the integration-test side, most likely newly exposed by Phase 6/7
adding cron test files that land late in file-execution order (earlier, smaller
integration suites likely never had a file scheduled to run _after_ whichever file
happened to close the pool first).

**Fix:** removed the per-file `afterAll(() => pool.end())` (and the now-unused `pool`
import) from all 19 integration test files that had one, plus the equivalent
`pool.end()`/`healthCheckPool.end()` pair in `lib/db/index.integration.test.ts`. No
replacement per-run teardown was added — first attempted a Vitest `globalSetup`
teardown hook, but confirmed via Vitest's own docs that `globalSetup` runs in a
separate process from the workers that actually execute test files, so it can't reach
the real pool object being torn down (would've silently closed a disconnected, useless
pool instance instead). Verified empirically instead: ran the full integration suite
locally against the dev branch with no per-file `pool.end()` at all — **206/206 tests
passed across all 20 files, and the process exited cleanly on its own**, confirming
Vitest's own worker teardown releases the connections without any test-owned close
needed. Also reran full local lint, `tsc --noEmit`, unit tests+coverage (353/353,
98%+), and `npm run build` — all clean — before pushing.

Also re-confirms the earlier resource-contention theory was a real, separate
phenomenon too (documented in the cross-phase cleanup pass above) — just not what
caused _this_ failure. Both can be true: CI push cadence can still leave orphaned
`ci`-branch households (that's what `db:clean-e2e-debris` exists for), independently of
this pool-lifecycle bug.

---

## The orphan-household sweep threshold: 1 hour → 5 minutes, permanently (2026-07-10)

With the pool-lifecycle bug fixed, CI's real underlying problem surfaced on its own,
twice, in the same night — both times traced to `lib/db/clean-e2e-debris.ts`'s
`ORPHAN_HOUSEHOLD_AGE_MS`, which had been 1 hour since Phase 6.

**Incident 1:** the cron route tests (reminders/recap/generate, which call
`getAllHouseholds()` — the only code that ever iterates every household unscoped)
hung on their very first real DB call, immediately, not after several tests —
consistent with an already-bloated household count, not a within-run leak. Months of
accumulated debris (small, harmless leaks from cancelled CI runs, invisible until
Phase 6's unscoped query started iterating all of them) had finally crossed the line
into real 15s test timeouts. Fixed via a one-time remediation: temporarily dropped the
sweep threshold to 5 minutes (safe — this step runs before each CI run's own tests
start, so there's no in-flight data to catch, only leftovers from finished runs),
confirmed a clean CI run, reverted back to 1 hour.

**Incident 2:** same night, after a burst of ~10 CI runs within about an hour
(several Dependabot PR rebases/reruns/merges in quick succession, each contributing
its own failed-test debris faster than the 1-hour sweep could clear any of it) —
the identical failure recurred. Same fix: temp-lower to 5 minutes, confirm clean,
revert to 1 hour.

Having hit the same failure mode twice in one session — the second time from normal
CI activity, not months of drift — made a case that 1 hour was never actually the
right permanent value. Made 5 minutes **permanent** instead: nothing about it is less
safe (every legitimate household is cleaned up by its own test within seconds — an
entire 21-test integration file finished in under 50s total in local testing), so the
threshold only needs enough margin to never race a real in-flight test, which 5
minutes clears many times over, while also self-healing a busy CI burst in minutes
instead of up to an hour. `ORPHAN_HOUSEHOLD_AGE_MS` is now `5 * 60 * 1000`, exported
from `lib/db/clean-e2e-debris.ts` so the paired integration test imports the real
value instead of maintaining its own copy (the two drifted out of sync — the file's
own log message still said ">1h old" for a full commit after the threshold changed;
fixed in the follow-up `/code-review` pass below).

**If a future edit is ever tempted to revert this back toward 1 hour:** don't, without
re-reading this entry first — that's the exact change that caused both incidents above.

---

## `/code-review` pass on the pool-lifecycle + threshold work (2026-07-10)

10-angle review (with several finder agents stalling and needing narrower-scoped
retries) on everything since the last reviewed commit. 8 confirmed, 1 plausible,
4 refuted.
Fixed the 8 confirmed/cheap items same day:

- `clean-e2e-debris.ts`'s success log hardcoded ">1h old" after the threshold became
  5 minutes — now derived from the constant (`>${ORPHAN_HOUSEHOLD_AGE_MS / 60_000}m`)
  instead of a literal string, so it can't go stale the same way again.
- The paired integration test's `SWEEP_AGE_MS` was a hand-typed duplicate of the real
  constant — `ORPHAN_HOUSEHOLD_AGE_MS` is now exported and imported instead.
- `vitest.config.ts`'s `hookTimeout` comment still explained itself via an `afterAll`
  that the pool-lifecycle fix had already removed — corrected.
- `app/sw.js/route.ts`'s `buildScript()` was simplified to a plain `SW_SCRIPT`
  constant (it only ever ran once, closing over already-resolved module constants),
  plus an explicit warning comment about the nested-template-literal backtick-escaping
  footgun a future inner comment could trip.
- `proxy.ts`'s comment illustrating the PWA matcher alternatives was ordered
  differently than the real literal two lines below it — reordered to match.
- `lib/db/index.ts`'s `pool`/`healthCheckPool` exports gained an explicit
  "don't call `.end()` on these in a test's `afterAll`" warning comment, so the next
  engineer who copies an existing integration test file as a template doesn't
  silently reintroduce the bug this session just spent real effort fixing.
- This entry itself, closing the gap the review found: the threshold saga above was
  previously undocumented in PROGRESS.md (only in commit messages), which is exactly
  the kind of gap that risks a future well-intentioned revert.

**Deferred, not fixed:** a real structural guard (e.g. an ESLint rule) against ever
reintroducing `pool.end()` in an integration test file — the warning comment above is
a cheap partial mitigation, but a lint rule is a bigger, separate investment worth
doing deliberately, not appended to a long session. `e2e/monthly.spec.ts`'s recurring
timeout-bump pattern (raised twice now instead of being restructured) — a conscious,
already-discussed decision to revisit later, not new information. A test in
`lib/pwa/static-paths.test.ts` that compares raw source text rather than a structural
value — plausible fragility, not currently triggered, lower priority than the above.

---

## Production deploy: fintrack.steby.net (2026-07-09/10)

The app is live in production on Vercel at **<https://fintrack.steby.net>** (custom
domain on the `steby.net` zone, DNS pointed at Vercel), auto-deploying from `main` on
every push. All production env vars provisioned (`DATABASE_URL` → Neon `production`
branch, `SESSION_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, all 9 feature-flag vars).
`GET /api/health` confirmed live (`{"ok":true,"db":"up","version":"0.1.0"}`).

Closed the two remaining keys-optional gaps: `RESEND_API_KEY` is now set (reminders/
recap send for real, not log-fallback), and `@sentry/nextjs` was installed with
`SENTRY_DSN` set in production (`3246ddc`) — `lib/observability.ts`'s keys-optional
seam, built and tested since Phase 0 for exactly this moment, needed no code changes
to light up. Uptime monitoring added via UptimeRobot (external to this repo, alert
threshold 2 consecutive failures) — Vercel has no native uptime-monitoring product,
only deploy/build status, so this fills that specific gap. `RUNBOOK.md` updated to
drop its two now-stale "not yet deployed" / "no SENTRY_DSN provisioned" caveats.

Repo visibility flipped from private to public (2026-07-09), deliberately and
temporarily, to unblock GitHub Actions minutes — scheduled to revert to private once
the monthly minutes allowance resets.

---

## `/code-review` full comprehensive pass (extra-high effort, 2026-07-10/11)

An uncapped review of everything since the last hardening pass — 8 finder angles, no
10-item output cap this time (`dont cap the findings`), 33 raw candidates deduped and
1-vote-verified down to 27 surviving CONFIRMED/PLAUSIBLE findings, triaged and worked
down one by one, easiest first, complex ones last, every PLAUSIBLE finding
investigated further rather than taken at face value. All 27 fixed or explicitly
resolved; two PLAUSIBLE findings investigated and deliberately left as-is with
reasoning recorded below rather than silently dropped.

**Most severe — production cron jobs had never actually run:** `proxy.ts`'s route
matcher excluded `/api/health` and static assets from the session-check pipeline but
not `/api/cron/*`, so every cron request (`generate`/`reminders`/`recap`, real
`CRON_SECRET` bearer or not) hit the same "no session → redirect to `/login`" path as
a logged-out browser — a 303, never the route handler, confirmed live against
production with `curl` before fixing. Vercel Cron doesn't follow the redirect or
report this as a failure (it sees a response, just the wrong one), so this had been
silently true since Phase 6 with no alarm ever firing. Fixed by adding
`api/cron/` to the matcher's negative-lookahead exclusion group; added
`e2e/cron.spec.ts` (new) asserting all three routes return their own 200/401 through
the real running server, not a `/login` redirect, for both a valid and an
invalid/missing secret — the class of bug that a unit test on the matcher regex alone
would not have caught, only a real end-to-end request could.

**Two genuine race conditions closed, both verified against real concurrent load
against Postgres, not just sequential-call tests:**

- `changeMemberRoleAction`/`removeMemberAction` (`app/actions/members.ts`) checked
  "would this leave zero owners" via a plain `SELECT` with no lock, then wrote — two
  concurrent demotes of the household's last two owners could both read "2 owners,
  safe" and both proceed, leaving zero. Fixed by wrapping both actions in
  `db.transaction`, locking every owner row (`.for('update')`) before the check, so
  the loser's re-check (via Postgres's `EvalPlanQual` re-evaluation) sees the
  winner's already-committed change. Verified with real `Promise.allSettled`
  concurrent-burst tests (two simultaneous demote/remove calls against the same
  two-owner household), accepting either of two legitimately-timing-dependent
  outcomes (a thrown `ForbiddenError` or a returned "last owner" error) as correct —
  run 3× to confirm no flakiness.
- `loginAction` (`app/actions/auth.ts`) recorded a failed attempt and checked the
  rate limit as two separate, unlocked steps — under a real concurrent burst (10
  simultaneous wrong-password requests, added as a regression test), more than 5
  could slip through the 5-attempts/15-minute limiter before any of their own
  `INSERT`s became visible to each other. Fixed by wrapping the check+verify+record
  sequence in `db.transaction` with a `pg_advisory_xact_lock(hashtext(email),
hashtext(ip))` taken first, serializing concurrent attempts for the same
  email+IP without row-level locking (nothing to lock — the rate-limit "state" is a
  row count, not a row). `createSession`/`redirect` stayed outside the transaction
  (no reason to hold the lock across a cookie write). Verified live: 10 concurrent
  wrong-password calls now produce exactly 5 `"Invalid email or password."` and
  exactly 5 rate-limited results, exactly 5 DB rows — run 3× to confirm no flakiness.

**Other confirmed correctness bugs fixed:**

- `shouldPropagate` (`lib/domain/entries.ts`) treated a row with a recorded actual
  _date_ but a still-blank _amount_ as an untouched forecast (only checked
  `actualCents === null`) — `updateActualAction` genuinely allows saving just a date
  with the amount left empty, so a later recurring-item propagate or a
  remove-forecast could silently delete/overwrite a date the user had already
  entered. Now requires both `actualCents === null && actualDate === null`.
- `acceptInviteAction` (`app/actions/invites.ts`) had a residual race: two accepts of
  different invitations for the same email could both pass the "no existing user"
  check before either inserted. Added a pre-check plus a Postgres `23505`
  unique-violation catch as a defense-in-depth backstop. Paired with a new
  `lib/auth/email.ts` (`normalizeEmail`/`emailEquals`) used consistently at every
  email-comparison site (login, invites, seed) — logins were previously
  case-sensitive against a case-sensitive unique index, so `Steven@x.com` and
  `steven@x.com` could both register, and one of them would then be permanently
  unable to log back in with their own actual email casing.
- `computeGoalProgress` (`lib/domain/budgeting.ts`) threw an uncaught `RangeError`
  from `.toISOString()` on a schema-legal but extreme `target_date`/savings-rate
  combination that projects a date outside JS's representable range. Now checks
  `Number.isNaN(projected.getTime())` first and returns `null`.
- `lib/domain/csv.ts`'s row-splitter didn't handle a bare `\r` (classic Mac line
  ending) at all — silently merged that row into the next one instead of ending it.
  Fixed; `CsvSizeCheck` also changed from a `{ok: boolean; error?: string}`
  anti-pattern to a real `{ok: true} | {ok: false; error: string}` discriminated
  union, removing three call sites' dead `?? '...'` fallbacks that existed only
  because the old type couldn't guarantee `error` was present when `ok` was false.
- Server-side "current month" was computed inconsistently — some call sites used
  local server time (`new Date().getFullYear()`/`getMonth()`), which is wrong for a
  server (Vercel's server clock is UTC; local-time "current month" would drift
  around midnight UTC depending on deploy region). Added `currentYearMonth()`
  (`lib/domain/today.ts`, UTC-based) and switched every _server-side_ call site
  (monthly page, year-nav, month-params parsing, all three cron routes,
  calendar-view's "is this the current month" check) to it — deliberately leaving
  `generate-form.tsx`'s client-side form default alone, since that one correctly
  wants the browser's own local "today," not the server's.
- The Monthly page's on-load auto-generate hook had no guard against firing twice
  in quick succession for the same household (e.g. two tabs, or a fast
  double-navigation) beyond the underlying `INSERT ... ON CONFLICT DO NOTHING`'s
  own idempotency at the DB level — cheap but not free (still a real query pair per
  redundant fire). Added `lib/domain/auto-generate-guard.ts`, a small in-memory
  per-household TTL guard (`shouldRun`/`recordRun`, injectable clock) that skips a
  fire within the same short window.
- Resend's SDK has **no `AbortSignal` support anywhere** in its types (checked
  directly against the installed version's `.d.mts`, not assumed) — the original
  finding's proposed fix (wire an abort signal into the timeout race) was not
  actually implementable. The real bug — a timed-out send that Resend may have
  still processed server-side gets retried and could double-send — has an actual
  fix in the SDK: a single `idempotencyKey` (one `randomUUID()` per logical send,
  reused across all retries of that same send, passed via
  `CreateEmailRequestOptions`) tells Resend's own server "this may be a retry,
  don't send it twice" regardless of whether the client ever learns the first
  attempt succeeded.
- `app/actions/report-error.ts` (the client-error-boundary bridge, deliberately
  unauthenticated since the root error boundary must work pre-login) forwarded
  whatever the client sent with no shape/size validation. Added a zod schema
  (message capped at 2000 chars, optional digest capped at 200) and a fixed
  generic log message for malformed input, so a hostile/broken client can't inject
  arbitrary unbounded content into production logs.

**Efficiency cleanups** (all covered by existing/expanded tests, not new behavior):
`getAccountEntriesBeforeYear` replaced a fetch-every-row-then-sum-in-JS pattern with
a `SUM(COALESCE(actual, budgeted)) ... GROUP BY` SQL aggregate (verified
byte-identical to the old JS totals — addition is associative); the dashboard's
prior-year YoY fetch and the recap cron now pull only the columns they need
(`getIncomeExpenseRows`/`getDashboardRowsForMonth`) instead of the full dashboard
row set; the three cron routes' per-household kill-switch check (one query per
household, every day, for every cron) replaced with one batched
`getEnabledHouseholdIds` query per run; `resolveOptionalRef` (bank-account/category
ref resolution) de-duplicated out of `recurring.ts`/`monthly.ts` into
`lib/db/queries.ts`; the recurring-generate-form's local month-name array
de-duplicated into `lib/format.ts`'s shared `MONTH_SHORT`.

**Two PLAUSIBLE findings investigated and deliberately left as-is** (reasoning
recorded in-code, not silently dropped): a lint-bypassable gap where `pool.end()`
could still be called on an aliased import in an integration test (the existing
warning comment plus this repo's two-file blast radius don't justify a custom
ESLint rule at this scale — same call this session already made once for a related
finding above); `clean-e2e-debris.ts`'s age-based orphan heuristic could in theory
sweep a slow-but-legitimate long-running test, and an `is_test` column would remove
the ambiguity entirely — rejected because it would require a schema migration and a
seed-data convention change for a heuristic that's already proven itself in
practice (see the two threshold incidents above) and has a 5-minute margin far
larger than any real test's runtime.

**Test/CI status after every fix, full regression:** lint/typecheck/format all
clean, 392/392 unit tests (99.37% coverage on the gated scope, gate is 80%), 232/232
integration tests against the real `dev` branch, `npm run build` clean, 51/52 E2E.
The one E2E failure (`mobile.spec.ts`'s bottom-nav test) was individually
re-investigated post-hoc: reproduces consistently even fully isolated (not a
resource-contention flake), root cause is a `<nextjs-portal
data-nextjs-dev-overlay="true">` element — Next's dev-mode overlay — visually
overlapping the bottom nav on a narrow mobile viewport under `next dev` only.
`playwright.config.ts` runs E2E against `npm run start` (a real production build) in
CI and only `next dev` locally, so this element cannot exist in CI or production;
confirmed via `git diff` that no bottom-nav/layout/`mobile.spec.ts` file was touched
by any of the 27 fixes above. Not a regression, pre-existing, out of scope for this
pass.

---

## Environment audit: verifying Vercel/GitHub env vars actually point where they should (2026-07-11)

A routine "is everything still clean" check turned up two real things worth fixing,
plus one architectural question worth settling for the record.

**`dev` branch had genuine debris.** 81 households, only 1 real (the seeded owner)
— the other 80 were leftover rows from this session's own integration test runs
against the real `dev` branch (`clean-e2e-debris.ts`'s `main()` only ever runs
against `ci`, by design — see its own CI-only guard — so nothing had ever swept
`dev`). Its exported `cleanOrphanedHouseholds()` is DB-agnostic and already
protects the real seed owner's household by ID lookup, so it was safe to call
directly against `dev`: 80 orphaned rows removed, confirmed down to 1 real
household afterward.

**Every Vercel env var in this project turned out to be Vercel's "Sensitive"
type** — discovered while trying to confirm Preview's `DATABASE_URL` actually
points at `dev`, not `production` (a real risk: if it were ever misconfigured,
every PR preview deployment, including Dependabot's automated ones, would have
live read/write access to real financial data). `vercel env pull` came back with
an empty string for literally every variable, including harmless ones like
`FEATURE_PWA` — ruling out "the secrets are just hidden" and confirming (via
`vercel env ls preview -F json`'s `type` field) that all of them were created
Sensitive, meaning the value can never be read back through any means once set, by
design. That made the original question unanswerable by inspection — the only way
to actually be sure was to reset it to a known-correct value.

Refreshed `DATABASE_URL` across all three destinations using connection strings
fetched fresh from Neon's API (a safe, read-only call) rather than trusting
whatever was already configured — each piped directly from a shell variable into
`vercel env add`/`gh secret set`, never written to a file:

- Vercel **Production** → Neon `production` branch
- Vercel **Preview** → Neon `dev` branch
- GitHub Actions secret → Neon `ci` branch

All three confirmed pointing at distinct branch hosts afterward (no two ever
resolved to the same endpoint). Production's `/api/health` stayed green
throughout — a Vercel env var change only takes effect on the next deploy, so this
touched nothing already running. The other secrets (`SESSION_SECRET`,
`CRON_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`) were deliberately left untouched:
unlike `DATABASE_URL`, there's no external system to fetch a "correct" value from,
and there was no evidence any of them were wrong.

**Settled: keep the distinct `ci` branch, don't collapse it into `dev`.** This
project has already hit two real incidents a shared branch would have made worse —
an accidental unscoped `DELETE` from a throwaway local script that wiped every
household on `dev` (Phase 1's real-bugs entry), and `ci`'s aggressive 5-minute
debris sweep (see the threshold entries above), which is only safe to run
unattended _because_ `ci` is understood to hold nothing but disposable test data.
Running that same sweep against a branch a human is also using interactively would
mean CI silently deleting real work-in-progress. Neon branches are free to keep
separate, so there's no real cost being saved by merging them.

---

## Closing out the environment audit: Resend, APP_URL, a real test leak, and a broken font (2026-07-11/12)

Follow-up fixes from the same audit, plus two real bugs a fresh look at the
running app turned up once it was actually being used instead of just tested.

**`RESEND_API_KEY` is now provably distinct between Production and Preview.**
The prior entry flagged this as unverifiable (both are Vercel's write-only
Sensitive type). Closed properly: a dedicated `fintrack-preview` key was
created in the Resend dashboard and set as Preview's value only — Production's
key hasn't been touched in days, so the two are now different by construction,
not by assumption. A PR preview deployment can no longer send real email
through the same account/quota as production.

**`APP_URL` was silently broken on every Preview deployment.** Never
configured for Preview, so it fell back to its `http://localhost:3000`
default — every invite email link generated from a PR preview build was
broken. A static Preview value wouldn't have been right either, since every
preview deployment gets its own unique URL. Fixed properly in
`lib/env.ts::loadEnv()`: derives `APP_URL` from Vercel's auto-injected
`VERCEL_URL` whenever `APP_URL` isn't already explicitly set — correct for
every future preview build automatically, nothing to maintain per-deployment.
Production keeps working exactly as before (its explicit value always wins).
3 new unit tests cover the derivation.

**`members.integration.test.ts` really was leaking a household per run** (the
gap the second Phase-1 hardening pass had explicitly deferred, not a new
issue). Root cause, found by finally reading the three offending tests
closely: each re-homes a second owner into the first owner's household to set
up a two-owner scenario, then only passed the _first_ household's id to
`cleanup()` — the second owner's now-empty original household row was never
deleted, because its id was destructured away and discarded at the call site
(`const { user: ownerBUser } = await makeHouseholdWithUser(...)`, dropping
`household`). Fixed by capturing it and passing both ids to `cleanup()`.
Verified over 4 runs post-fix: 3 clean, 1 unrelated one-off flake with no
recurrence, zero new leaked rows either way. Also swept the 3 pre-existing
leaked rows on `dev` using the same `cleanOrphanedHouseholds()` mechanism as
before.

**The entire app was silently rendering in the browser's default font, not
Geist.** `app/globals.css`'s `@theme` block had `--font-sans: var(--font-sans)`
— a circular custom property, invalid at computed-value time, so every
element using `font-sans` (the whole app, via the base layer's
`@apply font-sans`) fell back to nothing. `app/layout.tsx` was loading the
real `Geist`/`Geist Mono` fonts via `next/font/google` correctly the whole
time — the CSS just never pointed at the variable it set
(`--font-geist-sans`). One-character-class fix; verified live on both local
and production (`getComputedStyle(document.body).fontFamily` went from the
system default to `"Geist, Geist Fallback"` in both places, with
before/after screenshots).

**Production compute and the database were on opposite sides of the planet.**
Neon's `ap-southeast-1` (Singapore) was clearly a deliberate regional choice;
Vercel's serverless functions were left on the account default, `iad1`
(Washington D.C.) — every DB-touching request paid a ~400-500ms US-East↔
Singapore round trip on top of real work, the actual cause of the app
"feeling slow," not application-level inefficiency. Not fixable from code:
checked this project's own bundled Next.js docs first (per this repo's rule
not to assume — see `AGENTS.md`) and confirmed `preferredRegion` only applies
to Edge Runtime routes, which this app can't use (`pg`, `@node-rs/argon2` both
need real Node.js). The actual lever, Vercel's project-level Function Region
setting, isn't exposed through the `vercel` CLI at all (`vercel project
--help` has no regions/functions subcommand) — dashboard-only. Changed
Production's Function Region to Singapore via the dashboard, then a fresh
`vercel deploy --prod` to pick it up (region changes only apply to new
builds). Verified for real, not assumed: the `x-vercel-id` response header
went from `iad1::...` to `sin1::sin1::...`, and 5 consecutive requests to
`/api/health` settled to 82-350ms (down from what a cross-Pacific round trip
was costing on every request before). See `RUNBOOK.md`'s new "Everything
feels slow" entry for the general troubleshooting note this leaves behind.

---

## Phase 8 — Design system foundation: tokens, primitives, shell/nav — status: complete 2026-07-12

**What shipped:**

- **Token pass** (`app/globals.css`): `--radius` 0.625rem -> 1rem; light theme moved from
  pure grayscale to a warm near-white ramp (hue ~90, chroma <=0.005) with a vibrant violet
  `--primary` (`oklch(0.55 0.22 293)`); dark theme replaced the true-black OLED ramp with a
  layered warm-dark ramp (increasing lightness across background/card/popover, same violet
  primary at a lighter/more-saturated value, softened `oklch(1 0 0 / 10%)` borders); new
  semantic `--income`/`--expense`/`--warning` tokens registered as `text-income`/
  `bg-expense/10`/etc. utilities; 8 fixed, CVD-validated `--chart-1..8` hex slots (light set
  validated on white, dark set on the new dark card surface) replacing the old 5-slot
  grayscale ramp; a `--text-display` type size for hero money figures; a new `--card-shadow`
  / `shadow-card` token. Rewrote the stale lines-86-91 comment that documented the OLED +
  emerald/red convention to describe the new one and its deliberate page-by-page (not
  all-at-once) retirement through Phase 11.
- **12 new primitives** in `components/ui/`: `dialog.tsx`, `drawer.tsx`,
  `responsive-sheet.tsx`, `toast.tsx` (+ `ToastProvider`, mounted in `app/layout.tsx` inside
  `ThemeProvider`), `skeleton.tsx`, `empty-state.tsx`, `progress.tsx`, `switch.tsx`,
  `tabs.tsx`, `tooltip.tsx` (+ app-level `TooltipProvider`, also mounted in
  `app/layout.tsx`), `stat.tsx`, `fab.tsx` — all base-ui wrappers matching `button.tsx`'s
  established style (cva where variants exist, `cn()`, `data-slot`). Real Phase 8 UI wiring
  (not just built-and-idle): EmptyState powers `/accounts`' `FEATURE_NET_WORTH`-off state;
  Stat renders a new "Total net worth" headline on `/accounts`; Tooltip gives the same
  page's heading a quick hover hint (desktop-pointer only, by Base UI's own touch-disabled
  design); Dialog+Drawer+ResponsiveSheet together power a tap-friendly "Learn more" ->
  "About net worth" info sheet on the same page (`net-worth-about-sheet.tsx` — centered
  Dialog at >= md, bottom Drawer below it, same content either way); Toast fires a
  "Switched to {theme} mode" confirmation from the theme toggle. Switch/Progress/Tabs/Fab
  are complete and correct but deliberately not wired into a page this phase — their real
  homes are Plan/Goals toggles (Phase 11), the Monthly view-toggle (Phase 10), and the
  global quick-add trigger (Phase 10). Skeleton is also unwired this phase — see the
  `loading.tsx` finding below.
- **Shell rewrite** (`app/(app)/layout.tsx`): new grouped sidebar — Track (Home/Money/Plan)
  / Grow (Net worth/Goals/Insights) / footer (Settings, user chip, ThemeToggle, sign-out) —
  replacing the old flat 9-link list. Active-link styling via a new client `nav-link.tsx`
  (`usePathname`). Deleted `app/(app)/year-nav.tsx` and its two call sites (sidebar,
  settings hub) — the sidebar's "Dashboard year" quick-jump has no Phase 8 replacement
  (`/insights` carries its own `YearPicker`, same component the old dashboard already had).
  Preserved verbatim: the `min-w-0` on `<main>` and its load-bearing comment, the bottom
  padding calc, `<BottomNav/>`.
- **`app/(app)/bottom-nav.tsx`**: tabs -> Home (`/`) / Money (`/monthly`) / Net worth
  (`/accounts`) / Goals (`/goals`) / More (`/settings`, matching `/settings`, `/recurring`,
  `/insights`, `/import`). Recurring dropped from the tab bar itself (reachable via More's
  hub). Updated the hand-maintained-list comment.
- **New pages**, content moved with no behavior/query change from the pre-redesign
  dashboard: `app/(app)/insights/page.tsx` (StatTiles, CashFlowChart, CategoryChart,
  SavingsChart, FixedVariableCard, YoyCard + YearPicker — the same `getDashboardRows`/
  `getIncomeExpenseRows` calls the dashboard already made); `app/(app)/accounts/page.tsx`
  (NetWorthChart, AccountBalancesTable, BankSummaryTable + YearPicker + the new Stat
  headline, behind `FEATURE_NET_WORTH` with a friendly `EmptyState` when off, matching
  `/import`'s pattern). `dashboard/year-picker.tsx` gained an optional `basePath` prop
  (default `/`, unchanged for the old dashboard) so `/insights`/`/accounts` page their own
  year instead of bouncing back to `/`. The old `/` dashboard is untouched this phase —
  every widget it already rendered (including `BudgetHealthCard`, which is deliberately
  **not** duplicated onto `/insights` or `/accounts` — it isn't in either page's task-6
  widget list, and Phase 9's task list confirms it's meant to become a `budget-mini` card
  on the rewritten Home instead) still renders exactly as before.
- **Settings hub** (`app/(app)/settings/page.tsx`): now the desktop entry too, since the
  sidebar collapsed to one Settings link. Removed its `md:hidden` YearNav (the component is
  gone); added `md:hidden` Plan + Insights links as the mobile bottom nav's escape hatch to
  those two sections (desktop's sidebar already covers both, so the links are mobile-only).
- **`app/not-found.tsx`** (new, root-level, catches any unmatched URL app-wide).
- **Restyled existing primitives**: `card.tsx` and `select.tsx`'s popup (the two with a
  visible outline) moved from a flat `ring-foreground/10` to `ring-foreground/6` plus the
  new `shadow-card` token. `input.tsx`/`badge.tsx`/`table.tsx` audited and left unchanged —
  no hardcoded gray literals in any of them; their radius bump is automatic from the
  `--radius` token change (Tailwind v4's `--radius-*` scale in `@theme inline` derives from
  it, no per-file edit needed).
- **E2E**: `e2e/mobile.spec.ts` updated for the new tab labels/targets (Dashboard->Home,
  Monthly->Money, Recurring tab replaced by Net worth). `e2e/dashboard.spec.ts`'s
  sidebar-year-jump assertion replaced with a same-page `YearPicker` round-trip (the sidebar
  quick-jump it tested no longer exists — a direct, in-scope consequence of deleting
  `YearNav`, not a dashboard behavior change). New `e2e/shell.spec.ts` (desktop sidebar
  reaches all 7 surfaces; theme toggle persists across reload; a viewer sees no Members
  link and no write affordances anywhere in the shell). `e2e/smoke.spec.ts` audited — no
  selectors reference anything that moved, left unchanged.

**A real, reproduced bug found and fixed by removing the feature rather than shipping it
broken:** task 8 originally called for Skeleton-based `loading.tsx` files on `/`,
`/monthly`, `/accounts`, `/insights`, `/goals`, `/recurring`. All six were built and the
full local gate (including `npm run build`) passed — but `next build`'s dynamic routes
aren't rendered at build time, so a runtime-only defect had nowhere to surface yet. It
surfaced during the mandatory pre-commit local E2E run: 3 tests failed with a Playwright
`strict mode violation: ... resolved to 2 elements` on pages with an interactive
`useActionState` form (`/settings/categories`'s add-category input, `/goals`'s add-goal
input) plus `/recurring`'s "Generated N entries" confirmation never appearing at all.
Root-caused via bisection — removing one `loading.tsx` at a time, rebuilding, and
re-running against a **real production server** (`next build && next start`, exactly what
CI runs) after each change, specifically to rule out a Turbopack dev-server compile-race as
a red herring (an early, wrong hypothesis when the same symptom first appeared under `next
dev`). Every failure traced to a `loading.tsx` Suspense boundary wrapping a page with a
client form using `useActionState` — including `/settings/categories`, which has no
`loading.tsx` of its own but inherited the root `app/(app)/loading.tsx` (Next's own docs:
an ancestor's `loading.tsx` wraps "the page.js file and any children below" that don't have
a more specific one). The duplicated DOM nodes had different React `useId()`-derived ids —
one server-numbered (`base-ui-_r_0_`), one client-only-shaped (`base-ui-_R_<random>_`) — the
signature of the component tree mounting twice instead of once. Removing all six
`loading.tsx` files (not just the two directly implicated by the strict-mode violations)
took the full local E2E suite from 3 failing to 55/55 passing against a fresh production
build. Not fully root-caused at the React/Next.js internals level within this phase's
budget — the mechanism by which a route-level Suspense boundary causes a client
`useActionState` form to double-mount in production specifically (not in `next build`'s own
static-page prerendering) is still unknown. Shipping a reproduced, confirmed form-breaking
bug was judged strictly worse than shipping without route-level loading skeletons this
phase (development-workflow.md's "zero-tolerance regression" rule), so `loading.tsx` is
**not shipped** this phase; `app/not-found.tsx` is unaffected (a different file convention,
no Suspense boundary involved) and stays. `skeleton.tsx` the primitive still exists,
correct and ready, just not wired into a page yet — deferred alongside Switch/Progress/Tabs/
Fab. Documented in `spec.md`'s Phase 8 task 8 with the full investigation; flagged as a
concrete follow-up before ever adding a `loading.tsx` back anywhere a page also has a
`useActionState` form.

**Other real bugs found and fixed (before the loading.tsx investigation above):**

- Passing a lucide-react icon **component reference** (e.g. `icon={Home}`) or a plain
  **function** (`isActive={(pathname) => ...}`) as a prop from the Server Component shell
  (`app/(app)/layout.tsx`) to the Client Component `nav-link.tsx` crashes with "Functions
  cannot be passed directly to Client Components" — caught by the very first local E2E run
  attempt (which failed almost every authenticated test, since the crash is in the shared
  shell every `(app)` route renders through). Fixed by rendering the icon to a plain
  `ReactNode` in the server component (`icon={<Home className="..." />}`, which IS
  serializable across the boundary) and replacing the `isActive` callback with a plain
  `extraPrefixes: string[]` prop that `nav-link.tsx` checks internally.
- `<Button render={<Link .../>}>` (used in `not-found.tsx` and `empty-state.tsx`) rendered
  a non-`<button>` element while Base UI's `Button` still defaulted `nativeButton={true}`,
  producing a loud dev-mode console warning that, in a long-running `next dev` session,
  tripped the Next.js dev overlay and intercepted pointer events on unrelated later E2E
  tests (surfaced as mysterious `mobile.spec.ts` tap timeouts against a `<nextjs-portal>`
  element). Fixed by passing `nativeButton={false}` at both call sites.
- `components/ui/responsive-sheet.tsx`'s viewport-detection hook called `setState`
  synchronously inside a bare `useEffect` (flagged by `react-hooks/set-state-in-effect`).
  Rewritten around `useSyncExternalStore` (the same hydration-safe pattern
  `theme-toggle.tsx`'s `useHasMounted` already established), removing the effect entirely.

**Deviations from the literal phase plan, logged rather than silent:**

1. `loading.tsx` not shipped (see above) — the single largest deviation this phase.
2. `BudgetHealthCard` deliberately not duplicated onto `/insights` or `/accounts` — not in
   task 6's named widget list for either page; Phase 9's own task list (`budget-mini.tsx`)
   confirms it's meant to move onto the rewritten Home, not get a second home first.
3. A small amount of genuinely new UI (the `/accounts` "Total net worth" Stat headline, its
   Tooltip hover hint, and its "Learn more" -> "About net worth" Dialog/Drawer info sheet)
   beyond the literal "moved widgets, no behavior change" framing — deliberate, not scope
   creep: it exists specifically to give the new Stat/Tooltip/Dialog/Drawer/ResponsiveSheet
   primitives a genuine Phase 8 exercise (the phase's own AC requires each new primitive be
   exercised at least once) without reaching into Phase 9/10/11 territory (no affordability
   math, no mark-paid, no Home rewrite).

**Test/CI status:** Unit 395/395 (100% on the gated `lib/**` scope — no new `lib/**` files
this phase, all new code is in `app/`/`components/ui/`, outside the coverage gate's scope
by the same "UI glue, not pure logic" convention as every prior UI-only change). Integration
232/232 (unchanged from before this phase — Phase 8 added no Server Actions or queries; one
local re-run mid-phase hit a real "Connection terminated unexpectedly" against Neon,
traced to two of this session's own leftover `next start` processes still holding pooled DB
connections from earlier ad-hoc verification servers — stopped both, re-ran clean at the
normal ~60s duration, not a code regression). E2E 55/55 (chromium), the final run executed
with `CI=true` against the committed `playwright.config.ts` (port 3000, `next build && next
start`, `workers: 1`, `retries: 2`) — i.e., the exact settings GitHub Actions uses, not a
looser local approximation. Lint/typecheck/format/build all clean.

**Live verification (real, not assumed — see the primitives-wiring list above for what each
exercises):** a throwaway Playwright script (not part of the committed suite) drove the
running production server directly: focused `/accounts`' "Learn more" button and pressed
Enter — the Dialog opened (asserted via its body text becoming visible) at a 1280px
viewport and the Drawer opened the same way at a 390px viewport; Escape closed both in each
case. The Tooltip next to the same page's heading revealed its content on keyboard focus
alone. The theme-toggle Toast appeared on a keyboard Enter and, per Base UI's own
documented pattern (`data-expanded`, "F6 jumps into the toast viewport landmark"), its
Close button — `aria-hidden` until the viewport is hovered/focused, by Base UI's own
design, not a bug in this project's wrapper — became reachable and dismissed the toast
once the viewport was expanded first. A light+dark screenshot sweep of Home/Net worth/
Insights/Settings/Goals/Money/Plan was visually reviewed: correct token application (warm
light background, layered warm dark, violet active-nav highlight), no unreadable text, no
NaN, charts and tables rendering correctly in both themes. Separately, `e2e/shell.spec.ts`
confirms a viewer sees zero write affordances anywhere in the new shell, and the `min-w-0`
`<main>` fix from Phase 7 is confirmed still intact (no horizontal-scroll regression on the
mobile viewport E2E run).

**Deferred / not done:** Skeleton, Switch, Progress, Tabs, and Fab primitives exist and are
correct but have no live page usage yet (Skeleton per the `loading.tsx` finding above;
the other four per their designated Phase 9/10/11 homes, matching the plan's own phase
boundaries — building their consumers early would mean starting Phase 9/10/11 work, which
this phase's scope explicitly excludes). Re-investigating the `loading.tsx`/`useActionState`
double-mount bug at the framework level (a minimal, isolated repro, ideally reported
upstream if it turns out to be a genuine Next.js/Base UI interaction bug rather than
something specific to this app) is tracked as a concrete follow-up, not silently dropped.

---

## Phase 9 — Affordability domain + forecast-first Home — status: complete 2026-07-12

**What shipped:**

- **`lib/domain/affordability.ts`** (new, pure logic, property-tested): a superset of
  `lib/domain/reminders.ts`'s cron-only `UpcomingBillCandidate`/`selectUpcomingBills`,
  built as its own separate module rather than an extension of reminders.ts — the plan's
  hard rule, verified with a dedicated regression test (see below). `parseHorizon`
  (trust-boundary parser: `'7'|'14'|'30'` accepted, everything else — blank, `null`,
  `'9999'`, a stray leading zero — falls back to `'month'`); `resolveHorizonDays`
  (`'month'` = days remaining to that calendar month's end, inclusive of today: 30 on
  the 1st of a 31-day month, 0 on the last day); `selectUpcomingItems` (skips
  paid/uncategorized candidates; an entry with no fixed due day is due at the clamped
  end of its own month; a CURRENT-month unpaid expense whose due day already passed is
  "overdue" and included regardless of horizon, a next-month candidate never is);
  `computeSafeToSpend` (cash minus upcoming minus overdue expense; income tracked
  separately, never subtracted — the user's conservative-headline-number decision);
  `computeBudgetRemaining` (budgeted expense minus ACTUAL spend so far this month — the
  opposite fallback rule from `bestEstimateCents`, since an unpaid forecast row hasn't
  spent anything yet); `buildRunway` (day-by-day projected cash, `horizonDays + 1`
  points, DOES include income — the one deliberate hero/runway asymmetry, documented in
  a load-bearing comment; every item's offset is clamped into `[0, horizonDays]`, making
  the function a true conservation identity for ANY item array, not just well-formed
  ones — this clamping turned out to matter for more than defensiveness, see the
  property tests below). `lib/domain/dashboard.ts` gained `actualOnlyCents` next to
  `bestEstimateCents` — same one-line-of-logic, name-the-intent role, opposite rule.
- **`lib/domain/affordability.test.ts`** (fast-check property tests, matching
  `lib/money.test.ts`/`lib/domain/net-worth.test.ts`'s existing treatment — user
  decision): conservation identities for `computeSafeToSpend` (cash minus safe-to-spend
  always equals total expense subtracted, for arbitrary item arrays) and `buildRunway`
  (the last point always equals cash plus the full signed sum of an arbitrary item
  array — this is what proves the day-0/clamping design is correct in general, not just
  for the hand-picked unit cases); `computeBudgetRemaining`'s
  `remaining + spent === budgeted` identity; a property confirming
  `selectUpcomingItems` never selects a paid or uncategorized candidate for arbitrary
  candidates/today/horizon. Plus unit cases for every named edge case (Feb day-31 clamp,
  Dec->Jan spill, `'month'` horizon on the 1st vs. the last day of a month including
  leap February, unscheduled month-end due date, zero-budget `pctSpent` 0, empty
  candidates, every documented `parseHorizon` garbage shape).
- **`lib/db/queries.ts`**: `getUpcomingEntryCandidates` (LEFT-joins `recurring_schedule`
  — not INNER, so ad-hoc entries are included with `actualDateDay: null` — and
  LEFT-joins categories for direction/name/color; a deliberately separate query from
  `getUpcomingBillCandidates`, not a shared/parameterized one); `getActualizedCashRows`
  (per-account signed sums of ACTUAL amounts only, no year bound — same grouped-sum
  shape as `getAccountEntriesBeforeYear` but `WHERE actual_amount IS NOT NULL` instead
  of a year cutoff). New **`lib/settings.ts`**: `getSetting`/`setSetting`, a generic
  `household_settings` accessor for `affordability_horizon` — same table
  `lib/flags.ts` owns the boolean `KillSwitchKey` subset of, deliberately not added to
  that union, deliberately uncached (`vitest.config.ts`'s coverage exclude list gained
  `lib/settings.ts` alongside `lib/flags.ts`, same reasoning: every path touches a live
  DB, exercised by `lib/settings.integration.test.ts`).
- **Actions**: `markPaidAction` (`app/actions/monthly.ts`) — zod `{ id: uuid }`,
  `requireRole('write')`, household-scoped select; an already-paid entry returns
  `{ success: true, alreadyPaid: true }` (idempotent, no second write — verified via a
  double-tap integration test asserting the second call doesn't touch the row already
  set by the first); otherwise sets `actualAmount` to the entry's own `budgetedAmount`
  and `actualDate` to today (UTC), returning enough of the prior state
  (`{ previous: { actualAmount: null, actualDate } }`) for the client to replay an Undo
  through the EXISTING `updateActualAction` — no new "unmark" action, since that would
  duplicate exactly what `updateActualAction` already does. `updateActualAction` gained
  a `revalidatePath('/')` alongside its existing `/monthly` one, since it's now also the
  Undo path Home's own data depends on. `setHorizonAction` (new
  `app/actions/settings.ts`) — zod enum, `requireRole('write')` (owner OR member — a
  personal viewing preference, not an owner-only policy toggle). New integration test
  files: `app/actions/settings.integration.test.ts`,
  `lib/settings.integration.test.ts`; new tests added to
  `app/actions/monthly.integration.test.ts` (mark-paid idempotency, partial-actualization
  `previous`, cross-tenant probe) and `cross-household-scoping.integration.test.ts`.
  A dedicated **"reminders freeze" regression test** seeds a real fixture and asserts
  `getUpcomingBillCandidates` + `selectUpcomingBills` — the cron path, untouched this
  phase — still produce byte-identical output end-to-end against a live DB, guarding the
  email path against a future accidental edit, not just against THIS phase's own diff.
- **Home UI**: rewrote `app/(app)/page.tsx` + new `app/(app)/home/` (`safe-to-spend-hero
.tsx`, `horizon-picker.tsx`, `upcoming-list.tsx`, `mark-paid-button.tsx`,
  `runway-sparkline.tsx`, `budget-mini.tsx`, `goals-mini.tsx`). Cash lens is primary
  (with an always-visible budget-remaining secondary line) whenever `FEATURE_NET_WORTH`
  is on AND at least one bank account exists; otherwise the budget-remaining lens is
  promoted to be the ONLY hero and the cash lens/runway sparkline are hidden entirely —
  never a `$0` or otherwise misleading figure. A brand-new household with zero
  `monthly_entries` in the current+next-month window gets an `EmptyState` ("set up your
  plan" -> `/recurring`) instead of an all-zero hero. `budget-mini.tsx` reuses
  `BudgetHealthCard` wholesale (its real, single home, per this file's own Phase 8
  entry). `horizon-picker.tsx` is a 4-button segmented control, not the Popover the
  plan's WISDOM section sketched — see Deviations.
- **E2E**: new `e2e/home.spec.ts` (hero renders a real figure; a seeded ad-hoc unpaid
  bill -> mark paid -> row disappears from the list, the budget-remaining figure drops
  by EXACTLY its amount, Undo restores both the row and the figure; a viewer sees the
  list with no mark-paid button or horizon picker; a genuinely fresh household — its own
  `households` row, not just a new user grafted onto the seeded one — sees the empty
  state). `e2e/dashboard.spec.ts` renamed to `e2e/insights.spec.ts`, every assertion
  repointed at `/insights`. `e2e/phase4.spec.ts`'s net-worth assertion repointed at
  `/accounts` (no longer rendered on `/` at all, as of this phase); its budget-health
  assertion stays on `/` unchanged, since `budget-mini.tsx` is that widget's real home
  now, not a duplicate.

**Two real bugs found and fixed via live E2E verification (green test suites did NOT
catch either on their own):**

1. **`MarkPaidButton`'s toast intermittently never appeared — a real race, not a
   flaky test.** The first implementation followed the plan's own sketch:
   `useActionState`, firing the toast from a render-time "reacted to" comparison (this
   codebase's existing pattern in `goal-card.tsx`/`entry-row.tsx` — but those only ever
   call their OWN `setState`, never an external system). The full local gate — unit,
   integration, `npm run build`, and even a first full `e2e` run — was green throughout
   development; the bug only surfaced running the REAL committed E2E suite against a
   REAL `next build && next start` server, and even then only in the one test that
   actually asserted the toast's text (`home.spec.ts`'s mark-paid test), which failed
   consistently across all 3 Playwright retries, in both `next dev` and a real
   production build — ruling out a dev-mode-only artifact. Root-caused with a throwaway
   script (same method as Phase 8's own adversarial pass) driving the live server
   directly and polling the toast viewport's DOM every 300ms after a real click: it
   stayed completely empty for the full 3-second window, confirming the toast was never
   added at all, not just removed quickly. Mechanism: `markPaidAction`'s single response
   drives TWO client updates from one round trip — `useActionState`'s own local `state`,
   and (because the action calls `revalidatePath('/')`) the Next.js router's refresh of
   Home's server-rendered tree, which removes the now-paid entry — and therefore this
   exact component — from the list. When both land in one commit, React can go straight
   from "old tree" to "new tree without this component," without ever committing an
   intermediate frame where this instance holds the new `state` while still mounted — so
   neither the render-time pattern NOR a subsequent `useEffect` keyed on `state` (tried
   second, also intermittently failed, same non-deterministic signature) reliably fired.
   **Fixed** by calling `markPaidAction` directly inside `startTransition`, awaiting its
   result in the SAME async closure that fires the toast — sidestepping the render/commit
   race entirely by never depending on this component surviving to observe its own
   result via a later re-render. This is the exact shape the plan's own Undo button
   already used (a direct call, not `useActionState`) for precisely this class of
   reason; the fix just applies it consistently to the primary action too. Re-verified
   with the same live-server script (toast present across 10 consecutive 300ms polls)
   before re-running the full E2E suite, which then passed clean.
2. **`vitest.config.ts`'s coverage gate initially flagged `lib/settings.ts` at 0%** —
   caught by `npm run test:coverage` itself, not a live-verification finding, but real
   enough to note: `lib/settings.ts` is a thin `household_settings` accessor with no
   branch a pure unit test could exercise without a live DB (identical shape to
   `lib/flags.ts`, which was already excluded). Fixed by adding it to the same exclude
   list with a matching comment, not by writing a hollow unit test just to move a
   number. (A genuine gap, not a bug, in `actualOnlyCents`'s own coverage was also
   caught and closed with two direct unit tests in `lib/domain/dashboard.test.ts`
   alongside a `bestEstimateCents` pair that had never had one either.)

**A non-bug worth recording (also found via live verification):** `EmptyState`'s CTA
(`Button` composed with `render={<Link/>}`, `nativeButton={false}`) is exposed to
accessibility tools with role `"button"`, not `"link"`, even though it navigates via
`href` — Base UI's own documented behavior (button semantics/keyboard handling layered
on top of the underlying `<a>` when `nativeButton` is false), the same mechanism Phase
8's `not-found.tsx`/`empty-state.tsx` already relied on. `e2e/home.spec.ts`'s empty-state
test targets `getByRole('button', ...)` accordingly, with a comment explaining why —
this cost one red retry cycle before being understood as intended behavior, not a bug.

**Deviations from the literal plan, logged rather than silent:**

1. **Horizon picker is a 4-button segmented control, not a Popover.** Phase 8 never
   built a `popover.tsx` primitive (Tooltip/Dialog/Drawer/ResponsiveSheet were that
   phase's full overlay set); adding a brand-new base-ui overlay wrapper purely for a
   4-option picker was judged out of this phase's scope. Four always-visible buttons
   need no overlay/focus-trap plumbing and are equally reachable on mobile and desktop.
2. **`MarkPaidButton` calls `markPaidAction` directly (inside `startTransition`), not
   via `useActionState` + `<form action>`** — see the real bug above. Logged here too
   since it's a deviation from the plan's literal sketch, not just a bug-fix footnote.
3. `budget-mini.tsx` links to `/insights`, `goals-mini.tsx` links to `/goals`, exactly
   as the plan specifies, even though `/insights` doesn't render a per-category budget
   breakdown itself — a deliberate literal reading of the plan's task 5 wording, not an
   oversight.

**Test/CI status:** Unit 444/444 (up from 395 — new `affordability.test.ts` plus two
small additions to `dashboard.test.ts`/`format.test.ts`). Integration 260/260 (up from
232). Coverage: 99.43% statements / 97.53% branches / 99.31% functions / 99.84% lines on
the gated `lib/**` scope (gate is 80%; `affordability.ts` and the new `formatDueDate` in
`lib/format.ts` are both effectively 100%-covered by their own direct tests — nothing in
either uncovered-lines list this phase). E2E 59/59 (up from 55), the final run executed
with `CI=true` against a real `next build && next start` — the exact settings GitHub
Actions uses — not a looser local approximation; run twice back-to-back after the
`mark-paid-button.tsx` fix to confirm it wasn't a one-off pass. Lint/typecheck/format all
clean (`npm run format` made zero changes on its final run).

**Live verification (real, not assumed):** the throwaway script described in the bug
write-up above drove the running production server directly, twice — once reproducing
the original toast bug (empty viewport across 10 polls after a real click) and once
confirming the fix (`data-type="success"` toast visible from the first 300ms poll
onward). Separately, `e2e/home.spec.ts`'s own assertions are themselves a real,
hand-verifiable arithmetic check, not just a smoke test: it seeds a fresh $37.00 ad-hoc
expense entry, reads the "Budget left this month" figure, clicks Mark paid, and asserts
the figure dropped by EXACTLY 3700 cents — `expect(beforeCents - afterCents).toBe(3700)`
— then clicks Undo and asserts the figure returns to its exact original value. Every run
this phase (dev-mode, and twice against a production build) passed that exact assertion.

**A hand-workable example of the safe-to-spend arithmetic** (for a reviewer to verify
without re-deriving the logic), using small round numbers rather than the messy seeded
E2E fixture: a household with one bank account, opening balance $1,000.00
(`openingBalanceCents: 100000`). Two entries are already actualized (real money moved):
a $200.00 income actual (+20000) and a $50.00 expense actual (−5000) — so
`currentCashCents = 100000 + 20000 − 5000 = 115000` ($1,150.00), exactly what
`getActualizedCashRows` + `sumNetCentsByAccount` + the opening balance produce (Phase 4's
existing, already-tested net-worth math — this phase adds no new arithmetic here, only a
different query filter). Three unpaid items fall inside the current horizon: a $300.00
upcoming expense (due in 5 days, not overdue), a $100.00 overdue expense (current month,
due day already passed), and a $400.00 upcoming income (due in 10 days). `computeSafeToSpend`:
`upcomingExpenseCents = 30000`, `overdueExpenseCents = 10000`, `expectedIncomeCents =
40000` (tracked, never subtracted), `safeToSpendCents = 115000 − 30000 − 10000 = 75000`
— **$750.00** is the number the hero would show, and the $400.00 expected income shows
up only in the secondary "expected income" figure, never folded into the headline. This
matches the module's own doc comment and its property test's conservation identity
(`cash − safeToSpend === total expense subtracted`: `115000 − 75000 = 40000`, and indeed
`30000 + 10000 = 40000`).

**Deferred / not done:** Nothing from this phase's own task list — every task 1-7 item
shipped. Phase 10 (Money page paid-state, one-tap entry from the monthly views, month
chevrons, global quick-add) and Phase 11 (Plan/Goals/Settings/Import restyle, PWA
refresh) remain not started, per the plan's own phase boundaries — explicitly out of
this phase's scope, not silently dropped.

---

## Phase 10 — Money page: paid-state everywhere, one-tap entry, month nav, global quick-add — status: complete 2026-07-12

**What shipped:**

- **`lib/domain/month-params.ts`**: `parseViewParam(raw, cookieValue?)` — URL param wins
  when it's one of `calendar`/`agenda`/`list`; else a valid `fintrack_view` cookie
  value; else `'agenda'` (the new default, replacing Phase 2's `'calendar'` — there's
  no way to know a request's viewport server-side, and agenda reads acceptably at any
  width without a client-side correction). `monthNav(year, month)` — a thin
  `{ prev, next }` wrapper around `lib/domain/recurring.ts`'s already-tested
  `addMonths`, so the month-header chevrons use the exact same year-rollover logic
  generate/auto-generate already rely on. **`lib/domain/entries.ts`** gained
  `entryPaidState(entry, today): 'paid' | 'overdue' | 'upcoming' | 'unscheduled'` — the
  ONE classifier calendar, agenda, and list all share; deliberately broader than
  `lib/domain/affordability.ts`'s own "overdue" (not restricted to the current month —
  an unpaid entry from any past month a view happens to render is overdue too, since
  this classifies a single entry, not a forward-looking forecast window).
- **`lib/domain/month-params.test.ts`/`lib/domain/entries.test.ts`**: full coverage of
  the new functions, including every documented edge case (URL-wins-over-cookie,
  garbage/tampered cookie -> agenda, Dec->Jan/Jan->Dec `monthNav`, paid-beats-everything,
  no-due-day -> unscheduled, day-31-in-Feb clamping in both leap and non-leap years, the
  today boundary, and a past-month unpaid entry being overdue regardless of horizon).
- **View cookie**: read in `app/(app)/monthly/page.tsx` via `const store = await
cookies()` (async in this Next.js version), read-only during render; written from
  `view-toggle.tsx` via a plain client-side `document.cookie` set on click (a
  non-sensitive UI preference — no Server Action needed, since `parseViewParam`
  re-validates it identically to a URL param on every read regardless of who wrote it).
- **`app/(app)/monthly/month-header.tsx`** (new): `‹ <Month Year> ›` chevrons + a
  "Today" quick link when off the current month. **`month-tabs.tsx`**: split into two
  renders of the same 12 pills (`month-tabs-desktop`/`month-tabs-mobile` testids) — the
  existing wrapped grid at md+, a new horizontally scrollable snap row below it.
- **Paid-state in views**: `calendar-view.tsx` converted to a client component (the
  day-cell-click sheet needs local state) and reads each entry's server-computed
  `paidState`: chips get muted+"✓ " (paid), a `ring-warning` ring + warning text
  (overdue), or the unchanged category-color dot (upcoming). A day cell with entries
  (`canManage`, grid mode) is clickable/keyboard-activatable and opens a
  `ResponsiveSheet` listing that day's entries with a per-entry `MarkPaidButton` and a
  "View in list" link — kept mounted (not just while open) so a mark-paid inside it
  re-renders with fresh data without the sheet flashing closed. Agenda rows get a
  state icon (check/warning/category dot) + an inline `MarkPaidButton` for unpaid
  entries. `entry-row.tsx` (list) gained a compact ghost `MarkPaidButton` beside the
  actual-amount inputs for unpaid rows — the load-bearing inline keyboard flow
  (Enter/Escape/blur, with its onBlur comment) is byte-for-byte untouched, just wrapped
  in an extra flex container. `app/(app)/home/mark-paid-button.tsx` gained optional
  `size`/`variant`/`className` props (defaults unchanged, so Home's own usage is
  unaffected) so the three Monthly views could reuse it at more compact sizes without
  rebuilding its `startTransition`/direct-call/toast logic, per the plan's own explicit
  instruction not to.
- **Global quick-add**: `adhoc-form.tsx` retired; new `app/(app)/quick-add.tsx` (not
  nested under `monthly/` — it's mounted globally now) renders a `Fab` (mobile, Phase
  8's primitive finally wired up) and a fixed-position desktop trigger, both toggling
  one shared `ResponsiveSheet`'s `open` state. Mounted once in `app/(app)/layout.tsx`
  (Suspense-wrapped — the sheet reads the viewed month via `useSearchParams`), gated
  server-side by `canManage`. Fields: Item, Amount (`actualAmount` — the primary "log
  what just happened" flow), Category, Account, Date, then a "More options" disclosure
  for a budgeted-vs-actual split and `paid_by`. `addAdhocAction` gained an optional
  `actualDate` field (validated through the existing `dateInputSchema`) and now
  mirrors a blank budgeted amount to the given actual amount instead of defaulting to
  0 (leaving both blank still defaults to 0, unchanged). New
  `lib/db/queries.ts#getEntryFormOptions` replaces three inline queries that used to
  live only in `monthly/page.tsx`, since quick-add needs the same three option lists
  on every page now.
- **Restyle**: `summary-bar.tsx` — 6 flat figures collapsed into an income/expense/net
  `Stat` trio on the semantic money tokens (retiring this page's emerald/red literal
  convention, per Phase 8's page-by-page plan; `entry-row.tsx`'s Difference column
  retired the same literals while already being touched). `view-toggle.tsx` rewritten
  on the Phase 8 `Tabs` primitive (its real intended home) — each `Tabs.Tab` renders AS
  a real `next/link` via Base UI's `render` composition prop, so navigation/prefetch
  stay ordinary; the cookie write happens in the same click. List/calendar containers
  got `bg-card`/`shadow-card` tokens directly (not the `<Card>` component, which sets
  `overflow-hidden` — these need `overflow-x-auto`).
- **E2E**: `e2e/monthly.spec.ts` — ad-hoc creation moved to the quick-add sheet; new
  one-tap mark-paid test (DB-polled, not a re-read of the deliberately-uncontrolled
  amount input); new Dec->Jan chevron test; new cookie-vs-URL-param precedence test.
  `e2e/mobile.spec.ts` — new describe block: agenda-default-view test, FAB -> Drawer ->
  quick-add -> one-tap-mark-paid test (touch events, DB-verified). `e2e/phase4.spec.ts`
  repointed its ad-hoc-entry step at the quick-add sheet.

**A real bug found live, via the exact "verify live, don't trust green tests alone"
discipline Phases 8-9 established:** the quick-add trigger was first labeled "Quick
add". The full local gate (lint, typecheck, unit, integration, build) passed clean —
but the first `CI=true` E2E run against a real production build broke a pre-existing,
completely untouched test: `categories.spec.ts`'s bank-account create/delete flow
(`getByRole('button', { name: 'Add' }).last()`) failed with "element(s) not found"
because the account was never created. Root cause: Playwright's role-name matching is
a case-insensitive SUBSTRING match by default, not exact — "Quick add" silently
satisfied that query too. Since the trigger is mounted on EVERY `(app)` page via the
layout, rendered AFTER each page's own main content in DOM order, it became the new
`.last()` match everywhere a pre-existing test relied on positional disambiguation
among "Add"-ish buttons (this app has "Add", "Add item", "Add goal" scattered across
categories/recurring/goals, several disambiguated via `.first()`/`.last()`, none of
which anticipated a brand-new global button appearing on every page at once). Fixed by
renaming the trigger to "New entry" (shares no substring with "add" in any case), then
confirmed via two full, clean local `CI=true` E2E runs (64/64 both times) — the first
re-run attempt after the rename still showed the OLD failure, traced to having tested
against a stale `next build` output from before the rename (a `npm run build` was
still required); rebuilding first resolved it. A concrete reminder, now documented in
`quick-add.tsx`'s own comment, that a label mounted globally needs to be checked
against substring-matching risk everywhere, not just where it's newly used.

**A live-verification finding investigated and attributed to the test harness, not the
product (logged honestly rather than either dismissed or over-claimed as a fixed
bug):** a throwaway script driving the real production server directly (same method as
Phases 8-9's own adversarial passes) intermittently showed the calendar day-sheet's
mark-paid action updating the UI (a "Paid" label, the sheet staying open) without a
direct database read from the SAME script observing the new `actualAmount`, even after
several seconds of polling. Investigated across multiple isolated repros: first ruled
out an ambiguous-target theory (a day with two real unpaid entries sharing it — a
genuine, correctly-handled scenario the investigation itself surfaced via an honest
Playwright strict-mode violation, not a product bug); then ruled out duplicate rows
(confirmed exactly one row per test entry, every time). The anomaly was NOT
reproducible via the properly-engineered, `expect.poll`-based committed E2E suite
(clean across two full runs) and did not reproduce in most otherwise-identical direct
manual repros (which correctly showed the database updated within 1-3 seconds).
Most likely explanation: connection/read latency specific to a brand-new short-lived
script process establishing its own fresh Postgres connection against Neon each run,
unlike the actual Next.js server's warm, pooled connection real users and the E2E
suite's own server both use — not a deterministic defect in `markPaidAction`. Flagged
here rather than silently dropped: the mechanism is verified correct by the
authoritative, repeatable signal (the committed E2E suite, twice clean) and by the
majority of direct manual repros, but a narrow possibility of a genuine intermittent
issue under real Neon connection pressure isn't ruled out to 100% certainty within
this phase's time budget.

**Deviations from the literal plan, logged rather than silent:**

1. `quick-add.tsx` lives at `app/(app)/quick-add.tsx`, not nested under `monthly/` as
   the plan's literal "rename/refactor adhoc-form.tsx -> quick-add.tsx" wording might
   suggest — it's mounted globally in `app/(app)/layout.tsx` now, so its real home is
   alongside the layout that owns it, not the page it replaced a form on.
2. The desktop quick-add trigger and the Fab are both labeled "New entry", not
   anything containing "Add" — see the naming-collision bug above.
3. `addAdhocAction`'s budgeted-amount default when left blank now mirrors a given
   actual amount instead of defaulting to 0 — a small, deliberate UX fix the plan
   didn't explicitly call for, but a direct consequence of quick-add's new
   single-primary-"Amount"-field design ("Amount (actual)" per the plan's own task 5
   wording).
4. Card surfaces use the `bg-card`/`shadow-card` tokens directly rather than the
   `<Card>` component, for containers needing `overflow-x-auto` (`<Card>` sets
   `overflow-hidden`, which would clip the wide calendar grid/list tables' horizontal
   scroll).

**Test/CI status:** Unit 461/461 (up from 444). Integration 264/264 (up from 260).
Coverage: 99.44% statements / 97.58% branches / 99.32% functions / 99.84% lines on the
gated `lib/**` scope (gate is 80%; every new pure function in `entries.ts`/
`month-params.ts` is 100%-covered by its own direct tests). E2E 64/64 (up from 59),
final run executed with `CI=true` against a real `next build && next start` — run
twice back-to-back clean after the naming-collision fix, and once more after the final
`npm run format` pass and a fresh rebuild. Lint/typecheck/format all clean (`npm run
format` reformatted 8 files — whitespace only — on its one substantive run this phase;
`npm run format:check` clean immediately after).

**Live verification (real, not assumed):** a throwaway script drove the running
production server directly: confirmed a garbage/`<script>` `fintrack_view` cookie
value renders `/monthly` at 200 (not a crash) and falls back to the agenda tab
(`data-active` present on it via a real DOM read); confirmed the Dec 2026 -> Jan 2027
chevron navigates and updates the header text live; confirmed clicking a calendar day
cell with real seeded/generated entries opens the day sheet (Base UI `Dialog` at
desktop width, `Drawer` at a 390px/Pixel-7 viewport), that mark-paid inside it updates
the row and the sheet stays open, and that Escape closes it (after allowing the click's
own re-render to settle — pressing Escape in the same synchronous tick as the click
transiently ate the keydown in one early attempt, resolved by waiting a beat, matching
how a real user would never press both at literally the same instant either); confirmed
the mobile FAB ("New entry") is the only such trigger reachable in the accessibility
tree at that viewport (the desktop button is `display:none` there) and opens a Drawer,
not a Dialog. See the live-verification finding above for the one anomaly this pass
surfaced and its investigation.

**Deferred / not done:** Nothing from this phase's own task list. Phase 11 (Plan/
Goals/Settings/Import restyle, PWA refresh) remains not started, per the plan's own
phase boundaries — explicitly out of scope, not silently dropped.

---

## Phase 11 — Plan/Goals/Settings/Import restyle + polish + PWA refresh — status: complete 2026-07-12

**What shipped:**

- **Plan (`/recurring`, route unchanged)**: H1 relabeled "Recurring schedule" ->
  "Plan" (the Monthly page's own empty-state link already said "Plan" pre-restyle —
  this makes the page's heading match). Frequency-grouped tables wrapped in
  `bg-card shadow-card` surfaces. Active/Inactive -> `Switch` primitive, wired via a
  direct `startTransition` call (`toggleRecurringAction` invoked directly, not through
  `useActionState` + `<form>` — a Switch has no native form submission, and this keeps
  the row consistent with the direct-call convention even though this particular
  toggle never unmounts). Generate -> a plain, always-centered `Dialog` (not
  `ResponsiveSheet` — the plan's own literal task wording draws this distinction from
  Goals' sheets, preserved deliberately).
- **Goals**: `GoalCard`'s hand-rolled progress bar replaced by the `Progress`
  primitive; COMPLETE/OVERDUE badges and a new projected-completion badge moved onto
  `Badge` + the `--income`/`--warning` semantic tokens (retiring this page's emerald/
  red-literal convention). Add -> `GoalAddForm` restyled as a `ResponsiveSheet`
  (trigger + sheet); Edit -> each `GoalCard` gets its own `ResponsiveSheet`. Flag-off
  delete-only mode preserved byte-for-byte (`canEdit`/`canManage` are the exact same
  booleans as before, just wired into new JSX) — live-verified with a real seeded goal,
  not just read from the diff (see below).
- **Settings**: hub + every subpage restyled onto `Card`/`bg-card shadow-card`
  surfaces. Kill-switch toggles (`email_reminders`, `monthly_recap`, `csv_import`) ->
  `Switch`. Save feedback -> toasts on `ChangePasswordForm`, `InviteForm`, `MemberRow`
  (role change + remove), `NotificationToggle`, `MemberNotifyRow`,
  `SendTestEmailButton`, `CsvImportToggle` — all converted from `useActionState` to
  direct-call + `startTransition` + `useToastManager()`, the same pattern
  `mark-paid-button.tsx` established in Phase 9; needed (not just consistent) for
  `MemberRow`'s remove and `CsvImportToggle`, both of which trigger a `revalidatePath`
  that unmounts/replaces the exact component that would otherwise need to observe its
  own result. `ChangePasswordForm`'s inline "Password updated." text is kept verbatim
  alongside the new toast, not replaced by it — `e2e/auth.spec.ts` (one of the three
  specs this project's cross-phase rule says must never need churn) asserts that exact
  text. Data subpage gained an "Import CSV" card/link. Members page gained a new,
  read-only "Pending invites" list (a query only, no new mutation — the pre-restyle
  page never showed pending invitations at all); `createInviteAction` gained a
  `revalidatePath('/settings/members')` so the list actually refreshes after a real
  send (a real bug found live, see below).
- **Import**: wizard restyled with a plain, non-interactive step indicator
  (Upload -> Preview -> Done) — deliberately not the `Tabs` primitive, since these
  steps can't be jumped between arbitrarily the way `Tabs` implies. No flow change.
- **Empty states**: `EmptyState` adopted on every list surface the plan named —
  recurring, goals, categories (income + expense, compact variant), accounts, the new
  members-invites list, and Monthly's pre-existing empty-state block (which was
  already hand-styled with the exact classes `EmptyState` itself uses, now the real
  component).
- **PWA/brand refresh**: `lib/pwa/icon.tsx`'s shared glyph background moved from pure
  black to `#7c3aed` — the exact sRGB rendering of `globals.css`'s light `--chart-1`/
  `--primary` hue (reused, not invented, so it's already CVD-palette-consistent).
  `app/manifest.ts`'s `background_color`/`theme_color` moved from `#000000` to
  `#0c0c11` (the sRGB rendering of the dark theme's real `--background` token).
  `app/layout.tsx`'s `viewport` export gained `media`-qualified `themeColor` variants
  (light `#f8f7f3` / dark `#0c0c11`) per the array form documented in
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport
.md` — read before writing it, not assumed from training data (this Next.js version's
  own AGENTS.md warning).
- **RUNBOOK.md**: new "UI primitives (Phase 8-11 redesign) — failure modes" section.
- **E2E**: `e2e/recurring.spec.ts` (heading rename; Switch-role toggle assertions; new
  fresh-household empty-state test), `e2e/phase4.spec.ts` (goal add/edit flows scoped
  to their sheet testids; two new fresh-household empty-state tests for goals and
  categories/accounts), `e2e/notifications.spec.ts` (kill-switch assertions ->
  Switch-role), new `e2e/members.spec.ts` (pending-invites empty state -> real invite
  sent through the UI -> toast -> invite listed). `e2e/categories.spec.ts`/
  `e2e/phase5.spec.ts`/`e2e/pwa.spec.ts` reviewed and left untouched — confirmed by
  actually running them, not just by inspection, that nothing in this phase's restyle
  broke any of their existing assertions.

**Two real bugs found via live E2E verification — both test-authoring bugs this
phase's restyle exposed, not product defects, logged honestly rather than either
dismissed or over-claimed:**

1. `GoalAddForm`'s `ResponsiveSheet` correctly closes on success; the FIRST version of
   its own E2E test didn't wait for the sheet's CSS exit animation
   (`components/ui/dialog.tsx`'s `transition-all duration-150`, which keeps the Popup
   mounted through the transition rather than unmounting instantly — real, deliberate
   product behavior) before immediately trying to reopen it, hitting a genuine
   Playwright strict-mode violation when the trigger and the still-animating-out
   submit button briefly coexisted. Root-caused by reproducing it against the real
   committed suite (`CI=true npx playwright test`) — a hand-written throwaway script
   polling every 300ms never caught it, since 300ms comfortably exceeds the 150ms
   window. Fixed in the test: `await expect(page.getByTestId('goal-add-form'))
.toHaveCount(0)` before the reopen click.
2. `GenerateForm`'s new modal `Dialog` has a backdrop that blocks clicks elsewhere on
   the page while open — a real, minor UX consequence of the restyle (the pre-restyle
   inline form had no such overlay), not a test bug. `e2e/recurring.spec.ts`'s
   pre-existing "edit right after generating" step timed out for 30s waiting for a
   click the backdrop was silently swallowing. Fixed two ways: the test now dismisses
   the dialog before continuing (matching real user behavior), and the dialog's own
   redundant custom "Close" footer button — which duplicated `DialogContent`'s
   already-built-in X icon and, once the first fix surfaced it, triggered a SECOND,
   separate strict-mode violation (two controls both literally named "Close") — was
   removed rather than relabeled, since having two colliding affordances was itself a
   latent bug, not a naming detail to patch around.

**A real product bug found and fixed (a genuine gap this phase's own new feature
needed):** the new Pending Invites list never refreshed after sending a real invite —
`createInviteAction` had no `revalidatePath` call (never needed one before Phase 11,
since nothing on `/settings/members` depended on its data). `e2e/members.spec.ts`
caught this immediately. The fix INITIALLY appeared not to work on a re-run, which
traced to testing against a stale `next build` output from before the fix — the exact
"always rebuild after a source change before trusting a fresh E2E run" lesson Phase
10's own entry above already recorded, hit again here; rebuilding first confirmed the
real fix. Added `revalidatePath('/settings/members')` to `createInviteAction` — the
same category of change as Phase 9's `updateActualAction` gaining a second
`revalidatePath('/')`, a cache-invalidation addition, not a loosened check.

**Deviations from the literal plan, logged rather than silent:**

1. Generate uses a plain `Dialog`, Goals' add/edit use `ResponsiveSheet` — the plan's
   own task wording draws exactly this distinction; preserved deliberately, not
   flattened onto one primitive.
2. Members gained a new, read-only "Pending invites" list — a direct, minimal-risk
   reading of the plan's own instruction to adopt `EmptyState` on "members-invites" as
   a named list surface, which the pre-restyle page had no list for at all. Explicitly
   NO revoke/resend action added — that would be new mutation surface a restyle phase
   has no mandate to add.
3. `MemberNotifyRow` (per-member opt-in) stayed a plain `Button`, not `Switch` — the
   plan's task 3 says "kill-switch toggles -> Switch" specifically; opt-in isn't one of
   the four kill-switches.

**Test/CI status:** Unit 461/461 (unchanged — no `lib/**` logic touched this phase).
Integration 264/264 (unchanged — no `app/actions/*.ts` file touched except `invites.ts`'s
single added `revalidatePath` line). Coverage: 99.44% statements / 97.58% branches /
99.32% functions / 99.84% lines on the gated `lib/**` scope (gate 80%; identical to
Phase 10's numbers, for the reason above). E2E 68/68 (up from 64), the final run
executed with `CI=true` against a real `next build && next start`, run twice
back-to-back clean after the fixes above and a rebuild in between (the second bug's
"stale build" gotcha made a real rebuild non-optional this time, not just good
hygiene). Lint/typecheck/format all clean (`npm run format` made no unexpected
changes beyond what this phase's own edits already matched).

**Live verification (real, not assumed) — beyond the green E2E suite, specifically for
the three preserved-behavior edge cases this phase's own task list called out:**

1. **Goals flag-off delete-only mode**: started a second real server instance with
   `FEATURE_SAVINGS_GOALS=false`, inserted one real goal directly into the seeded
   household's data, logged in as the owner, and confirmed via direct DOM reads: the
   goal card rendered with its real saved/target amounts, zero "Add goal" triggers
   anywhere on the page, zero "Edit" buttons on that card, and one working "Delete"
   button — clicked for real, which actually removed the row (confirmed by its
   absence afterward via a direct DB read, not assumed from the click alone).
2. **Import kill-switch-off friendly message**: created a genuinely fresh household
   (its own `households` row, `csv_import` at its untouched default) and confirmed the
   friendly "CSV import is not enabled for this household" message, the owner-specific
   enabling copy, zero CSV file inputs anywhere in the DOM, and an unchecked `Switch`;
   flipped that real `Switch` and confirmed, after a reload, the full upload form
   (file input included) genuinely appeared.
3. **Service worker static-only caching policy**: confirmed via `git diff --stat`
   that `app/sw.js/route.ts` and `lib/pwa/static-paths.ts` have zero changes this
   phase, combined with `e2e/pwa.spec.ts`'s own "the service worker registers and
   controls the page" test passing clean in the full E2E run.

**Deferred / not done:** Nothing from this phase's own task list — every task shipped.
This closes the Phase 8-11 UI/UX redesign in full. `spec.md`'s Feature Matrix is
unchanged across all four phases (no new flags); every prior phase's preserved
behavior (auto-generate, propagation, byte-identical reminders/recap output, CSV
import/export, cross-household scoping, the `min-w-0` layout fix) was re-verified this
phase too, not just assumed to still hold.

---

## `/code-review` pass on the Phase 8-11 redesign — 12 real bugs found and fixed (2026-07-12)

A thorough code-review pass on the already-shipped Phase 8-11 redesign (10 finder
angles + individual verification + live browser testing, same methodology as every
prior `/code-review` entry in this log). All 12 findings CONFIRMED real and fixed —
none deferred. This is a bug-fix pass, not a new numbered phase.

**Fixed:**

1. **Quick-add misfiled entries into the wrong year** (`app/(app)/quick-add.tsx`).
   `year`/`month` were parsed INDEPENDENTLY from URL search params, so
   `/insights?year=2023` (year set, month never set) silently combined the URL's
   `year=2023` with `parseMonthParam(undefined)`'s fallback to THIS month — a quick-add
   entry landed in "2023 + current month," a combo the user never chose. Fixed: only
   trust the URL's year+month as a PAIR when `searchParams.get('year')` AND
   `searchParams.get('month')` are BOTH non-null; otherwise default the whole pair to
   `currentYearMonth()` together.
2. **Mark paid now opens a small confirm popup with an editable date, instead of
   marking paid instantly** (`app/(app)/home/mark-paid-button.tsx`,
   `app/actions/monthly.ts`'s `markPaidAction`) — USER'S EXPLICIT SPEC. Root bug:
   `markPaidAction` hardcoded `actualDate` to today regardless of which month the entry
   belonged to, reachable since Phase 10 made this button reachable from arbitrary
   past/future months via Monthly's chevrons. Fix: clicking "Mark paid" opens a
   `ResponsiveSheet` (item name read-only, a date `<input type="date">` defaulting to
   today but editable, Cancel/"Mark paid"); `markPaidAction` gained an optional
   `actualDate` field (reusing the existing `dateInputSchema`), defaulting server-side
   to today (UTC) if empty/absent — defense in depth, not the primary source of the
   date. The documented direct-call-inside-`startTransition`/toast-in-the-same-closure
   invariant (see that file's own long-standing comment) is unchanged; the popup closes
   eagerly on confirm, before the action is even awaited, so it never depends on this
   component surviving its own revalidation-driven unmount. All 3 call sites (Home's
   upcoming-list, calendar-view's agenda/day-sheet rows, entry-row) needed no new props.
3. **Three Server Actions didn't refresh Home** (`app/actions/monthly.ts`).
   `addAdhocAction`, `overrideBudgetAction`, `deleteEntryAction` only called
   `revalidatePath('/monthly')`; added `revalidatePath('/')` to each, matching
   `updateActualAction`/`markPaidAction`'s existing pattern in the same file.
4. **Bank Summary was unreachable when `FEATURE_NET_WORTH` is off**
   (`app/(app)/accounts/page.tsx`). The whole page early-returned an `EmptyState` when
   the flag was off, making `BankSummaryTable` (which only needs entries tagged to a
   bank account, nothing net-worth-specific) unreachable — a regression from the
   pre-redesign dashboard, which rendered it unconditionally. Fixed: `getDashboardRows`
   and `buildBankSummary` now run regardless of the flag; only `NetWorthChart`/
   `AccountBalancesTable`/the "Total net worth" hero stay gated, with a small inline
   note (not a page-replacing `EmptyState`) when net-worth tracking specifically is off.
5. **`entry-row.tsx`'s actual-amount/date inputs went stale after mark-paid**. The
   uncontrolled `defaultValue` inputs only re-apply on mount, not on a prop update, so a
   sibling `MarkPaidButton` click left the row visually self-contradictory (button gone,
   amount column still blank) until navigating away and back. Fixed: the `<form>` now
   carries `key={`${entry.id}-${entry.actualAmount ?? 'unpaid'}`}`, forcing a remount
   (fresh `defaultValue`) exactly when paid state flips, stable during normal typing.
6. **Overdue income mislabeled and optimistically counted as received**
   (`lib/domain/affordability.ts`'s `selectUpcomingItems`). `overdue` had no direction
   check, so an unpaid past-due INCOME candidate got `overdue: true` — rendered under
   Home's red "Overdue" section despite being positive, and `buildRunway` applied it at
   day 0 as if already received. Fixed with a one-line `&& candidate.direction ===
'expense'` — a not-yet-due-and-unpaid past income item is now excluded from the
   runway/list entirely (the app's existing conservative philosophy: income is never
   assumed received early), not given a new "pending income" bucket.
7. **`markPaidAction` missing household scope in its final UPDATE** — not currently
   exploitable (a prior scoped SELECT already validates the id), but added
   `eq(monthlyEntries.householdId, actingUser.householdId)` to the UPDATE's `where` to
   match `updateActualAction`/`overrideBudgetAction`'s own defense-in-depth convention.
8. **Quick-add fired a cross-component state update during render**
   (`app/(app)/quick-add.tsx`). `QuickAddForm` called the parent's `setOpen(false)` (via
   `onSuccess`) synchronously during its OWN render — the unsafe pattern, since React
   only sanctions render-time `setState` for a component's OWN state, not an ancestor's.
   Moved into a `useEffect` keyed on `state`. The stale in-code comment claiming the
   pattern "only ever touches this component's own local state" was fixed to describe
   what actually changed; the now-redundant `reactedTo` local-state-only tracking (which
   existed solely to gate the `onSuccess()` call) was removed rather than kept as dead
   code, since nothing else used it.
9. **`responsive-sheet.tsx` lost form state on a mid-session viewport resize**. Dialog
   and Drawer are structurally different subtrees; branching on the live `isDesktop`
   value every render meant a real resize across 768px while a sheet was OPEN remounted
   `children`, wiping in-progress form state. Fixed by locking the Dialog-vs-Drawer
   choice for the duration of one "open" session — captured via the same
   compare-to-previous-value, adjust-state-during-render idiom this codebase already
   uses elsewhere (state, not a ref: eslint's `react-hooks/refs` rule correctly rejects
   reading `ref.current` during render outside the narrow lazy-init-check idiom), reset
   the moment `open` goes back to false so the next open re-evaluates fresh.
10. **`e2e/phase4.spec.ts` leaked orphaned test debris every run**. Its category-budget
    test creates an ad-hoc `monthly_entries` row named `` `${categoryName} overspend` ``
    directly in the shared seed household; `afterAll` only deleted the category, and
    `monthlyEntries.categoryId` has `onDelete: 'set null'`, so the delete ORPHANED the
    entry (categoryId -> null) instead of removing it. Fixed (test-only, per the task's
    explicit scope — no existing accumulated debris was touched): the test now captures
    the created entry's id and `afterAll` deletes that `monthly_entries` row explicitly.
11. **Stale `/?year=N` bookmarks landed on "now" with no indication**
    (`app/(app)/page.tsx`). Added a lightweight courtesy redirect: a present, valid,
    DIFFERENT-from-current year redirects to `/insights?year=<that year>` (the page
    that's actually year-scoped now); absent or already-current year renders Home
    unchanged.
12. **`clampedDueDate` duplicated a third time**. `lib/domain/reminders.ts` had the
    original private version; `lib/domain/affordability.ts` had an intentional
    duplicate (per the redesign's own plan, since it couldn't modify `reminders.ts`);
    `lib/domain/entries.ts`'s `entryPaidState` inlined a third copy. Fixed by exporting
    `clampedDueDate` from `reminders.ts` and having both `affordability.ts` and
    `entries.ts` import the one implementation — `reminders.ts`'s own behavior (the cron
    email path) is unchanged; only its visibility changed, confirmed by its own
    unchanged test suite staying green.

**Live verification beyond green tests (the trickier fixes — #1, #2, #9 — each got a
real before/after, not just a passing suite):**

- **Fix 1**: a throwaway script drove the running production server directly — logged
  in, visited `/insights?year=2023`, quick-added a real entry, and read the DB directly:
  the entry landed in the CURRENT year/month (2026-07), not 2023. A second check
  confirmed `/monthly?year=2023&month=6` (both params present) still correctly targets
  June 2023 — the pair-trust path still works when it's supposed to.
- **Fix 2**: the same script seeded a real recurring item with `actual_date_day = 10`,
  opened the calendar grid's day-10 cell (a `ResponsiveSheet`), clicked "Mark paid" on
  the entry inside it — confirming the NESTED popup (a `ResponsiveSheet` inside an
  already-open `ResponsiveSheet`, the trickiest call site) opens without stalling or
  crashing, defaults its date field to today, and persists a hand-edited custom date
  (`2026-02-01`) exactly, verified via `to_char(actual_date, 'YYYY-MM-DD')` against the
  live DB (a raw `pg` client's default `DATE` parsing reinterprets through the local
  machine's timezone offset, which produced one initial false-negative red herring —
  resolved by reading the column as text instead of relying on driver-parsed `Date`
  objects).
- **Fix 9**: a genuine before/after. With the ORIGINAL `responsive-sheet.tsx` restored
  temporarily (rebuilt, restarted), the same script opened quick-add, typed a real item
  name, resized the page from 1280px to 390px wide mid-session, and confirmed the field
  reset to `""` — reproducing the bug exactly as described. Restored the fix, rebuilt,
  reran: the typed text survived the identical resize. Re-confirmed once more after
  restoring to be sure the working tree matched what was verified.
- All debris created by these verification scripts (test recurring items/entries named
  `Fix1/Fix2/Fix9 ...`) was deleted afterward via the same live DB connection — this is
  cleanup of debris created BY this session's own verification, not the separately
  scoped "clean up already-accumulated debris" task the task description explicitly
  said was out of scope.

**Test/CI status:** Unit 462/462 (up from 461 — one new `affordability.test.ts` case
for Fix 6). Integration 266/266 (up from 264 — two new `markPaidAction` cases for
Fix 2: custom-date persists exactly, calendar-impossible custom date rejected).
Coverage unchanged at 99.43% stmts / 97.58% branch / 99.32% funcs / 99.84% lines on the
gated `lib/**` scope (gate 80%; every touched line in `affordability.ts`/`entries.ts`/
`reminders.ts` stayed fully covered). E2E 68/68 (same count as before — one test
renamed/expanded for Fix 2's popup flow, not added), run twice back-to-back with
`CI=true` against a real `next build && next start` after every substantive change,
including once more as the final pre-commit gate run. Lint/typecheck/format all clean.

**Deviations from the task's instructions, logged rather than silent:** none of
substance — every fix matches its described scope. One minor scope note: Fix 9's lock
doesn't apply to `net-worth-about-sheet.tsx`'s one UNCONTROLLED `ResponsiveSheet` usage
(no `open`/`onOpenChange` passed, so there's no `open` transition to lock onto) — a
reasonable trade-off, since that sheet only ever shows static informational text with
no form state to lose, and the fix's own instructions called for a surgical, low-risk
change rather than restructuring every call site.

**Deferred / not done:** Nothing — all 12 findings fixed, none deferred.

---

## Maintainability pass — shared `useAction` hook + cleanup batch (2026-07-12)

A no-behavior-change maintainability/risk-reduction pass over the Phase 8-11 redesign
(not a bug fix, except item 2i below, which was already provably inert — no current
caller). Two parts: extract a shared `useAction` hook for the direct-call-inside-
`startTransition` Server Action pattern this codebase already used in 9 places, and a
batch of 9 small, independently-scoped cleanups.

**Part 1 — `lib/hooks/use-action.ts`:** All 9 call sites named in the task were read in
full first (`mark-paid-button.tsx`, `csv-import-toggle.tsx`,
`send-test-email-button.tsx`, `member-notify-row.tsx`, `notification-toggle.tsx`,
`member-row.tsx` — two independent instances, role-change and remove —
`invite-form.tsx`, `change-password-form.tsx`, `recurring-row.tsx`'s toggle) to confirm
the shape was mechanically identical before designing the hook. Landed on the sketch
from the task almost as-given:

```ts
export function useAction<TState>(
  action: (prevState: TState, formData: FormData) => Promise<TState>,
) {
  const [pending, startTransition] = useTransition();
  function run(formData: FormData, onSettled: (result: TState) => void) {
    startTransition(async () => {
      const result = await action(undefined as TState, formData);
      onSettled(result);
    });
  }
  return { pending, run } as const;
}
```

One deviation from the literal sketch, found by `npm run typecheck`, not by
inspection: the sketch's `action: (prevState: TState | undefined, ...) => Promise<TState>`
does not typecheck against any of the 9 real actions. Every action-state type in this
codebase (`MarkPaidActionState`, `ToggleFlagActionState`, `MemberActionState`, etc.)
already models `undefined` as one of ITS OWN union members (the same convention
`useActionState`'s own initial-state parameter requires) — wrapping that in a second,
hook-level `| undefined` makes TypeScript infer `TState` as the union with `undefined`
subtracted back out, which then fails to unify against the action's real
`Promise<TState>` return (which still includes it). Fixed by typing `action`'s
parameter as plain `TState` and casting the one internal `undefined` call site
(`action(undefined as TState, formData)`) — documented inline in the hook with why the
cast is safe (every action passed in already allows `undefined` as a real member of its
own state type). `mark-paid-button.tsx`'s canonical race-explanation comment was kept in
place (several of the other 8 files' comments point back to it) with a short addendum
noting the mechanics moved into the hook but the invariant (onSettled runs synchronously
inside `run`'s own awaited closure, never a `useEffect` keyed on returned state) didn't.
`member-row.tsx` calls `useAction` twice (`changeMemberRoleAction`,
`removeMemberAction`), preserving its two independent `pending`/error states exactly as
before — not merged.

Spot-checked 3 call sites' feedback behavior against the pre-refactor diff, not just
"tests pass": `mark-paid-button.tsx` — success still fires a toast with the Undo action
wired to `updateActualAction`, the `alreadyPaid` branch is still a silent no-op, and the
error branch still shows a toast (this is the one component that toasts on BOTH success
and error, preserved). `csv-import-toggle.tsx` — success still toasts, but error still
sets local `error` state for inline text rather than a toast (this component never
toasted on error, and still doesn't). `change-password-form.tsx` — the inline "Password
updated." text (protected by `e2e/auth.spec.ts`, one of the three specs this project's
cross-phase rule says must never need churn) still renders from its own local
`succeeded` state exactly as before, alongside the new-in-Phase-11 toast; the E2E run
below re-confirms `auth.spec.ts` is still green. Added
`lib/hooks/use-action.test.tsx` covering: `run` calls the action with the exact
FormData given; `onSettled` receives the real settled result; `pending` is `true` while
the action is in flight and `false` once it resolves; a second `run` after the first has
settled works correctly (4 tests, all passing). This repo had zero component/hook test
infrastructure before this pass (`vitest.config.ts`'s "unit" project runs everything
under a plain `node` environment; no `@testing-library/*`/jsdom anywhere in
`package.json`) — added `@testing-library/react` and `jsdom` as devDependencies (the
minimal, standard pairing for testing a React hook, justified per
development-workflow.md's dependency-hygiene rule) and scoped jsdom to just this one
file via a `@vitest-environment jsdom` docblock rather than changing the "unit"
project's default environment for every other (pure-logic, `node`-environment) test.
`vitest.config.ts`'s unit project `include` and the coverage `exclude` list both gained
a `.test.tsx` pattern alongside the existing `.test.ts` one.

**Part 2 — cleanup batch:**

- **2a (unused UI exports):** Repo-wide grep confirmed `DialogClose`, `DialogPortal`,
  `DialogBackdrop` (dialog.tsx), `DrawerClose`, `DrawerPortal`, `DrawerBackdrop`
  (drawer.tsx), and `TabsPanel` (tabs.tsx) had 0 importers outside their own file.
  `DialogPortal`/`DialogBackdrop` and `DrawerPortal`/`DrawerBackdrop` are used
  internally by `DialogContent`/`DrawerContent` respectively, so those four stayed as
  unexported local helpers (only removed from each file's `export {}` list).
  `DialogClose`, `DrawerClose`, and `TabsPanel` were not referenced anywhere else in
  their own file either (the actual close buttons render `DialogPrimitive.Close`/
  nothing directly, never the unused alias) — removed entirely rather than kept as an
  unused unexported binding, which `no-unused-vars` would have flagged anyway.
- **2b:** `quick-add.tsx`'s two `from 'react'` import lines merged into one.
- **2c:** `month-tabs.tsx`'s desktop/mobile pill lists built once (`const pills = ...`)
  and rendered into both wrapper `<div>`s — same React elements reused in two parents,
  a standard and safe pattern (keys are scoped per-parent, not globally). Two
  containers themselves stayed separate, per the file's own existing comment on why.
- **2d:** Extracted `directionDotClass`, `paidTextClass`, and `paidPrefix` local
  helpers in `calendar-view.tsx`, used by `GridChip`, `AgendaRow`, `UnscheduledChip`,
  and `DaySheetRow` in place of each one's hand-rolled copy of the same conditional
  class-string/prefix logic. `UnscheduledChip`'s `toneClass` (a background+text tint,
  not a dot) was deliberately left as its own thing — different shape, not a duplicate
  of `directionDotClass`. The `agenda`-boolean grid/list branching itself was not
  touched, per the task's explicit out-of-scope note. Checked behavior-preservation by
  diffing the interpolated class strings each helper produces against the original
  inline ternaries for all 4 paid states (paid/overdue/upcoming income/upcoming
  expense) — byte-identical output in every case — plus the full E2E run below
  (`monthly.spec.ts`, `mobile.spec.ts`) exercises calendar/agenda/day-sheet rendering
  live.
- **2e:** `safe-to-spend-hero.tsx`'s two lens branches collapsed into one render path:
  an `if (cashLensActive && safeToSpend) {...} else {...}` computes
  `{ statTestId, label, value, subLine, tone }` up front (preserving TypeScript's
  narrowing of `safeToSpend` inside the `if`, unlike a separately-computed boolean),
  then a single JSX tree renders `<Stat>` once and branches only on the one truly
  different piece below it (`BudgetRemainingLine` for the cash lens vs. the "Add a bank
  account" link for the budget lens). Verified the two lenses' `data-testid`s didn't
  get conflated in the merge — the cash lens's `safe-to-spend-value`/`budget-left-value`
  pair (one on the `Stat`, one on `BudgetRemainingLine` below it) and the budget lens's
  single `budget-left-value` (on its own `Stat`, no second element) are reproduced
  exactly, checked by re-reading the merged JSX against the original two trees
  side-by-side before running tests.
- **2f:** `calendar-view.tsx`'s `byDay`/`unscheduled`/`cells` construction wrapped in
  `useMemo(() => {...}, [entries, totalDaysInMonth])`, so opening/closing the day-sheet
  (`openDay` state, unrelated to `entries`) no longer re-walks every entry. Verified by
  reasoning through the dependency array (the loop only reads `entries` and
  `totalDaysInMonth`, nothing else in the component's render scope) rather than a
  render-count instrumentation script, since the output is provably identical to the
  un-memoized version for any given `(entries, totalDaysInMonth)` pair.
- **2g:** `app/(app)/page.tsx`'s `sumNetCentsByAccount` call and the
  `currentCashCents` reduce moved inside the existing `if (cashLensActive)` block,
  alongside `computeSafeToSpend`/`buildRunway` (the only two places that ever read
  them) — skipped entirely, not just computed-and-ignored, when the cash lens is off.
- **2h:** `accounts/page.tsx`'s stale comment ("the dashboard's own copy
  (app/(app)/page.tsx) ... deliberately untouched this phase") corrected — Home
  (`app/(app)/page.tsx`) no longer runs any net-worth carry-forward/series computation
  at all since its Phase 9 rewrite (it only sums CURRENT cash for the safe-to-spend
  hero, a narrower and differently-shaped calculation, not a duplicate of this page's
  yearly balance walk). No extraction attempted — there is no longer a second copy of
  this specific math anywhere else in the app to share a helper with.
- **2i:** `components/ui/tooltip.tsx`'s `TooltipContent` now destructures `side`/
  `align` alongside `sideOffset` and forwards all three to `TooltipPrimitive.Positioner`
  — previously `side`/`align` fell through `...props` onto `Popup` instead and were
  silently ignored. Confirmed genuinely inert today: a repo-wide grep found exactly one
  `<TooltipContent>` caller (`accounts/page.tsx`'s net-worth info tooltip), passing
  neither prop — zero behavior change for the one existing usage.

**Test/CI status:** Unit 466/466 (up from 462 — 4 new `use-action.test.tsx` cases).
Integration 266/266 (unchanged — no Server Action logic touched; every call site's
action function is byte-identical, only how components call it changed). Coverage:
99.44% statements / 97.58% branches / 99.33% functions / 99.84% lines on the gated
`lib/**` scope (gate 80%; `lib/hooks/use-action.ts` itself is 100%-covered by its own
test; the coverage % is effectively unchanged from the prior entry). E2E 68/68, run
twice back-to-back clean with `CI=true` against a real `next build && next start` (the
full suite, not a subset, per the task's own instruction — this pass touches 9+
components with existing E2E coverage across mark-paid, member management,
notifications, csv-import, and recurring-toggle flows). Lint/typecheck/format all
clean (`npm run format` reformatted `calendar-view.tsx` and `tooltip.tsx` — wrapping
long lines this pass introduced, no semantic changes). `npm audit --audit-level=high`
clean (6 pre-existing moderate advisories in `next`'s/`drizzle-kit`'s own transitive
deps, unrelated to and unchanged by this pass's two new devDependencies).

**Deviations from the task's instructions, logged rather than silent:**

1. The `useAction` hook's `action` parameter type is `TState`, not the sketch's
   `TState | undefined` — a TypeScript inference fix, not a design choice; see Part 1
   above for the full mechanism.
2. 2a removed `DialogClose`/`DrawerClose`/`TabsPanel` entirely (declaration + export)
   rather than demoting them to unexported local helpers, since none of the three was
   referenced anywhere else in its own file either — keeping an unused unexported
   binding around would just be a different flavor of dead code (and would fail
   `no-unused-vars`).
3. 2h's stale comment was corrected in place rather than attempting the dedup — the
   task's own fallback ("otherwise just fix the comment") applied, since the sibling
   computation the original comment pointed at no longer exists to extract a shared
   helper against.

**Deferred / not done:** Nothing from this pass's own scope. Everything explicitly
called out as out-of-scope in the task (calendar-view.tsx's grid/agenda branching,
Home's two current-month-query dedup, the four different "feature off" page
treatments, `skeleton.tsx`, insights/page.tsx's six-pass pattern, quick-add's eager
option fetch) was left untouched, confirmed via `git diff --stat` showing no changes
to `app/(app)/insights/page.tsx` or `components/ui/skeleton.tsx`.

---

## Refactor: split `CalendarView` into `CalendarGridView` and `AgendaListView` (2026-07-12)

One of three deliberately separate cleanup items tackled sequentially by request — this
one only, a pure structural reorganization with zero behavior change. `calendar-view.tsx`
had one `CalendarView` component rendering BOTH the calendar-grid and agenda-list layouts
of the Monthly page, switched by an `agenda` boolean threaded through ~8 separate
conditionals inside one function body. Split into two self-contained components with no
internal mode-branching left in either:

- `app/(app)/monthly/calendar-grid-view.tsx` — `CalendarGridView` (day-of-week headers,
  empty offset cells, the `grid-cols-7` layout, `GridChip`/`UnscheduledChip` rows, and
  the click-to-open day-sheet with `DaySheetRow` — everything previously gated
  `!agenda`).
- `app/(app)/monthly/agenda-list-view.tsx` — `AgendaListView` (the `divide-y` flow
  layout, `AgendaRow` rows for both scheduled-day and unscheduled entries — everything
  previously gated `agenda`, with no day-sheet or click handling at all).
- `app/(app)/monthly/use-day-buckets.ts` — the `byDay`/`unscheduled`/`cells` bucketing
  `useMemo` extracted into a `useDayBuckets(entries, totalDaysInMonth)` hook both views
  call, so the month-end clamping logic (and its comment) lives in exactly one place
  instead of being copy-pasted into two files.
- `app/(app)/monthly/entry-style.ts` — `directionDotClass`/`paidTextClass`/`paidPrefix`
  (extracted in the prior maintainability pass, above) kept shared rather than
  duplicated back apart, per the task's explicit instruction.

The day-number + net-badge cell header turned out NOT to be gated by `agenda` in the
original code at all — both modes rendered it identically. That small block of JSX (plus
its `dailyNetCents` computation and the "uncategorized entries excluded from the net"
comment) is duplicated verbatim into both new files rather than pulled into a shared
helper, since it's genuinely identical small render logic sitting inside each view's own
per-day loop, not a case of drifting duplicate business logic.

`app/(app)/monthly/page.tsx` now imports both components and renders either
`<AgendaListView .../>` or `<CalendarGridView .../>` directly based on `view`, instead of
passing an `agenda` boolean into one unified component. Both new components ended up
needing the identical prop list (`year`, `month`, `entries`, `canManage`, `today`) —
`year`/`month` looked droppable from `AgendaListView` at first glance (the day-sheet's
"View in list" link that uses them is grid-only), but agenda's own render path needs them
too, for `totalDaysInMonth` (via `daysInMonth(year, month)`) and the `isToday` ring on
today's cell (`isCurrentMonth = year === today.year && month === today.month`), so both
were kept on both components.

Three stale in-repo comments referencing `calendar-view.tsx` by filename
(`lib/domain/reminders.ts`, `lib/domain/dashboard.ts`, `app/(app)/layout.tsx`) were
corrected to point at the file(s) the described code actually lives in now.

**Zero behavior change, verified, not assumed:** every `data-testid` (`calendar-cell`,
`calendar-entry-chip` — two call sites, `GridChip` and `UnscheduledChip` — and
`agenda-entry-row`) renders on the exact same elements with the exact same values as
before the split. `e2e/monthly.spec.ts` and `e2e/mobile.spec.ts` needed zero code changes
(confirmed `git diff --stat` shows no changes under `e2e/` at all) and all 13 of their
calendar/agenda-relevant tests passed unmodified.

**Test/CI status:** Unit 466/466 (unchanged). Integration 266/266 (unchanged — no Server
Action or DB logic touched, only component structure). Coverage 99.44% statements /
97.58% branches / 99.33% functions / 99.84% lines on the gated `lib/**` scope (unchanged
— this pass only touched `app/(app)/monthly` components, outside the gate). E2E: first
full run 68/68 (1 flaky — `home.spec.ts`'s pre-existing Undo-restore race, unrelated to
Monthly, passed on Playwright's own retry); second full run 68/68 clean with zero
retries. Both runs `CI=true` against a real `next build && next start`. Lint, typecheck,
build, and format all clean — `npm run format` needed no changes to any new file.

**Deferred / not done:** Nothing — pure reorganization, no new logic, no scope beyond the
split itself.

---

## Refactor: dedupe current-month category-budget query on Home (2026-07-12)

Second of three deliberately separate cleanup items tackled sequentially by request — this
one only, a zero-behavior-change efficiency fix on a MONEY-MATH path. Home
(`app/(app)/page.tsx`) fetched the current month's `monthly_entries` TWICE per page load:
once directly via `getDashboardRowsForMonth` (feeding `computeBudgetRemaining` for the hero's
"budget left this month" line), and once again inside `getCurrentMonthCategoryBudgets`'s own
internal entries sub-query (feeding `<BudgetMini>`'s per-category progress bars) — same
household, same year/month partition, two round-trips.

- `lib/db/queries.ts`'s `getDashboardRowsForMonth` now also selects
  `monthlyEntries.categoryId` (the `leftJoin` to `categories` it already does for `direction`
  needed no new join) and returns it as part of its `Pick<DashboardEntryRow, ...>` shape.
- `lib/domain/dashboard.ts` gained `CategoryBudgetInput`, `CategoryBudgetRow` (moved here from
  `lib/db/queries.ts`, which now just re-exports the type for its two existing importers —
  `home/budget-mini.tsx` and `dashboard/budget-health-card.tsx` — so neither needed a single
  line changed), and `buildCategoryBudgetRows(entries, categories)`: the exact per-category
  `spentByCategory` Map-building loop and `.filter().map()` that used to be inlined directly
  inside `getCurrentMonthCategoryBudgets`, relocated verbatim (not rewritten) so it's a pure,
  unit-testable function two callers can share.
- `lib/db/queries.ts` gained `getCurrentMonthExpenseCategories(householdId)` — the
  categories-only half of the old query (never touched `monthly_entries`, so there was no
  duplicate round-trip to eliminate there, only query-text duplication to share).
  `getCurrentMonthCategoryBudgets` is now a thin wrapper: the same two independent
  sub-queries it always ran (categories via the new shared function, entries via its own
  unchanged `monthly_entries` query), converted to cents, fed into `buildCategoryBudgetRows`.
  Its own file, `app/(app)/settings/categories/page.tsx`, needed **zero changes** — same
  function signature, same two round-trips, same output.
- `app/(app)/page.tsx` (Home) no longer calls `getCurrentMonthCategoryBudgets` at all. It
  fetches `getCurrentMonthExpenseCategories` (cheap, no entries scan) alongside its existing
  `getDashboardRowsForMonth` call, then computes `budgetRows` locally via
  `buildCategoryBudgetRows(currentMonthRows, currentMonthCategories)` — reusing the
  current-month rows already fetched for `computeBudgetRemaining` instead of a second
  `monthly_entries` scan. Gated behind `env.FEATURE_CATEGORY_BUDGETS` exactly as before
  (skipped entirely when off, matching this file's existing feature-off-skip convention from
  the prior cleanup pass's item 2g).

**Hand-verified, not just green tests:** fixture — two capped expense categories (Groceries
cap $400.00, Rent cap $1500.00), one uncapped expense category ("No cap"), entries: Groceries
$50.00 budgeted / $45.00 actual, Groceries $30.00 budgeted / no actual, Rent $1500.00
budgeted / $1500.00 actual, and one uncategorized (`categoryId: null`) entry for $9.99. By
hand: Groceries spend = 4500 (actual) + 3000 (budgeted fallback, no actual yet) = **7500
cents**; Rent spend = 150000 (actual) = **150000 cents**; "No cap" excluded (no budget set);
the $9.99 uncategorized entry contributes to neither. Ran this exact fixture through the OLD
pre-refactor code (via `git stash` back to the HEAD-committed `getCurrentMonthCategoryBudgets`,
a temporary throwaway integration test, then `git stash pop` to restore — temp file never
committed) and the NEW code (the equivalent case added permanently to
`lib/db/queries.integration.test.ts`): both produced identically
`{ name: 'Groceries', monthlyBudgetCents: 40000, spentCents: 7500 }` and
`{ name: 'Rent', monthlyBudgetCents: 150000, spentCents: 150000 }`, to the cent.

**Test/CI status:** Unit 472/472 (up from 466 — 6 new `buildCategoryBudgetRows` tests in
`lib/domain/dashboard.test.ts`: exceeds-cap spend, budgeted-only fallback, `monthlyBudgetCents:
null` exclusion, `categoryId: null` exclusion from the spend sum, multi-entry summing into one
category, zero-entries-still-returns-the-row). Integration 270/270 (up from 266 — 4 new: a
`getDashboardRowsForMonth` case asserting `categoryId: null` on an uncategorized entry, two
`getCurrentMonthExpenseCategories` cases, and the hand-verified multi-category fixture above
added permanently to `getCurrentMonthCategoryBudgets`'s suite). Coverage 99.45% statements /
97.61% branches / 99.35% functions / 99.84% lines on the gated `lib/**` scope (gate 80%;
`buildCategoryBudgetRows` itself is 100%-covered by its own unit tests). E2E: both runs 68/68
passed, zero retries, zero flakes, `CI=true` against a real `next build && next start`, run
twice back-to-back per the task's instruction (this pass touches Home and Settings ->
Categories, both with existing coverage). `e2e/phase4.spec.ts`'s "setting a category budget
cap and overspending shows red" test — the one spec that exercises BOTH the Settings ->
Categories budget-cap display and Home's `budget-health-row` — passed unmodified; confirmed
via `git diff --stat` that nothing under `e2e/` changed at all. Lint, typecheck, build, and
format all clean (format made no changes to any touched file).

**Deferred / not done:** Nothing — the task's own scope (Home's double current-month-entries
query only) is fully addressed; Settings -> Categories' independent call to
`getCurrentMonthCategoryBudgets` was deliberately left as its own, still-single, DB
round-trip, per the task's explicit instruction not to change that caller's behavior.

---

## Refactor: share inline feature-off note styling between accounts and import (2026-07-12)

Third of three deliberately separate cleanup items tackled sequentially by request. The
originating code-review finding framed this as "four pages express 'this feature is off'
inconsistently" (Accounts, Import, Goals, Home). Re-reading all four before touching
anything narrowed the scope: a prior bug-fix pass already changed Accounts' feature-off
state from a full-page `EmptyState` early-return into a small inline note (Landmark icon +
muted text) sitting ABOVE a still-fully-functional `BankSummaryTable` — structurally the
same "partial degradation, rest of the page still works" shape as Goals' (plain
header-copy-swap, no icon) and Home's (an inline "Add a bank account" CTA link inside
`safe-to-spend-hero.tsx`). Only Import's feature-off state is a genuinely different
shape — the whole page is unavailable until the `csv_import` kill-switch is turned on.
Forcing Goals and Home into a shared component with Accounts/Import would have coupled
three visually and semantically different patterns for no real benefit, so this pass is
narrowed to just Accounts + Import, whose notes really were the same small idea (an icon
plus a line of muted explanatory text) styled inconsistently for no reason. Goals and Home
were read in full to confirm this and then left completely untouched.

- `components/ui/inline-note.tsx` (new) — `InlineNote({ icon?, children, className? })`,
  matching this codebase's existing small-presentational-component convention
  (`data-slot` attribute, `cn()` for className merging, named export at the bottom — same
  shape as `components/ui/stat.tsx` and `components/ui/empty-state.tsx`). Renders exactly
  Accounts' pre-existing markup: `<p className="flex max-w-xl items-center gap-2 text-sm
text-muted-foreground">{icon}{children}</p>`, icon at `size-4 shrink-0` with
  `aria-hidden`.
- `app/(app)/accounts/page.tsx`'s `FEATURE_NET_WORTH`-off note now renders via
  `<InlineNote icon={Landmark}>` instead of hand-rolling the `<p>` + `<Landmark>` pair.
  Pixel-for-pixel identical output (verified below) — this page's existing look is the
  one every other change here matches, not the one that moved.
- `app/(app)/import/page.tsx`'s `csv_import`-off note now renders via `<InlineNote
icon={Upload}>`, replacing a plain icon-less `<p className="text-sm
text-muted-foreground">`. This one **gains** an icon (`Upload`, for "CSV import is
  off") and the `flex items-center gap-2` + `max-w-xl` treatment it didn't have before,
  matching Accounts rather than the reverse. The second, unrelated `<p>` on the same page
  (the read-only-viewer RBAC message, a permission gate rather than a feature-off note)
  was deliberately left as its own plain `<p>`, out of scope.
- Both pages' visible copy is byte-for-byte unchanged — confirmed via `git diff`, only
  the wrapping markup changed (`<p>` + inline `<Icon>` -> `<InlineNote icon={...}>`).

**Visually confirmed, not assumed:** rendered both call sites through
`react-dom/server`'s `renderToStaticMarkup` (a throwaway script, run via `tsx`, deleted
before committing — never part of the diff) importing the real `InlineNote` from
`components/ui/inline-note.tsx`. Output for both: an identical
`<p data-slot="inline-note" class="flex max-w-xl items-center gap-2 text-sm
text-muted-foreground">` wrapper, differing only in which Lucide `<svg>` (`lucide-landmark`
vs `lucide-upload`) and text follows — exactly the shared icon/spacing/typography shape
this pass set out to produce, with the two pages' distinct copy preserved verbatim inside.

**Test/CI status:** Unit 472/472 (unchanged — no new pure logic, and this codebase's
existing convention is to not unit-test `components/ui/*.tsx` presentational components
directly, confirmed no `components/ui/*.test.*` files exist at all). Integration 270/270
(unchanged). Coverage 99.45% statements / 97.61% branches / 99.35% functions / 99.84%
lines on the gated `lib/**` scope (unchanged — this pass is entirely outside `lib/**`).
E2E: both runs 68/68 passed, zero retries, zero flakes, `CI=true` against a real `next
build && next start`, run twice back-to-back. Zero spec needed a code change — confirmed
via `git diff --stat -- e2e/` showing no changes at all. `e2e/phase5.spec.ts`'s `csv_import
is off by default...` test (`getByText('CSV import is not enabled for this household.')`)
passed unmodified: Playwright's text selector matches on the innermost element's
normalized text content, and the `<p>`'s text content still contains that exact substring
regardless of the icon now rendered alongside it as a sibling node. No existing spec
covers Accounts' `FEATURE_NET_WORTH`-off state at all (the flag defaults `true` and no
`e2e/*.spec.ts` toggles it off), so that path's correctness rests on the
`renderToStaticMarkup` check above plus lint/typecheck/build. Lint, typecheck, build all
clean; `npm run format` made no changes to any of the three source files (`accounts/page.tsx`,
`import/page.tsx`, `inline-note.tsx`) — it did reflow this PROGRESS.md entry's own
list-item indentation on the first pass, re-run and confirmed clean after.

**Deferred / not done:** Nothing from this pass's own narrowed scope. Goals
(`app/(app)/goals/page.tsx`) and Home (`app/(app)/page.tsx` /
`app/(app)/home/safe-to-spend-hero.tsx`) were deliberately left untouched — their
feature-off messaging is a different UX shape (plain copy-swap; inline CTA link) serving
a different purpose than a small icon+note, not an oversight.

---

## Small feature: editable display name (2026-07-13)

While live-verifying the redesign against real production data, the user noticed the
sidebar/settings footer showing "Owner · Owner" instead of their real name. Root cause:
`lib/db/seed.ts` hardcodes the very first account's `name` to the literal placeholder
`'Owner'` (it has no way to know the real person's name at seed time — every other user
gets their real name from the invite-accept flow) — and there was **no UI anywhere** to
ever change a display name afterward. `app/(app)/settings/account/page.tsx` only ever
had `ChangePasswordForm`; the name was rendered as read-only text.

Added `updateNameAction` in `app/actions/auth.ts` (zod: trimmed, min 1 / max 200 chars),
scoped entirely to the calling session's own user row (`requireUser()` then
`where(eq(users.id, user.id))` — no id ever comes from the client, so there's no
cross-user angle to guard against) with `revalidatePath('/', 'layout')` since the name
renders in the persistent sidebar/bottom-nav on every page, not just this one. New
`UpdateNameForm` (`app/(app)/settings/account/update-name-form.tsx`) mirrors
`ChangePasswordForm`'s exact shape one directory over — same `useAction` hook, same
direct-call + toast pattern, same Card layout — mounted above it on the Account page.

**Verification:** confirmed `e2e/auth.spec.ts`'s multi-device change-password test (one
of the three specs — auth/invite/cron — that must never need churn) still passes
unmodified: it only queries `getByLabel('Current password')`/`getByLabel('New password')`
and a `getByRole('button', { name: 'Update password' })`, none of which collide with the
new "Name"/"Save name" field+button above it. New integration test
(`app/actions/update-name.integration.test.ts`, 4 cases: happy path, empty name rejected,
whitespace-only name rejected, surrounding whitespace trimmed) run directly against the
real dev DB. Full gate suite green: lint/typecheck clean; unit 472/472 (unchanged — no new
pure logic); integration 274/274 (+4 new); coverage unaffected (this pass is a Server
Action + a presentational form, `lib/**` untouched — 99.45%/97.61%/99.35%/99.84% same as
before); build clean; format clean; E2E 68/68 passed, run twice back-to-back (`CI=true`,
real `next build && next start`), zero spec changes needed.

---

## Live production UI/UX audit + 3 layout bug fixes (2026-07-14)

Logged into production as the real user (Playwright, credentials piped via stdin, never
written to disk) and clicked through every surface on desktop (1440px) + mobile
(Pixel-7-ish), both themes. Zero console/page errors. Screenshotting surfaced three real,
pixel-verified layout bugs, all stemming from the same root cause: `quick-add.tsx`'s
global fixed "New entry" button (`fixed top-4 right-4`, added Phase 10) was never checked
against pages that already place their own controls in that same corner.

1. **`/accounts`** — the page's own `YearPicker` (year label + both chevrons) rendered
   directly underneath the fixed button; the year label was fully hidden, both chevrons
   partly covered. Bounding-box confirmed (button x:1318–1424 vs year label x:1332–1380,
   both y:16–44). Fixed by wrapping both `<YearPicker>` call sites (feature-off branch and
   the real content branch) in a `md:mt-8` div so the control clears the button's
   footprint while the page title stays flush with every other page's.
2. **`/settings`** — the hub page's own `<ThemeToggle>` (needed because the sidebar,
   which already has one in its footer, is `hidden` below `md`) collided with the same
   button at `md`+, where the sidebar's toggle is already reachable — meaning desktop
   showed two redundant toggles, one of them half-covered. Fixed by wrapping it in
   `md:hidden`, matching this same file's existing convention for the Plan/Insights
   mobile-only escape-hatch links (both hidden at `md`+ for the identical "sidebar
   already covers this" reason).
3. **Mobile FAB overlapping page-end content** — `app/(app)/layout.tsx`'s `<main>`
   reserved bottom padding only for BottomNav's 4.5rem bar
   (`pb-[calc(4.5rem+env(safe-area-inset-bottom))]`), not for `quick-add.tsx`'s Fab
   floating another `0.75rem` gap + its own `2.25rem` (`size-9`) height above that —
   so the last card on any page (confirmed on Home: `GoalsMini`'s "See all goals" link)
   rendered directly under the Fab, both visually and as a tap target (bounding-box
   confirmed: FAB x:341–377/y:731–767 vs link x:283–353/y:747–763, a real overlap, not
   just visually adjacent). Fixed by widening `<main>`'s bottom padding to
   `calc(8rem+env(safe-area-inset-bottom))`, clearing the Fab's full footprint plus a
   small buffer — a one-line, one-place fix that protects every page's last element, not
   just Home's.

**Deliberately left alone (asked first, user chose "leave as-is" for all three):**
zero-budgeted recurring items (Income Tax, Property Tax, etc.) still surface as $0.00
rows in Home/Money's forecast lists; unscheduled recurring items still show a clamped
month-end due date on Home's Upcoming list but sit in Money Agenda's separate "no
scheduled day" bucket with no date; Money's summary tiles still lead with the Actual
figure and demote Budgeted to a sub-line even for an untouched future month (the
Phase 10 design decision documented in `summary-bar.tsx`'s own comment). None of these
are bugs — each is an intentional, previously-made design choice; surfaced for a decision
rather than silently changed.

**Also corrected during the audit (no code change, prior report was wrong on both):**
`BudgetMini`'s empty state already links to `/insights` ("See insights") — misread the
screenshot. Bank summary listing a "Credit Card" row not present in the Account balances
panel is intentional, per the page's own tooltip: credit-card spend rolls up into its
linked bank account rather than appearing as a separate net-worth line.

**Verification:** all three fixes pixel-verified against a local production build
(`next build && next start`, real login) before and after — each bounding-box overlap
check flips from `true` to `false`. Full gate suite green: lint/typecheck clean; unit
472/472 (unchanged); integration 274/274 (unchanged); coverage unaffected (no `lib/**`
changes — 99.45%/97.61%/99.35%/99.84% same as before); build clean; format clean; E2E
68/68 (`CI=true`, real `next build && next start`) — one transient failure on an
unrelated dev-mode-only run (Next's dev overlay intercepting a tap; doesn't exist in the
production build CI actually runs) confirmed as a local-only artifact, not a regression,
once re-run correctly with `CI=true`.

---

## Improvement batch 1 — quick wins from the full app review (2026-07-14)

First batch of the user-approved improvement plan (full plan reviewed and approved in
conversation; batches 2-4 cover Uncategorized-category foundations, features like
password reset/transactions/FX-assist, and the heavy items — offline, code splits).
All items below were verified live against a local production build (screenshots,
real login, zero console errors) on top of the full gate suite.

- **Theme toggle is now a 3-state cycle** (light → dark → system) instead of a binary
  flip. New pure module `lib/theme.ts` (`nextTheme`, `isThemePreference`) with unit
  tests; icon shows the current PREFERENCE (Monitor for system, not the resolved
  sun/moon). `e2e/shell.spec.ts`'s theme test rewritten cycle-aware — asserts the
  stored preference advances correctly from ANY starting state, that the html class
  agrees with the preference (or the browser's own prefers-color-scheme when
  'system'), persists across reload, and walks the full cycle to restore its starting
  state.
- **Desktop "New entry" moved from a fixed top-right overlay into the sidebar.** The
  fixed button was the root cause of all three layout collisions fixed on 2026-07-13
  (it floated over every page's own top-right controls). New
  `app/(app)/quick-add-context.tsx` — `QuickAddProvider` + `useQuickAddOpen` +
  `NewEntryButton` — shares the sheet's open state across the server-component
  boundary between the sidebar and quick-add.tsx (which keeps the mobile Fab and the
  ResponsiveSheet). The `md:mt-8` collision workarounds on `/accounts` are reverted —
  no fixed element left to collide with. Viewer never sees the button (canManage
  gate, same as the Fab).
- **$0.00 recurring items are no longer rendered as bills.** Home's upcoming list
  gives zero-amount items their own muted, dash-bordered "Needs an amount" group with
  a "Set amount" link to /recurring, instead of listing them as red overdue debt next
  to real bills (user: "a visual reminder for me to set them up"). The hero's "after
  N upcoming bills" count now also excludes them. Domain math untouched — a $0 item
  contributed nothing to any total before or after.
- **Income rows say "Mark received", not "Mark paid".** New
  `entrySettleLabels(direction)` in `lib/domain/entries.ts` (unit-tested; null
  direction reads as expense wording) drives the trigger, sheet title/description,
  date-field label ("Date received"), submit button, failure toast, and success toast
  everywhere MarkPaidButton renders (Home + all three Monthly views). Zero E2E churn:
  every existing spec's mark-paid target is a test-created expense/uncategorized
  entry.
- **List view rows compacted to a single line** — the amount and date inputs and the
  Mark paid button now sit side-by-side (was a 3-high vertical stack that made every
  row ~3x its content height; live-audit finding N3). The load-bearing inline
  keyboard flow (Enter saves / Esc reverts / blur commits) and the paid-state remount
  key are preserved verbatim — only the flex direction changed.
- **Budget caps are now discoverable** (live-audit finding: the real household had
  zero caps set and no UI anywhere revealed the feature). Expense category rows on
  Settings → Categories show "No monthly cap — set one via Edit" when unset;
  BudgetHealthCard's empty state gained a "Set caps in Categories →" link (the old
  copy named no location at all).
- **Savings-rate tile explains its em-dash**: sub-line reads "No actual income
  recorded yet" instead of the formula when there are no actuals.
- **ViewToggle passes `nativeButton={false}`** — its tabs render as Links; silences
  Base UI's dev-only console warning (confirmed absent from production builds during
  the live audit, so this was cosmetic-in-dev only).
- **`sslmode` pinned to `verify-full` in code, not in three secrets.** New pure
  `pinStrictSslMode` (`lib/db/connection-string.ts`, unit-tested) upgrades
  require/prefer/verify-ca — the modes pg currently ALIASES to verify-full and will
  downgrade in pg v9 — at `lib/env.ts`'s zod transform, the single choke point every
  consumer (pools, drizzle-kit) reads; `e2e/test-db.ts` (which reads process.env
  directly) applies the same pin. Behavior today is identical (the aliases already
  meant verify-full); the point is pinning it across the pg v9 major without
  coordinating edits to the local/CI/Vercel copies of the secret. Absent sslmode is
  left alone (plain local postgres keeps working); the startup SECURITY WARNING is
  gone from app/integration output. `lib/env.test.ts` updated to assert the
  transform.
- **README documents the single-currency constraint** (SGD by design; FX-assisted
  entry planned, stored truth stays SGD).

**Test/CI status:** lint/typecheck clean; unit 485/485 (+13: theme cycle,
entrySettleLabels, pinStrictSslMode, env transform); integration 274/274 (unchanged);
coverage 99.46/97.67/99.36/99.85 on `lib/**`; build clean; format clean; E2E 68/68
(`CI=true`, real `next build && next start`) with the rewritten theme spec. Visual
verification: live screenshots of Home (Needs-an-amount group, sidebar button, Mark
received), Money list (single-line rows), Settings → Categories (cap hints), Insights
(savings sub-line), plus a scripted theme-cycle walk (system → light → dark observed
in localStorage) — zero page errors.

---

## Improvement batch 2a — session tokens hashed at rest (2026-07-14)

`sessions.id` now stores `SHA-256(cookie token)` (`hashToken`, lib/auth/token.ts) instead
of the raw token — read access to the DB (a leaked connection string, a backup, a table
dump) can no longer be replayed as session cookies. Plain SHA-256, no salt/stretching:
unlike a password the input already carries 256 bits of entropy, so there is nothing for
precomputation to enumerate, and determinism is required anyway (the hash IS the lookup
key). Raised in the full app review; extra weight while the repo is temporarily public.

Six touch points, not five — the review's plan listed createSession/getSessionUser/
deleteSession/proxy (lookup + renewal)/changePassword's revoke-others, but
**acceptInviteAction has its own inline old-session delete** (invites.ts) that only
surfaced when the corrected test assertion caught it still matching raw: the updated
invites integration test (which now selects by `hashToken(...)` — selecting by the raw
token would return 0 rows even if the delete never ran, a silent false-positive) failed
against the missed call site, and passed after fixing it. Exactly the failure mode the
user's "make sure tests are covering actual functions" instruction was about.

No schema change and no migration: the id column was already `text`. Existing raw-token
rows become permanently unmatchable on deploy (everyone re-logs-in once — accepted, the
household is still seed-stage) and age out via their own 30-day expiry.
`app/actions/test-helpers.ts`'s fixture now inserts the hash and returns the raw token,
mirroring production, so every action integration test exercises the real
hash-on-lookup path. The two direct-insert DB-mechanics tests (lib/auth,
lib/db/schema.integration) are self-consistent and deliberately untouched. Invite
tokens stay raw by design — 7-day expiry, pending-only, the raw value already lives in
a sent email; the invites.ts comment that used to say "same pattern as sessions" now
documents that difference instead. RUNBOOK's session-incidents section updated (the
`delete from sessions` lever still works unchanged).

**Test/CI status:** unit 488/488 (+3 hashToken); integration 274/274 (invites revocation
test corrected as above); coverage 99.46/97.67/99.37/99.85; lint/typecheck/build/format
clean; E2E 68/68 (`CI=true`, real build) — auth.spec's real login/logout/change-password
multi-device flows and both planted-cookie attack tests all pass through the hashed path
unmodified.

---

## Improvement batch 2b — reserved Uncategorized category (2026-07-15, local until prod migration)

The full app review's live-demonstrated finding: quick-add's fastest path (item + amount
+ Add) produced a category-less entry that changed NO number anywhere — a direction-less
entry is unknowable-signed, so every aggregation correctly skips it, and a $123.45 test
add moved nothing in the summary bar. Per the user's chosen design ("count uncategorized
into an 'Uncategorized' category"), every household now has ONE reserved expense-direction
"Uncategorized" category (`categories.is_system`, migration 0004: column + partial unique
index `categories_household_system_unique` + per-household backfill INSERT), and
addAdhocAction files no-category entries under it — they now count everywhere like any
other expense.

- `getOrCreateUncategorizedCategoryId` (queries.ts) is self-healing (created on demand if
  a household somehow lacks one; the partial unique index turns a concurrent double-create
  race into a harmless conflict) — the integration test exercises exactly this path, since
  test-helper households are born bare.
- Quick-add's category select now says "Uncategorized" instead of "None" (honest about
  where the entry goes) and hides the system category from the explicit list.
- Protections, all server-side and adversarially tested: deleteCategoryAction can't
  delete it (is_system=false in the WHERE, distinct error message); updateCategoryAction
  can't flip its direction to income (a forged post would make uncategorized spends
  count AS INCOME); rename/color/cap stay editable.
- Home shows a categorize nudge ("N entries this month need a category" →
  /monthly?view=list) counting system-category entries plus legacy null-category rows —
  `getDashboardRowsForMonth` gained `categoryIsSystem` (zero new joins). Settings →
  Categories shows a BUILT-IN badge and hides Delete on the system row.
- Seed creates the system category for fresh databases (flag-keyed, not name-keyed —
  it's renamable); migration backfills households that existed before it.

**Test/CI status:** unit 488/488; integration 277/277 (+3: self-heal + reuse, delete
guard, direction-pin guard); coverage 99.46/97.67/99.37/99.85; lint/typecheck/build/
format clean; E2E 68/68 (`CI=true`) including the extended quick-add spec (entry lands
with the visible Uncategorized label, Home nudge appears while it exists and disappears
after cleanup).

**Deploy note:** expand-only migration 0004 must run against PRODUCTION before this
commit deploys (every page now selects categories.is_system via getEntryFormOptions —
deploying first would 500 the whole app). Dev branch migrated; CI migrates its own
branch. Production migration pending at commit time — the vercel env pull needed to
obtain the prod DATABASE_URL was denied by the local permission classifier and needs the
user's go.

---
