import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';
import { logger } from '../log';

async function main() {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Migrations complete.');
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
