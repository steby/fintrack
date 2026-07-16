# RUNBOOK

Operational procedures for the top failure scenarios. This is a Tier-2 household app (see
`development-workflow.md`) — no on-call rotation, no SLOs, one maintainer. The goal here is
"know what to check and what to do," not a formal incident process.

## First check, always

`GET /api/health` → `{ ok, db: 'up'|'down' }`, 200 if the DB answered within 2s, 503
otherwise. Check this first for anything that looks like an outage — it tells you in one
request whether the problem is "the app is down" or "the app is up but something downstream
isn't."

Structured logs (pino) are the source of truth for everything else. In production every
caught error is logged with context (never swallowed silently — see `development-workflow.md`'s
non-negotiable rules); if `SENTRY_DSN` is set, the same errors are also forwarded to Sentry via
`lib/observability.ts`. `SENTRY_DSN` is provisioned in production (Vercel env) as of
2026-07-10 — check the Sentry dashboard first for anything error-shaped, then fall back to
structured logs for context Sentry doesn't capture.

---

## Environment map

Three persistent environments, one per Neon branch — deliberately no separate
"staging" (see `PROGRESS.md`'s environment-audit entry for the reasoning):

| Context                          | Neon branch  | `DATABASE_URL` lives in               |
| -------------------------------- | ------------ | ------------------------------------- |
| Production (fintrack.steby.net)  | `production` | Vercel → Production env vars          |
| Preview (every PR/branch deploy) | `dev`        | Vercel → Preview env vars             |
| GitHub Actions CI                | `ci`         | GitHub repo secret `DATABASE_URL`     |
| Local development                | `dev`        | local `.env` (same branch as Preview) |

Every Vercel env var in this project — all of Production and Preview, not just
`DATABASE_URL` — was created as Vercel's **Sensitive** type: write-only by design.
Once set, the value can never be read back through the dashboard or the CLI
(confirmed 2026-07-11 — `vercel env pull` returns an empty string for every single
one, including harmless flags like `FEATURE_PWA`, not just real secrets). If you
ever need to know a current value, you can't look it up; the only options are
re-deriving it (Neon's API returns a branch's connection string on demand) or
resetting it outright to a known value.

`ci` gets its own branch rather than sharing `dev` on purpose: its debris-sweep
step (`clean-e2e-debris.ts`) deletes anything older than 5 minutes, which is only
safe to run unattended because `ci` is understood to hold nothing but disposable
test data. Running that same sweep against a branch also used for real local
exploration would mean CI silently deleting work in progress — and this project
has already hit real incidents (an accidental unscoped `DELETE` from a throwaway
script, per Phase 1's real-bugs entry in `PROGRESS.md`) that a shared branch would
have made worse.

---

## Everything feels slow

**Check the Vercel function region matches Neon's region first** — this is the
single most likely cause, and it's not visible from the code, only from the
dashboard. Production functions were left on Vercel's account default
(`iad1`, Washington D.C.) while Neon's database has always been in
`ap-southeast-1` (Singapore) — every request was paying a US-East↔Singapore
round trip (~400-500ms) on top of actual work, compounding on any page with
multiple queries. Fixed 2026-07-11 (Vercel dashboard → Project → Settings →
Functions → Function Region → Singapore, then a fresh deploy to pick it up —
region changes only apply to the next build, never retroactively). Verify via
the `x-vercel-id` response header (`curl -sD- -o /dev/null <url>/api/health`)
— it should read `sin1::sin1::...`, not `iad1::...`. If a future region
change (new Neon branch in a different region, moving providers, etc.) ever
puts these back out of sync, this is the first thing to check when "the app
feels slow" shows up again.

---

## Neon Postgres is down or slow

**Symptom:** `/api/health` returns `db: 'down'`, or requests are slow/timing out.

1. Check [Neon's status page](https://neonstatus.com) and the project dashboard for the
   branch `DATABASE_URL` points at.
2. The app fails loud, not silent, here: `proxy.ts`'s session check treats a DB error as
   "unauthenticated" (fail closed, not fail open — a transient outage never grants access) and
   logs `proxy: session lookup failed, treating request as unauthenticated`. Users will see
   themselves logged out / redirected to `/login`, not a crash.
3. Every query goes through one of two pools (`lib/db/index.ts`), each with both a
   server-side `statement_timeout` and a client-side `query_timeout` — a wedged connection
   can't hang a request forever (main pool: 30s/35s; health-check pool: 8s/10s, isolated so a
   hung main pool can't also starve `/api/health`).
4. Nothing to do on the app side beyond waiting out a Neon-side incident — there's no
   secondary DB or read replica in this Tier-2 setup. If it's a connection-limit exhaustion
   (`max` is 10 in production, 5 in dev — see `lib/db/index.ts`), check for a stuck deploy or
   runaway process holding connections open; restarting the app (redeploy) releases the pool.

## Resend is down, or emails aren't sending

**Symptom:** reminder/recap emails aren't arriving; cron runs report `sent: 0` unexpectedly,
or errors in logs from `lib/email/resend.ts`.

1. This integration is **keys-optional**: without `RESEND_API_KEY` set, `sendEmail` in
   `lib/email/resend.ts` never calls Resend at all — every "send" is logged instead
   (`RESEND_API_KEY not set — logging email instead of sending it`). If reminders were never
   expected to actually deliver, confirm the key is really meant to be set before treating
   this as an incident.
2. With a key set, every send gets a 5s timeout and up to 2 retries with exponential backoff
   (500ms, 1000ms — `SEND_TIMEOUT_MS`/`MAX_RETRIES`/`RETRY_BASE_DELAY_MS` in
   `lib/email/resend.ts`). A resolved `{ data: null, error }` response (Resend's own
   API-level failure shape — bad/restricted key, rate limit, quota) is treated as a failure
   and retried the same as a thrown exception or timeout.
3. After retries are exhausted, the failure is **logged and degraded** — `Failed to send
email after retries; degrading (not sent)` — never thrown up to crash the cron route. One
   recipient's permanent failure doesn't block other recipients or other households in the
   same run (each household is in its own try/catch — see `app/api/cron/*/route.ts`).
4. Check [Resend's status page](https://resend-status.com) and the Resend dashboard for the
   account's actual API key validity/quota.
5. A failed send is **not retried on a later cron run** — the dedup ledger (`email_log`,
   `claimEmailSlot`) is only claimed right before the send loop, after confirming there's
   real content and real recipients, so a household that failed to send today will be
   attempted fresh next period, not blocked. There is no cross-run retry queue by design (see
   `lib/db/queries.ts`'s `claimEmailSlot` doc comment) — if a real outage caused a whole
   day/month of emails to be missed, there is no automatic backfill; it was simply skipped
   for that period.

## Bad deploy — rollback

The app is deployed to Vercel, live at **<https://fintrack.steby.net>** (auto-deploys from
`main` on push — see `PROGRESS.md`).

1. **Instant rollback:** Vercel keeps every prior deployment immutable and instantly
   promotable — from the Vercel dashboard's Deployments list, select the last known-good
   deployment and "Promote to Production." This does not run a new build; it repoints
   production traffic at an already-built, already-tested artifact, so it's the fastest
   possible recovery for a bad frontend/API deploy.
2. **Migrations are expand-only** (`development-workflow.md`: "migrations are
   backward-compatible / expand-then-contract, so a code rollback never needs a
   down-migration"). A rollback to the prior deployment is safe against the current schema
   without needing to also roll back the database — the old code was written to tolerate the
   new (expanded) schema shape. Never write a migration that drops/renames a column or table
   in the same phase that stops using it; that's a follow-up migration, once nothing depends
   on the old shape.
3. **Never run `npm run db:migrate` as part of the app boot or a Vercel build step** — it's a
   distinct, deliberate pre-deploy action (`development-workflow.md`: "Run DB migrations as a
   distinct pre-deploy step, never bundled silently into app boot"). If a bad deploy shipped a
   migration, rolling back the app code does not roll back the migration — expand-only
   migrations mean this is safe to leave applied; only write a follow-up migration to correct
   it, never hand-edit the schema.
4. **Cron jobs** (`vercel.json`) point at whatever's currently in Production — a rollback
   takes effect for the next scheduled cron invocation with no separate action needed.

## Kill-switch usage

Four runtime kill-switches (`lib/flags.ts`), stored per-household in `household_settings`,
toggled from **Settings → Notifications** (`email_reminders`, `monthly_recap`) or the
relevant feature's own settings surface (`csv_import` on `/import`, `auto_generate` has no UI
toggle yet — see below), owner-only. No redeploy required — this is the entire point of a
kill-switch over an env var.

| Flag              | Default | What flipping it off stops                                                                                                                                                                                             |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto_generate`   | on      | The Monthly page's on-page-load auto-materialize of the next 3 months. Turn off if a bug in `lib/generate-entries.ts` is producing bad forecast rows.                                                                  |
| `csv_import`      | off     | The entire `/import` upload/preview/commit flow (server-side, not just hidden UI — `requireConfigFlag`-equivalent checks run in the actions themselves). Turn off if a malicious/malformed upload is causing problems. |
| `email_reminders` | off     | The daily reminders cron (`/api/cron/reminders`) no-ops for that household.                                                                                                                                            |
| `monthly_recap`   | off     | The monthly recap cron (`/api/cron/recap`) no-ops for that household.                                                                                                                                                  |

**Propagation delay:** flags are cached in-memory per `(household, flag)` pair for up to 30s
(`CACHE_TTL_MS` in `lib/flags.ts`) — a toggle can take up to 30 seconds to take effect on a
given server instance. This is a deliberate tradeoff (avoids a DB round trip on every
`isEnabled` check) — if you need a flag to take effect **immediately** during an active
incident, note the 30s isn't instant and plan accordingly (e.g. don't assume the very next
request after toggling is guaranteed to see the new value).

`auto_generate` currently has no dedicated Settings UI toggle (all three others do). To flip
it during an incident, set it directly via SQL:

```sql
insert into household_settings (household_id, key, value)
values ('<household-id>', 'auto_generate', 'false')
on conflict (household_id, key) do update set value = excluded.value;
```

## UI primitives (Phase 8-11 redesign) — failure modes

The "modern fintech" redesign (spec.md Phases 8-11) introduced a small set of base-ui
wrappers in `components/ui/` (`dialog.tsx`, `drawer.tsx`, `responsive-sheet.tsx`,
`toast.tsx`, `switch.tsx`, `progress.tsx`, `tabs.tsx`, `tooltip.tsx`, `stat.tsx`,
`fab.tsx`, `empty-state.tsx`, `skeleton.tsx`). None of them sit on the trust boundary
(they're presentation, not auth/data), but a few have real, non-obvious failure modes
worth knowing before assuming "the UI looks broken" means "the feature is broken":

- **A Server Action's mutation always completes even if its toast never renders.**
  Every toast tied to a Server Action in this codebase (mark-paid, kill-switch toggles,
  invite/password-change confirmations, member remove, etc.) fires from a **direct call
  inside `startTransition`**, not `useActionState` — see
  `app/(app)/home/mark-paid-button.tsx`'s comment for the real bug (a race between
  `useActionState`'s own state update and a `revalidatePath`-driven re-render that
  unmounts the exact component holding that state) this pattern was adopted to fix. If
  `ToastProvider` (mounted once in `app/layout.tsx`) is ever missing from the tree —
  e.g. a future refactor accidentally moves a page outside it — `useToastManager()`
  throws at render time in that subtree; it does NOT silently swallow the mutation
  itself. A report of "I clicked X and nothing seemed to happen" should be verified
  against the actual data (did the row/flag/value change?) before assuming the action
  failed — the write path and the feedback path are two separate concerns by design.
- **Toast propagation delay is separate from kill-switch propagation delay.** A
  kill-switch toggle's own up-to-30s in-memory cache (see "Kill-switch usage" above) is
  unrelated to the toast confirming the toggle succeeded — the toast fires the instant
  the write commits; a stale cached read elsewhere in the app during that ~30s window is
  the flags cache doing its documented job, not the toast lying.
- **`ResponsiveSheet` defaults to a Dialog (not a Drawer) until the client has mounted
  and measured the viewport** (`components/ui/responsive-sheet.tsx`'s `useIsDesktop`
  hook, via `useSyncExternalStore` — a hydration-safe read, never a `useEffect` +
  `setState`). On a genuinely narrow viewport this means a sheet can render as a
  centered Dialog for one frame before flipping to a bottom Drawer; this is a
  known, harmless flash, not a bug to chase, and matches the plan's own explicit
  WISDOM note ("render nothing until mounted OR default to Dialog — Dialog is the
  safer of the two to flash-render since it has no gesture/swipe state to tear down").
- **Drawer (bottom sheet) safe-area on iOS**: `drawer.tsx`'s `DrawerContent` pads its
  bottom edge with `env(safe-area-inset-bottom)` specifically so the sheet's own
  actions aren't obscured by the iOS home-indicator bar. If a future edit wraps the
  Drawer's content in an additional fixed-position container without carrying that
  padding through, the symptom is "the bottom button is unreachable/behind the home
  bar on an iPhone" — check for exactly this padding having been dropped, not a broader
  layout regression.
- **A viewer never even receives the components that would fire a toast** — every
  write-triggering trigger (Fab/`New entry`, kill-switch Switches, mark-paid buttons,
  Edit/Delete buttons) is gated server-side by `canManage`/`can(role, ...)` the same as
  every prior phase's write affordances, not merely hidden by CSS; there is no
  "read-only user sees a broken button" failure mode by construction, only "read-only
  user sees no button at all."
- **The service worker never caches authed pages** — `app/sw.js/route.ts`'s fetch
  handler intercepts `_next/static/*`, the fixed PWA asset list
  (`lib/pwa/static-paths.ts`), and — since the offline-support pass — navigations, but
  navigations are network-ONLY with a single precached, public, data-free `/offline`
  fallback served on network failure; no live page route, RSC payload, or Server
  Action response is ever cached by it. A stale toast/dialog/switch UI from a cached
  page is therefore still not a failure mode the SW can cause — verify by checking the
  request in DevTools' Network tab was actually served `(ServiceWorker)` before
  assuming the SW is implicated in anything UI-related. If users report seeing "You're
  offline" while online, the network fetch inside the SW is failing (server down, DNS)
  — the fallback is doing its job; fix the outage, not the worker.

## Session / auth incidents

Sessions are opaque random tokens (`lib/auth/session.ts`) validated by a `sessions` table row
lookup in `proxy.ts` on every request — not signed/stateless tokens, so **there is no
"rotate a secret to invalidate everything" lever**. The `sessions.id` column stores
`SHA-256(cookie token)` (`lib/auth/token.ts`'s `hashToken`), never the raw token — a leaked
table dump or backup cannot be replayed as session cookies, and matching a specific cookie
to its row requires hashing the cookie value first. To force a full sign-out of every user
(e.g. suspected session-store compromise), delete the sessions directly:

```sql
delete from sessions;
```

Every active user is redirected to `/login` on their next request (`proxy.ts` treats a missing
session row as unauthenticated). To revoke one user's sessions only, scope the same delete by
`user_id`.

`SESSION_SECRET` (env) is validated at boot (min 32 chars) but is not currently consumed by
the session-token logic itself, since tokens are DB-verified rather than signed — see
`PROGRESS.md`'s Phase 7 entry for why this wasn't changed here (out of scope for a mobile/ops
phase; not a security gap, since DB-verified opaque tokens don't need a signing secret).

## Backups & restore

Neon continuously archives WAL, giving point-in-time recovery (PITR) without a separate
backup job to maintain — "restore" means branching from a past timestamp, not restoring
from a snapshot file. Retention window depends on the Neon plan (check the project's
current plan in the Neon console before assuming how far back you can go).

**Procedure** (used for real in the drill below, via the Neon API — the same steps work
from the Neon console's branching UI if the API/`NEON_API_KEY` isn't available):

1. Identify the project id and the affected branch id:
   `GET /projects?org_id=<org>` then `GET /projects/{project_id}/branches`.
2. Pick a restore point (an RFC3339 timestamp before the incident) and create a new
   branch from it:
   `POST /projects/{project_id}/branches` with body
   `{ "branch": { "parent_id": "<branch_id>", "parent_timestamp": "<ISO timestamp>" }, "endpoints": [{ "type": "read_write" }] }`.
   This provisions a fully independent, queryable branch — the original branch is
   untouched, so there's no risk of clobbering current data while investigating.
3. Fetch its connection string:
   `GET /projects/{project_id}/connection_uri?branch_id=<new_branch_id>&database_name=neondb&role_name=neondb_owner`.
4. Verify the restored data looks right (row counts, spot-check specific rows) before
   deciding to actually cut over — e.g. by repointing `DATABASE_URL` at the new branch,
   or by manually copying back just the rows that were lost.
5. Once satisfied (or once you've extracted what you needed), delete the temporary
   branch: `DELETE /projects/{project_id}/branches/{new_branch_id}` — it's a real
   compute + storage resource and shouldn't be left running.

**Restore drill (run for real, 2026-07-09, against the `dev` branch,
`wispy-mud-25959522`):**

1. Baseline: 58 rows in `households` at `2026-07-09T11:42:00.470Z`.
2. Inserted a uniquely-named marker household — count became 59.
3. Created a new branch (`parent_timestamp` = the baseline moment, before the insert)
   via the API. Neon returned `201` and provisioned a live compute endpoint from that
   exact point.
4. Connected to the restored branch and queried it directly: **58 households, 0 marker
   rows** — an exact match for the pre-insert baseline, confirming the restore
   correctly excluded the later write rather than, say, silently including it or
   restoring to the wrong point.
5. Cleaned up: deleted the marker row from `dev` (back to 58) and deleted the temporary
   branch. Confirmed via a fresh branch listing that only `production`/`dev`/`ci`
   remained afterward — no leftover resources.

Tier-2's "tested restore procedure" promise (`development-workflow.md`: "an untested
backup is not a backup") is satisfied by this run, not just by the procedure being
written down.
