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

**Deferred / blocked:** None. Resend/Sentry remain unconfigured (keys-optional by design — not
a gap, the intended state until those integrations are actually needed in later phases).

---

<!--
Copy the block above for each new phase. Keep sections in phase order. Convert relative
dates to absolute (e.g. "today" -> the actual date) so the log stays readable later.
-->
