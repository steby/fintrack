import { describe, expect, it } from 'vitest';
import { pingDb, pool, healthCheckPool } from './index';

// Proves the real integration-test harness works end to end against a live Postgres
// branch (see vitest.setup.integration.ts for how DATABASE_URL gets here) before any
// domain schema exists. Phase 1+ integration tests build on this same pattern.
//
// No afterAll(pool.end()) here, deliberately: pool and healthCheckPool are shared
// singletons (lib/db/index.ts's globalForDb cache), and this file isn't guaranteed to
// be the last one to run — with fileParallelism: false, every *.integration.test.ts
// file's afterAll used to call pool.end() on that SAME shared pool, so whichever file
// happened to finish first closed it out from under every file still queued to run
// after it ("Cannot use a pool after calling end on the pool"). No individual
// integration test file closes pool/healthCheckPool anymore; Vitest tears down its own
// worker process once the whole run completes, which is enough to release the
// connections without any test-owned teardown racing against file order.
describe('database connectivity', () => {
  it('pings the real database successfully', async () => {
    await expect(pingDb(5000)).resolves.toBe(true);
  });

  it('can execute a real query against the connected Postgres instance', async () => {
    const result = await pool.query('SELECT 1 + 1 AS sum');
    expect(result.rows[0].sum).toBe(2);
  });

  it('returns false (never throws) when the timeout is tighter than the round trip', async () => {
    // A bare 1ms timeout against a real query was flaky in practice: as the test
    // process's connection to Neon warms up (TCP/TLS state reused across the many
    // other queries this suite makes), a single 'SELECT 1' can legitimately complete
    // in under 1ms, flipping this to true. Saturating the health pool's connection
    // limit (max: 2) instead forces pingDb's query to wait in the pool's own queue —
    // deterministic regardless of network speed, since a 3rd concurrent request always
    // has to wait for one of the two held connections to free up.
    const held = await Promise.all([healthCheckPool.connect(), healthCheckPool.connect()]);
    try {
      await expect(pingDb(1)).resolves.toBe(false);
    } finally {
      held.forEach((client) => client.release());
    }
  });
});
