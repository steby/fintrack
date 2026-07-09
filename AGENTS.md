# FinTrack — Agent Entry Point

This repo follows a strict Phase-Driven, Test-Backed methodology. Before doing **any** work
here, read in order:

1. [`development-workflow.md`](./development-workflow.md) — the process itself (rigor tier,
   phase execution loop, Definition of Done, non-negotiable rules). Follow it for all work.
2. [`spec.md`](./spec.md) — the approved scope, data model, feature matrix, and numbered phase
   plan. **This spec is already approved — do not re-run Step A (spec) or Step B (phase plan).**
   If a technical limitation forces a design change, update `spec.md` immediately rather than
   silently deviating.
3. [`PROGRESS.md`](./PROGRESS.md) — the living log. Read the last entry to see which phase is
   current and what's already shipped before starting new work.

Reference project: `../FinanceTracker`, the original single-user SvelteKit app this rebuild
functionally cloned and expanded, was kept read-only alongside this repo through Phase 5 (CSV
export fix referenced its broken query). All phases (0–7) are now complete and the app is
deployed to production — the reference project has been removed from the workspace and is no
longer needed.

Rigor Tier: **2** (Core + Hardened, pragmatic — see `spec.md` for the exact scope of what's
hardened vs. deliberately skipped).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from
your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing
any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
