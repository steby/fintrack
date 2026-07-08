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
        // Same reasoning as the DB plumbing above: every code path in here touches the
        // real household_settings table (even the cache-hit path needs a real DB read
        // to populate the cache first) — exercised by lib/flags.integration.test.ts.
        'lib/flags.ts',
        // Every path here does a real recurring_schedule read + monthly_entries bulk
        // insert — exercised by app/actions/recurring.integration.test.ts's
        // generateAction tests (a thin wrapper around this) and the Monthly page's
        // auto-generate hook (covered by e2e/monthly.spec.ts).
        'lib/generate-entries.ts',
        // shadcn/ui-generated helper (clsx + tailwind-merge one-liner) — vendor
        // boilerplate, not application logic; clsx/tailwind-merge have their own tests.
        'lib/utils.ts',
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
          // The tight-timeout test in lib/db/index.integration.test.ts deliberately
          // leaves an orphaned query running against the health pool; afterAll's
          // healthCheckPool.end() has to wait for it to actually finish. The health
          // pool's statement_timeout (8s) is what bounds that wait in practice — it's
          // the real server-side cancellation (see lib/db/index.ts); query_timeout
          // (10s) is only a client-side timer that would fire second, as a backstop.
          // Either way that's within a hair of Vitest's default 10s hookTimeout, so
          // give hooks real headroom to avoid a spurious timeout.
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
