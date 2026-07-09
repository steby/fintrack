// Loads .env for local integration test runs (real Neon "dev"/"ci" branch credentials).
// In CI, GitHub Actions injects env vars directly, so a missing .env here is a no-op.
import 'dotenv/config';
import { vi } from 'vitest';

// Shared across every *.integration.test.ts file in this project (setupFiles runs
// before each one) — a code-review pass found these two hand-copied into 14 and 9
// files respectively (app/actions/*, app/api/cron/*) with zero per-file variation,
// verified empirically by moving them here first and confirming a real integration
// file's tests still passed unchanged. `server-only` always throws when imported
// outside Next's own bundler (its literal implementation, meant to catch an
// accidental client-component import at build time) — mocked to a no-op so these
// Server Actions/routes can run against a real database outside a real Next request.
// `next/cache`'s revalidatePath needs Next's request-scoped static-generation store,
// which doesn't exist here either. Files that never exercise either import (e.g.
// lib/db/*.integration.test.ts) simply never trigger these mocks — harmless no-ops.
//
// NOT moved here: vi.mock('next/headers', ...) and vi.mock('next/navigation', ...) —
// those genuinely vary per file (each reads its own local mockToken/
// mockForwardedFor variable, or throws a distinct catchable marker for redirect()),
// so they correctly stay local to each test file.
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
