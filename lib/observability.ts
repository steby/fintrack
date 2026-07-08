import { env } from './env';
import { logger } from './log';

/**
 * Keys-optional Sentry seam: the app never hard-depends on @sentry/nextjs. Without
 * SENTRY_DSN (or without the package installed), errors are structured-logged only —
 * identical behavior, just without remote reporting. Set SENTRY_DSN and
 * `npm install @sentry/nextjs` to light this up for real.
 *
 * The import specifier is read from a variable (not a string literal) so TypeScript treats
 * it as a non-literal dynamic import and skips static module resolution — this lets the
 * seam typecheck without the package installed.
 */
interface SentryModule {
  init: (options: { dsn: string; environment: string }) => void;
  captureException: (error: unknown, hint?: { extra?: Record<string, unknown> }) => void;
}

// Cached on globalThis, like lib/db/index.ts's pg Pool, so Next.js dev-mode HMR
// re-evaluating this module doesn't re-run Sentry.init() on every edit. Caches the
// in-flight *promise* (not just the resolved client) so concurrent callers awaiting
// getSentry() before the first one resolves all share that one import()+init() call
// instead of each independently double-initializing the SDK — the assignment below is
// synchronous, so there's no window between "check" and "set" for a second caller to
// slip through.
const globalForObservability = globalThis as unknown as {
  sentryClientPromise?: Promise<SentryModule | null>;
};

async function initSentry(): Promise<SentryModule | null> {
  if (!env.SENTRY_DSN) {
    return null;
  }

  const specifier = '@sentry/nextjs';
  let sentry: SentryModule;
  try {
    sentry = (await import(specifier)) as SentryModule;
  } catch (err) {
    logger.warn(
      { err },
      '@sentry/nextjs is not installed; falling back to log-only error tracking',
    );
    return null;
  }

  try {
    sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  } catch (err) {
    logger.warn(
      { err },
      '@sentry/nextjs failed to initialize; falling back to log-only error tracking',
    );
    return null;
  }

  return sentry;
}

function getSentry(): Promise<SentryModule | null> {
  globalForObservability.sentryClientPromise ??= initSentry();
  return globalForObservability.sentryClientPromise;
}

export async function captureException(error: unknown, context?: Record<string, unknown>) {
  // context spread comes first so a context key literally named `err` can never shadow
  // the actual exception being logged.
  logger.error({ ...context, err: error }, 'captured exception');
  const sentry = await getSentry();
  sentry?.captureException(error, context ? { extra: context } : undefined);
}
