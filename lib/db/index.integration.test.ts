import { afterAll, describe, expect, it } from 'vitest';
import { pingDb, pool } from './index';

// Proves the real integration-test harness works end to end against a live Postgres
// branch (see vitest.setup.integration.ts for how DATABASE_URL gets here) before any
// domain schema exists. Phase 1+ integration tests build on this same pattern.
describe('database connectivity', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('pings the real database successfully', async () => {
    await expect(pingDb(5000)).resolves.toBe(true);
  });

  it('can execute a real query against the connected Postgres instance', async () => {
    const result = await pool.query('SELECT 1 + 1 AS sum');
    expect(result.rows[0].sum).toBe(2);
  });
});
