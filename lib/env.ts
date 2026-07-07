import { z } from 'zod';

const boolString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

// A blank `KEY=` line in a .env file loads as "", not undefined — treat blank as absent so
// truly-optional vars (keys-optional integrations) don't fail validation when left empty.
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);
const optionalString = () => z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = () => z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalMinString = (min: number) =>
  z.preprocess(emptyToUndefined, z.string().min(min).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgresql:// connection string'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Required starting Phase 6 (cron endpoints); validated there, not here, so Phase 0-5
  // environments (including CI) don't need to provision it before it's used.
  CRON_SECRET: optionalMinString(32),

  // Keys-optional integrations (see development-workflow.md "Keys-optional integrations") —
  // the app renders and tests identically with or without these set.
  RESEND_API_KEY: optionalString(),
  SENTRY_DSN: optionalUrl(),

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
});

/** Exported (not just used internally) so unit tests can validate arbitrary env shapes
 *  without mutating the real process.env. Loosely typed (not NodeJS.ProcessEnv) since
 *  Next.js augments that global interface to require NODE_ENV — tests should be able to
 *  pass partial, ad-hoc env shapes without fighting that ambient type. */
export function loadEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. Fix the following and restart:\n${issues}\n\n` +
        'See .env.example for the full variable contract.',
    );
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
