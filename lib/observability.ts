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

let sentryClient: SentryModule | null | undefined;

async function getSentry(): Promise<SentryModule | null> {
  if (sentryClient !== undefined) return sentryClient;

  if (!env.SENTRY_DSN) {
    sentryClient = null;
    return null;
  }

  try {
    const specifier = '@sentry/nextjs';
    const sentry = (await import(specifier)) as SentryModule;
    sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
    sentryClient = sentry;
  } catch (err) {
    logger.warn(
      { err },
      'SENTRY_DSN is set but @sentry/nextjs is not installed; falling back to log-only error tracking',
    );
    sentryClient = null;
  }

  return sentryClient;
}

export async function captureException(error: unknown, context?: Record<string, unknown>) {
  logger.error({ err: error, ...context }, 'captured exception');
  const sentry = await getSentry();
  sentry?.captureException(error, context ? { extra: context } : undefined);
}
