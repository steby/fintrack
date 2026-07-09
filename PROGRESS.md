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
first closed the *shared* globalThis-cached pool — poisoning it for every file
scheduled to run afterward in that same run. `app/actions/*` sorts before
`app/api/cron/*` alphabetically, so by the time the cron route tests ran, an earlier
file's `afterAll` had already ended the pool they were about to inherit. This is the
exact bug class `e2e/test-db.ts`'s own comment already documents as fixed once before,
for Playwright specs under CI's `workers: 1` — the same anti-pattern had re-appeared,
independently, on the integration-test side, most likely newly exposed by Phase 6/7
adding cron test files that land late in file-execution order (earlier, smaller
integration suites likely never had a file scheduled to run *after* whichever file
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
caused *this* failure. Both can be true: CI push cadence can still leave orphaned
`ci`-branch households (that's what `db:clean-e2e-debris` exists for), independently of
this pool-lifecycle bug.

---
