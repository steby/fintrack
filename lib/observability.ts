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

/** Never throws: logs a warning and returns null. Used from initSentry()'s catch blocks
 *  so a broken/misconfigured logger can't itself become an unhandled rejection that
 *  permanently poisons the globalThis-cached promise below (see getSentry()). */
function warnFallback(reason: string, err: unknown): null {
  try {
    logger.warn({ err }, `@sentry/nextjs ${reason}; falling back to log-only error tracking`);
  } catch {
    // Logging the failure failed too — nothing more we can safely do here.
  }
  return null;
}

async function initSentry(): Promise<SentryModule | null> {
  if (!env.SENTRY_DSN) {
    return null;
  }

  const specifier = '@sentry/nextjs';
  let sentry: SentryModule;
  try {
    sentry = (await import(specifier)) as SentryModule;
  } catch (err) {
    return warnFallback('is not installed', err);
  }

  try {
    sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
  } catch (err) {
    return warnFallback('failed to initialize', err);
  }

  return sentry;
}

// Cached on globalThis, like lib/db/index.ts's pg Pools, so Next.js dev-mode HMR
// re-evaluating this module doesn't re-run Sentry.init() on every edit. Caches the
// in-flight *promise* (not just the resolved client) so concurrent callers awaiting
// getSentry() before the first one resolves all share that one import()+init() call
// instead of each independently double-initializing the SDK — the assignment below is
// synchronous, so there's no window between "check" and "set" for a second caller to
// slip through.
const globalForObservability = globalThis as unknown as {
  sentryClientPromise?: Promise<SentryModule | null>;
};

function getSentry(): Promise<SentryModule | null> {
  globalForObservability.sentryClientPromise ??= initSentry().catch((err) => {
    // initSentry() itself always resolves (never rejects) on every failure path above —
    // this only fires if something outside those paths unexpectedly throws. Reset the
    // cache so a later call gets a fresh attempt instead of replaying the same
    // rejection forever (a plain `promise ??= ...` would otherwise cache a rejected
    // promise permanently, since a rejected Promise is still a non-nullish value).
    globalForObservability.sentryClientPromise = undefined;
    return warnFallback('threw unexpectedly during initialization', err);
  });
  return globalForObservability.sentryClientPromise;
}

export async function captureException(error: unknown, context?: Record<string, unknown>) {
  // This whole seam exists to be safe to call from any error-handling path, so it must
  // never itself throw — the entire body is guarded, not just the Sentry-forwarding
  // part, since even the initial log call below can throw (e.g. a `context` value with
  // a throwing getter, or a broken logger) and that must not propagate either.
  try {
    // context spread comes first so a context key literally named `err` can never
    // shadow the actual exception being logged.
    logger.error({ ...context, err: error }, 'captured exception');

    const sentry = await getSentry();
    sentry?.captureException(error, context ? { extra: context } : undefined);
  } catch (err) {
    warnFallback('failed while capturing/forwarding an exception', err);
  }
}
