import { beforeEach, describe, expect, it, vi } from 'vitest';

// observability.ts caches its Sentry client *promise* on globalThis (for HMR-safety in
// real usage), so each test needs to clear that global in addition to resetting
// Vitest's module registry — otherwise the cached promise leaks between tests.
function clearObservabilityGlobal() {
  delete (globalThis as Record<string, unknown>).sentryClientPromise;
}

describe('captureException', () => {
  beforeEach(() => {
    vi.resetModules();
    clearObservabilityGlobal();
  });

  it('logs the error and resolves without throwing when SENTRY_DSN is not set', async () => {
    vi.doMock('./env', () => ({ env: { SENTRY_DSN: undefined, NODE_ENV: 'test' } }));
    const errorSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: vi.fn() } }));

    const { captureException } = await import('./observability');
    await expect(captureException(new Error('boom'), { foo: 'bar' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ foo: 'bar' }),
      'captured exception',
    );
  });

  it('does not let a context.err key overwrite the real exception being logged', async () => {
    vi.doMock('./env', () => ({ env: { SENTRY_DSN: undefined, NODE_ENV: 'test' } }));
    const errorSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: vi.fn() } }));

    const { captureException } = await import('./observability');
    const realError = new Error('the real error');
    await captureException(realError, { err: 'a decoy value' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: realError }),
      'captured exception',
    );
  });

  it('falls back to log-only with a warning when SENTRY_DSN is set but the package is missing', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    const errorSpy = vi.fn();
    const warnSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: warnSpy } }));

    const { captureException } = await import('./observability');
    await expect(captureException(new Error('boom'))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringContaining('is not installed'),
    );
  });

  it('logs a distinct warning when the package imports fine but init() itself throws', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    const errorSpy = vi.fn();
    const warnSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: warnSpy } }));
    vi.doMock('@sentry/nextjs', () => ({
      init: () => {
        throw new Error('bad DSN');
      },
      captureException: vi.fn(),
    }));

    const { captureException } = await import('./observability');
    await captureException(new Error('boom'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      expect.stringContaining('failed to initialize'),
    );
  });

  it('does not throw across repeated calls once the missing-package result is cached', async () => {
    vi.doMock('./env', () => ({ env: { SENTRY_DSN: undefined, NODE_ENV: 'test' } }));
    const errorSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: vi.fn() } }));

    const { captureException } = await import('./observability');
    await captureException(new Error('one'));
    await captureException(new Error('two'));
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('initializes and forwards to the real client when @sentry/nextjs is available', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    const errorSpy = vi.fn();
    const warnSpy = vi.fn();
    vi.doMock('./log', () => ({ logger: { error: errorSpy, warn: warnSpy } }));
    const initSpy = vi.fn();
    const sentryCaptureSpy = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init: initSpy, captureException: sentryCaptureSpy }));

    const { captureException } = await import('./observability');
    const error = new Error('boom');
    await captureException(error, { foo: 'bar' });

    expect(initSpy).toHaveBeenCalledWith({
      dsn: 'https://example.ingest.sentry.io/1',
      environment: 'test',
    });
    expect(sentryCaptureSpy).toHaveBeenCalledWith(error, { extra: { foo: 'bar' } });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('only initializes the Sentry client once across repeated sequential calls', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    vi.doMock('./log', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
    const initSpy = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init: initSpy, captureException: vi.fn() }));

    const { captureException } = await import('./observability');
    await captureException(new Error('one'));
    await captureException(new Error('two'));
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('only initializes the Sentry client once across concurrent (racing) calls', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    vi.doMock('./log', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
    const initSpy = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init: initSpy, captureException: vi.fn() }));

    const { captureException } = await import('./observability');
    // Fire both without awaiting between them, so both reach getSentry() before either
    // resolves — exactly the race the globalThis-cached-promise fix guards against.
    await Promise.all([captureException(new Error('one')), captureException(new Error('two'))]);
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached client across a simulated HMR module reload instead of re-initializing', async () => {
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    vi.doMock('./log', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
    const initSpy = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init: initSpy, captureException: vi.fn() }));

    const first = await import('./observability');
    await first.captureException(new Error('before reload'));
    expect(initSpy).toHaveBeenCalledTimes(1);

    // Simulate an HMR reload: reset the module registry (as Next.js would re-evaluate
    // the file) WITHOUT touching globalThis — that's the whole point of caching there.
    vi.resetModules();
    vi.doMock('./env', () => ({
      env: { SENTRY_DSN: 'https://example.ingest.sentry.io/1', NODE_ENV: 'test' },
    }));
    vi.doMock('./log', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
    vi.doMock('@sentry/nextjs', () => ({ init: initSpy, captureException: vi.fn() }));

    const second = await import('./observability');
    await second.captureException(new Error('after reload'));
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
