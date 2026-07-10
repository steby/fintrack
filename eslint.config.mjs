import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import security from 'eslint-plugin-security';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  security.configs.recommended,
  prettierConfig,
  {
    // Structural guard, not just the warning comment on lib/db/index.ts's exports: a
    // per-file pool.end()/healthCheckPool.end() call in an integration test poisons
    // the shared globalThis-cached pool for every OTHER integration file scheduled to
    // run after it (fileParallelism: false runs them all sequentially in one process)
    // — a real bug that took a full debugging session to find. Scoped to
    // *.integration.test.ts specifically: lib/db/seed.ts, lib/db/migrate.ts, and
    // lib/db/clean-e2e-debris.ts's own main() legitimately call pool.end() as
    // standalone CLI scripts, not integration tests sharing one Vitest process.
    //
    // Known gap (investigated, deliberately not closed): this selector matches by
    // literal identifier name, so `import { pool as p } from './index'; p.end();`
    // evades it — no-restricted-syntax has no cross-field comparison to catch an
    // aliased import regardless of its local name; that needs a real custom rule with
    // scope-based variable resolution (tracing the call's identifier back to its
    // ImportSpecifier's `imported.name`), not a selector. Not built: the realistic
    // failure mode this guard defends against is a well-intentioned dev accidentally
    // reintroducing `pool.end()` in a new test file (what actually happened once
    // already); a DELIBERATE rename specifically to dodge this lint rule is a
    // different, much less likely threat that a code reviewer would also catch on
    // sight, with or without tooling — the custom-rule engineering isn't worth it for
    // that narrower case.
    files: ['**/*.integration.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='end'][callee.object.name=/^(pool|healthCheckPool)$/]",
          message:
            'Do not call pool.end()/healthCheckPool.end() in an integration test — both are shared singletons across the whole test run (see lib/db/index.ts). Closing one here poisons every integration test file scheduled to run after this one.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Test artifacts:
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);

export default eslintConfig;
