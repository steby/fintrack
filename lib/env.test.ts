import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const validBase: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://user:pass@host/db?sslmode=require',
  SESSION_SECRET: 'a'.repeat(32),
};

describe('loadEnv', () => {
  it('accepts a minimal valid env and fills in defaults', () => {
    const result = loadEnv(validBase);
    expect(result.NODE_ENV).toBe('development');
    expect(result.APP_URL).toBe('http://localhost:3000');
    expect(result.CRON_SECRET).toBeUndefined();
    expect(result.RESEND_API_KEY).toBeUndefined();
    expect(result.SENTRY_DSN).toBeUndefined();
  });

  it('defaults every config feature flag to its documented value', () => {
    const result = loadEnv(validBase);
    expect(result.FEATURE_CATEGORY_BUDGETS).toBe(true);
    expect(result.FEATURE_SAVINGS_GOALS).toBe(true);
    expect(result.FEATURE_NET_WORTH).toBe(true);
    expect(result.FEATURE_ENTRY_ATTRIBUTION).toBe(true);
    expect(result.FEATURE_PWA).toBe(true);
  });

  it('defaults every kill-switch flag default to its documented value', () => {
    const result = loadEnv(validBase);
    expect(result.FEATURE_AUTO_GENERATE_DEFAULT).toBe(true);
    expect(result.FEATURE_CSV_IMPORT_DEFAULT).toBe(false);
    expect(result.FEATURE_EMAIL_REMINDERS_DEFAULT).toBe(false);
    expect(result.FEATURE_MONTHLY_RECAP_DEFAULT).toBe(false);
  });

  it('parses "false" strings as boolean false, not just any non-empty truthy string', () => {
    const result = loadEnv({ ...validBase, FEATURE_PWA: 'false' });
    expect(result.FEATURE_PWA).toBe(false);
  });

  it('throws a readable error when DATABASE_URL is missing', () => {
    const rest = { SESSION_SECRET: validBase.SESSION_SECRET };
    expect(() => loadEnv(rest)).toThrowError(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() => loadEnv({ ...validBase, DATABASE_URL: 'not-a-url' })).toThrowError(/DATABASE_URL/);
  });

  it('rejects a well-formed URL that is not a postgres connection string', () => {
    expect(() =>
      loadEnv({ ...validBase, DATABASE_URL: 'https://example.com/not-a-db' }),
    ).toThrowError(/DATABASE_URL/);
  });

  it('accepts both postgresql:// and postgres:// schemes', () => {
    expect(loadEnv(validBase).DATABASE_URL).toBe(validBase.DATABASE_URL);
    const result = loadEnv({
      ...validBase,
      DATABASE_URL: 'postgres://user:pass@host/db?sslmode=require',
    });
    expect(result.DATABASE_URL).toBe('postgres://user:pass@host/db?sslmode=require');
  });

  it('throws when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validBase, SESSION_SECRET: 'too-short' })).toThrowError(
      /SESSION_SECRET/,
    );
  });

  it('rejects an invalid boolean-flag string rather than silently defaulting', () => {
    expect(() => loadEnv({ ...validBase, FEATURE_PWA: 'yes' })).toThrowError();
  });

  it('treats a blank optional var ("") as absent, not as a validation failure', () => {
    const result = loadEnv({ ...validBase, SENTRY_DSN: '', RESEND_API_KEY: '', CRON_SECRET: '' });
    expect(result.SENTRY_DSN).toBeUndefined();
    expect(result.RESEND_API_KEY).toBeUndefined();
    expect(result.CRON_SECRET).toBeUndefined();
  });

  it('treats a blank APP_URL as absent and falls back to its default, same as the optional vars', () => {
    const result = loadEnv({ ...validBase, APP_URL: '' });
    expect(result.APP_URL).toBe('http://localhost:3000');
  });

  it('treats a blank feature-flag value as absent and falls back to its default, same as the optional vars', () => {
    const result = loadEnv({
      ...validBase,
      FEATURE_PWA: '',
      FEATURE_CSV_IMPORT_DEFAULT: '',
    });
    expect(result.FEATURE_PWA).toBe(true);
    expect(result.FEATURE_CSV_IMPORT_DEFAULT).toBe(false);
  });

  it('accepts a real optional value when provided', () => {
    const result = loadEnv({
      ...validBase,
      SENTRY_DSN: 'https://example.ingest.sentry.io/123',
      CRON_SECRET: 'b'.repeat(32),
    });
    expect(result.SENTRY_DSN).toBe('https://example.ingest.sentry.io/123');
    expect(result.CRON_SECRET).toBe('b'.repeat(32));
  });

  it('rejects a too-short CRON_SECRET when one is actually provided', () => {
    expect(() => loadEnv({ ...validBase, CRON_SECRET: 'short' })).toThrowError(/CRON_SECRET/);
  });

  it('leaves SEED_OWNER_EMAIL/PASSWORD undefined when absent — the app itself never requires them', () => {
    const result = loadEnv(validBase);
    expect(result.SEED_OWNER_EMAIL).toBeUndefined();
    expect(result.SEED_OWNER_PASSWORD).toBeUndefined();
  });

  it('rejects a malformed SEED_OWNER_EMAIL when one is actually provided', () => {
    expect(() =>
      loadEnv({ ...validBase, SEED_OWNER_EMAIL: 'not-an-email', SEED_OWNER_PASSWORD: 'x' }),
    ).toThrowError(/SEED_OWNER_EMAIL/);
  });
});
