import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import { logger } from '../log';
import * as schema from './schema';

// In dev, Next.js HMR re-evaluates modules on every edit; without caching pools on
// globalThis we'd open new pg Pools (and leak connections) on every hot reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool; pgHealthPool?: Pool };

// Idle clients can have their connection dropped by the server (e.g. Neon closing an
// idle backend) — without a listener, pg's Pool treats that as an unhandled
// EventEmitter 'error' and crashes the process. Log and let the pool recover instead.
function handlePoolError(err: unknown) {
  logger.error({ err }, 'Unexpected error on idle Postgres client');
}

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'production' ? 10 : 5,
  });
pool.on('error', handlePoolError);

// Dedicated pool for health checks, isolated from the main query pool, so a hung DB
// can never exhaust the connections real request handlers need. query_timeout aborts
// the query at the pg protocol level — a hard backstop that guarantees the connection
// is freed even on a fully hung query, unlike a bare Promise.race (which only stops
// *waiting* on a query, not the query itself).
const healthCheckPool =
  globalForDb.pgHealthPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
healthCheckPool.on('error', handlePoolError);

if (env.NODE_ENV !== 'production') {
  globalForDb.pgPool = pool;
  globalForDb.pgHealthPool = healthCheckPool;
}

export const db = drizzle(pool, { schema });
export { pool, healthCheckPool };

/** Used by /api/health. Never throws — returns false on any failure or timeout.
 *  `timeoutMs` bounds how long the caller waits for a response; the health pool's own
 *  `query_timeout` (10s) is a hard backstop that frees the connection even if the query
 *  never returns at all. */
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
