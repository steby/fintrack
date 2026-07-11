import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      // Scope coverage to pure/testable logic, per spec.md: "80% on lib/** pure logic
      // (not UI glue)". UI components, route handlers, and Server Actions are exercised
      // by Playwright E2E instead.
      include: ['lib/**'],
      exclude: [
        'lib/**/*.test.ts',
        'lib/**/*.integration.test.ts',
        // DB plumbing — needs a live connection, exercised by integration tests and
        // /api/health, not meaningfully unit-testable in isolation.
        'lib/db/index.ts',
        'lib/db/migrate.ts',
        'lib/db/schema.ts',
        'lib/db/seed.ts',
        'lib/db/clean-e2e-debris.ts',
        'lib/db/queries.ts',
        // Same reasoning as the DB plumbing above: every code path in here touches the
        // real household_settings table (even the cache-hit path needs a real DB read
        // to populate the cache first) — exercised by lib/flags.integration.test.ts.
        'lib/flags.ts',
        // Same shape and reasoning as lib/flags.ts immediately above — a thin
        // household_settings accessor with no cache to even exercise a "pure" branch
        // of; every path needs a live DB — exercised by lib/settings.integration.test.ts.
        'lib/settings.ts',
        // Every path here does a real recurring_schedule read + monthly_entries bulk
        // insert — exercised by app/actions/recurring.integration.test.ts's
        // generateAction tests (a thin wrapper around this) and the Monthly page's
        // auto-generate hook (covered by e2e/monthly.spec.ts).
        'lib/generate-entries.ts',
        // Same reasoning: every path here reads/writes monthly_entries against a live
        // household — exercised by app/actions/import.integration.test.ts (a thin
        // wrapper around this, same shape as generate-entries.ts above). The pure
        // parsing/matching logic it calls into (lib/domain/csv.ts) IS unit-tested and
        // stays in the gated scope.
        'lib/import-csv.ts',
        // shadcn/ui-generated helper (clsx + tailwind-merge one-liner) — vendor
        // boilerplate, not application logic; clsx/tailwind-merge have their own tests.
        'lib/utils.ts',
        // Presentational JSX (a static glyph for the generated app icons — see
        // app/icon.tsx etc.), not business logic — verified visually and via
        // e2e/pwa.spec.ts's real icon-route fetches, not meaningfully unit-testable.
        'lib/pwa/icon.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', 'node_modules/**', '.next/**', 'e2e/**'],
          // Dummy-but-valid values so lib/env.ts's module-level validation passes without
          // real secrets. Unit tests must never depend on (or be able to reach) a real DB.
          // NODE_ENV is pinned explicitly (not left to inherit the ambient shell) so an
          // unusual pre-set value (e.g. "staging") can't fail every unit test at import.
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
            SESSION_SECRET: 'unit-test-dummy-secret-value-1234567890',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['**/*.integration.test.ts'],
          exclude: ['node_modules/**', '.next/**', 'e2e/**'],
          testTimeout: 15000,
          // No integration test file closes pool/healthCheckPool anymore (see
          // lib/db/index.integration.test.ts's own comment for why — Vitest's worker
          // teardown handles it once for the whole run instead), so this is no longer
          // headroom for a specific afterAll waiting on an in-flight query. Kept as
          // general safety margin above Vitest's default 10s hookTimeout for any
          // beforeAll/afterEach doing real setup/teardown work against the live `ci`/
          // dev Postgres branch — lower it if a future audit confirms no hook needs it.
          hookTimeout: 20000,
          // Integration tests share one real Postgres branch — run serially to avoid
          // cross-test data races on the same tables.
          fileParallelism: false,
          // Loads .env locally (dev branch); in CI, GitHub Actions injects real env vars
          // directly, so this is a harmless no-op there.
          setupFiles: ['./vitest.setup.integration.ts'],
        },
      },
    ],
  },
});
