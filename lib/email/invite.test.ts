import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('sendInviteEmail', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs the accept URL instead of sending when RESEND_API_KEY is not set', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: undefined } }));
    const infoSpy = vi.fn();
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: infoSpy, error: errorSpy } }));

    const { sendInviteEmail } = await import('./invite');
    await sendInviteEmail('a@example.com', 'https://example.com/invite/abc');

    expect(infoSpy).toHaveBeenCalledWith(
      { email: 'a@example.com', acceptUrl: 'https://example.com/invite/abc' },
      expect.stringContaining('RESEND_API_KEY not set'),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sends via Resend when RESEND_API_KEY is set', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const infoSpy = vi.fn();
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: infoSpy, error: errorSpy } }));
    const sendSpy = vi.fn().mockResolvedValue({ data: { id: 'email_1' } });
    // A plain class, not vi.fn().mockImplementation(...) — the real Resend export is
    // used with `new`, and Vitest's mock-function wrapper isn't reliably constructible.
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendInviteEmail } = await import('./invite');
    await sendInviteEmail('a@example.com', 'https://example.com/invite/abc');

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('logs an error and does not throw when the Resend call fails', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const infoSpy = vi.fn();
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: infoSpy, error: errorSpy } }));
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: vi.fn().mockRejectedValue(new Error('Resend API down')) };
      },
    }));

    const { sendInviteEmail } = await import('./invite');
    await expect(
      sendInviteEmail('a@example.com', 'https://example.com/invite/abc'),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@example.com' }),
      expect.stringContaining('Failed to send invite email'),
    );
  });

  it('logs an error and does not throw when the Resend call never resolves (timeout)', async () => {
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const infoSpy = vi.fn();
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: infoSpy, error: errorSpy } }));
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: () => new Promise(() => {}) };
      },
    }));

    const { sendInviteEmail } = await import('./invite');
    const promise = sendInviteEmail('a@example.com', 'https://example.com/invite/abc');
    await vi.advanceTimersByTimeAsync(5001);
    await expect(promise).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@example.com' }),
      expect.stringContaining('Failed to send invite email'),
    );
  });
});
