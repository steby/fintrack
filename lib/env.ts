import { z } from 'zod';
import { required, formatZodIssues } from './zod-format';

const boolString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string(required('DATABASE_URL is required'))
    .url('DATABASE_URL must be a valid postgresql:// connection string')
    .refine(
      (val) => val.startsWith('postgresql://') || val.startsWith('postgres://'),
      'DATABASE_URL must use the postgresql:// or postgres:// scheme',
    ),
  SESSION_SECRET: z
    .string(required('SESSION_SECRET is required'))
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Required starting Phase 6 (cron endpoints); validated there, not here, so Phase 0-5
  // environments (including CI) don't need to provision it before it's used.
  CRON_SECRET: z.string().min(32).optional(),

  // Keys-optional integrations (see development-workflow.md "Keys-optional integrations") —
  // the app renders and tests identically with or without these set.
  RESEND_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),

  // Feature flags — config kind (env var; flipping requires a restart/redeploy). See
  // spec.md Feature Matrix.
  FEATURE_CATEGORY_BUDGETS: boolString('true'),
  FEATURE_SAVINGS_GOALS: boolString('true'),
  FEATURE_NET_WORTH: boolString('true'),
  FEATURE_ENTRY_ATTRIBUTION: boolString('true'),
  FEATURE_PWA: boolString('true'),

  // Feature flags — kill-switch kind: these only seed the household_settings DB default.
  // The live value lives in the DB and is toggled at runtime (Settings), never re-read
  // from env after seeding.
  FEATURE_AUTO_GENERATE_DEFAULT: boolString('true'),
  FEATURE_CSV_IMPORT_DEFAULT: boolString('false'),
  FEATURE_EMAIL_REMINDERS_DEFAULT: boolString('false'),
  FEATURE_MONTHLY_RECAP_DEFAULT: boolString('false'),

  // SEED_OWNER_EMAIL/PASSWORD deliberately do NOT live here — see lib/db/seed.ts. They're
  // validated by their own schema, straight from process.env, before that script ever
  // imports this module. Putting them in the app's shared, eagerly-validated schema would
  // mean a malformed value crashes `next dev`/`next build`/`drizzle-kit`, not just
  // `npm run db:seed` — a real regression a previous version of this file had.
});

/** Exported (not just used internally) so unit tests can validate arbitrary env shapes
 *  without mutating the real process.env. Loosely typed (not NodeJS.ProcessEnv) since
 *  Next.js augments that global interface to require NODE_ENV — tests should be able to
 *  pass partial, ad-hoc env shapes without fighting that ambient type. */
export function loadEnv(source: Record<string, string | undefined> = process.env) {
  // A blank `KEY=` line in a .env file loads as "", not undefined. Every field in this
  // schema — whether `.optional()` or `.default(...)` — should treat a blank value as
  // if the variable were absent, so normalize once here rather than opting individual
  // fields in one at a time (a field-by-field approach silently misses new fields).
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === '' ? undefined : value]),
  );

  // Every Preview deployment gets its own fresh, unique URL — a static APP_URL would be
  // wrong for every preview except whichever one it happened to be set to (this is exactly
  // how invite links generated from a PR preview build ended up pointing at localhost).
  // Vercel auto-injects VERCEL_URL (no protocol) with that exact deployment's own address
  // on every environment it runs in, including Preview. Only synthesize from it when
  // APP_URL isn't already explicitly set — Production always sets its own, to the real
  // custom domain, and that must keep winning.
  if (!normalized.APP_URL && normalized.VERCEL_URL) {
    normalized.APP_URL = `https://${normalized.VERCEL_URL}`;
  }

  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${formatZodIssues(parsed.error)}\n\n` +
        'See .env.example for the full variable contract.',
    );
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
