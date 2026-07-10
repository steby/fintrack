import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import { logger } from '../log';
import * as schema from './schema';

// In dev, Next.js HMR re-evaluates modules on every edit; without caching pools on
// globalThis we'd open new pg Pools (and leak connections) on every hot reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool; pgHealthPool?: Pool };

function handlePoolError(poolName: string) {
  return (err: unknown) => {
    // Idle clients can have their connection dropped by the server (e.g. Neon closing
    // an idle backend) — without a listener, pg's Pool treats that as an unhandled
    // EventEmitter 'error' and crashes the process. Log (tagged by pool, so a main-pool
    // error — potentially customer-impacting — isn't confused with a health-check-pool
    // one) and let the pool recover instead.
    logger.error({ err, pool: poolName }, 'Unexpected error on idle Postgres client');
  };
}

// Attaches the error listener only when actually constructing a new Pool (called from
// the right-hand side of `??`, which short-circuits on a globalThis cache hit) — so an
// HMR reload that reuses a cached pool never re-attaches a duplicate listener onto the
// same long-lived EventEmitter.
function createPool(poolName: string, overrides: Partial<PoolConfig>): Pool {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ...overrides });
  pool.on('error', handlePoolError(poolName));
  return pool;
}

const pool =
  globalForDb.pgPool ??
  createPool('main', {
    max: env.NODE_ENV === 'production' ? 10 : 5,
    connectionTimeoutMillis: 10000,
    // statement_timeout is enforced by Postgres itself (a real server-side cancel, sent
    // as `SET statement_timeout = ...` on connect) — unlike query_timeout below, which
    // is purely a client-side timer. Every real query through this pool gets both: the
    // server-side cancel handles the common "query ran too long" case, and the
    // client-side backstop covers the rarer case where the connection itself is wedged
    // and can't even deliver the server's cancellation back to the client.
    statement_timeout: 30000,
    query_timeout: 35000,
  });

// Dedicated pool for health checks, isolated from the main query pool, so a hung DB
// can never exhaust the connections real request handlers need.
const healthCheckPool =
  globalForDb.pgHealthPool ??
  createPool('health-check', {
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    query_timeout: 10000,
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.pgPool = pool;
  globalForDb.pgHealthPool = healthCheckPool;
}

export const db = drizzle(pool, { schema });
// DO NOT call pool.end() or healthCheckPool.end() in an integration test's afterAll.
// Both are globalThis-cached singletons shared by every *.integration.test.ts file in
// a run (fileParallelism: false runs them all sequentially in one process) — a per-file
// close previously poisoned every file scheduled to run after it with "Cannot use a
// pool after calling end on the pool", a real bug that took a full debugging session to
// find and fix. No file closes either pool anymore; Vitest's own worker teardown
// releases the connections once the whole run completes. See
// lib/db/index.integration.test.ts's comment for the full explanation.
export { pool, healthCheckPool, createPool };

/** Used by /api/health. Never throws — returns false on any failure or timeout.
 *  `timeoutMs` bounds how long the caller waits for a response; the health pool's own
 *  `statement_timeout`/`query_timeout` are a hard backstop that frees the connection
 *  even if the query runs far longer than the caller is willing to wait. */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      healthCheckPool.query('SELECT 1'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DB ping timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
