import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './index';
import * as schema from './schema';
import { logger } from '../log';

// A dedicated, uncached pool — this is a one-shot CLI script (no HMR reuse needed, unlike
// the app's request-serving `pool`), and migrations need a different timeout profile:
// DDL can legitimately run longer than any request-path query, and a Neon cold-start
// right after deploy shouldn't be cut off at the request-tuned 10s connection timeout.
// No statement_timeout/query_timeout here — a migration is allowed to run to completion.
const migratePool = createPool('migrate', { connectionTimeoutMillis: 30000 });
const db = drizzle(migratePool, { schema });

async function main() {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Migrations complete.');
  await migratePool.end();
}

main().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
