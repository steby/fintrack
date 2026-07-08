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

---

<!--
Copy the block above for each new phase. Keep sections in phase order. Convert relative
dates to absolute (e.g. "today" -> the actual date) so the log stays readable later.
-->
