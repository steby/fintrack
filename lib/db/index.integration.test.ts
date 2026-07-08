import { afterAll, describe, expect, it } from 'vitest';
import { pingDb, pool, healthCheckPool } from './index';

// Proves the real integration-test harness works end to end against a live Postgres
// branch (see vitest.setup.integration.ts for how DATABASE_URL gets here) before any
// domain schema exists. Phase 1+ integration tests build on this same pattern.
describe('database connectivity', () => {
  afterAll(async () => {
    await pool.end();
    await healthCheckPool.end();
  });

  it('pings the real database successfully', async () => {
    await expect(pingDb(5000)).resolves.toBe(true);
  });

  it('can execute a real query against the connected Postgres instance', async () => {
    const result = await pool.query('SELECT 1 + 1 AS sum');
    expect(result.rows[0].sum).toBe(2);
  });

  it('returns false (never throws) when the timeout is tighter than the round trip', async () => {
    // An absurdly small timeout against a real, healthy DB deterministically exercises
    // the "false" branch — proving pingDb reports failure cleanly rather than hanging
    // or throwing, without needing to simulate an actually-hung database.
    await expect(pingDb(1)).resolves.toBe(false);
  });
});
