import { beforeEach, describe, expect, it, vi } from 'vitest';

// observability.ts caches its Sentry client at module scope, so each test needs a fresh
// module instance (via resetModules) plus its own mock of ./env before importing.
describe('captureException', () => {
  beforeEach(() => {
    vi.resetModules();
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
      expect.stringContaining('falling back to log-only'),
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

  it('only initializes the Sentry client once across repeated calls', async () => {
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
});
