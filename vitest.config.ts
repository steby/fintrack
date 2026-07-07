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
          env: {
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
