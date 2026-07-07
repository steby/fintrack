import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, requestLogger } from './log';

describe('requestLogger', () => {
  it('returns a child logger bound to a generated request id when none is given', () => {
    const child = requestLogger();
    expect(child).not.toBe(logger);
    expect(child.bindings().requestId).toEqual(expect.any(String));
    expect(child.bindings().requestId.length).toBeGreaterThan(0);
  });

  it('binds the given request id rather than generating a new one', () => {
    const child = requestLogger('fixed-id-123');
    expect(child.bindings().requestId).toBe('fixed-id-123');
  });

  it('generates a different id per call when none is given', () => {
    const a = requestLogger();
    const b = requestLogger();
    expect(a.bindings().requestId).not.toBe(b.bindings().requestId);
  });
});

describe('log level and transport selection by environment', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses info level and no pretty transport in production', async () => {
    vi.doMock('./env', () => ({ env: { NODE_ENV: 'production' } }));
    const { logger: prodLogger } = await import('./log');
    expect(prodLogger.level).toBe('info');
  });

  it('uses debug level and the pretty transport outside production', async () => {
    vi.doMock('./env', () => ({ env: { NODE_ENV: 'development' } }));
    const { logger: devLogger } = await import('./log');
    expect(devLogger.level).toBe('debug');
  });
});
