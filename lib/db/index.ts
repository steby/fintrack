import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import * as schema from './schema';

// In dev, Next.js HMR re-evaluates modules on every edit; without caching the pool on
// globalThis we'd open a new pg Pool (and leak connections) on every hot reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'production' ? 10 : 5,
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };

/** Used by /api/health. Never throws — returns false on any failure or timeout. */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('DB ping timeout')), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
