import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('verifyCronRequest', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../env');
  });

  it('rejects when CRON_SECRET is not configured, even with a matching-looking header', async () => {
    vi.doMock('../env', () => ({ env: { CRON_SECRET: undefined } }));
    const { verifyCronRequest } = await import('./cron');
    const request = new Request('https://example.com/api/cron/reminders', {
      headers: { authorization: 'Bearer undefined' },
    });
    expect(verifyCronRequest(request)).toBe(false);
  });

  it('accepts a matching Bearer token', async () => {
    vi.doMock('../env', () => ({ env: { CRON_SECRET: 'a'.repeat(32) } }));
    const { verifyCronRequest } = await import('./cron');
    const request = new Request('https://example.com/api/cron/reminders', {
      headers: { authorization: `Bearer ${'a'.repeat(32)}` },
    });
    expect(verifyCronRequest(request)).toBe(true);
  });

  it('rejects a missing authorization header', async () => {
    vi.doMock('../env', () => ({ env: { CRON_SECRET: 'a'.repeat(32) } }));
    const { verifyCronRequest } = await import('./cron');
    const request = new Request('https://example.com/api/cron/reminders');
    expect(verifyCronRequest(request)).toBe(false);
  });

  it('rejects a wrong secret of the same length', async () => {
    vi.doMock('../env', () => ({ env: { CRON_SECRET: 'a'.repeat(32) } }));
    const { verifyCronRequest } = await import('./cron');
    const request = new Request('https://example.com/api/cron/reminders', {
      headers: { authorization: `Bearer ${'b'.repeat(32)}` },
    });
    expect(verifyCronRequest(request)).toBe(false);
  });

  it('rejects a wrong-length header without throwing', async () => {
    vi.doMock('../env', () => ({ env: { CRON_SECRET: 'a'.repeat(32) } }));
    const { verifyCronRequest } = await import('./cron');
    const request = new Request('https://example.com/api/cron/reminders', {
      headers: { authorization: 'Bearer short' },
    });
    expect(verifyCronRequest(request)).toBe(false);
  });
});
