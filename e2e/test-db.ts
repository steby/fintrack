import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../lib/db/schema';
import { pinStrictSslMode } from '../lib/db/connection-string';

// The Playwright test runner is a separate Node process from the app's own webServer
// (see playwright.config.ts) — it needs its own DB connection and its own `dotenv/config`
// import to see DATABASE_URL, same as lib/db/seed.ts and lib/db/migrate.ts.
//
// A factory, not a shared module-level singleton: each spec file calls this once and
// closes its own pool in its own afterAll. A shared singleton pool broke under CI's
// `workers: 1` config — Playwright runs multiple spec files sequentially in the SAME
// process there, so one file's afterAll closing a pool that a LATER file's tests still
// needed caused "Cannot use a pool after calling end on the pool", surfacing as a
// flaky failure that depended on which file happened to finish first.
export function createTestDb() {
  // This process reads DATABASE_URL raw (it never goes through lib/env.ts's loadEnv),
  // so the sslmode pin has to be applied here too — same rationale as lib/env.ts.
  const pool = new Pool({ connectionString: pinStrictSslMode(process.env.DATABASE_URL ?? '') });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
