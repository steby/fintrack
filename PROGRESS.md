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

**`/code-review` pass on the above (before starting Phase 3), 14 findings, 9 fixed:**

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

<!--
Copy the block above for each new phase. Keep sections in phase order. Convert relative
dates to absolute (e.g. "today" -> the actual date) so the log stays readable later.
-->
