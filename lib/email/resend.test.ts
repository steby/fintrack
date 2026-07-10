import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const INPUT = { to: 'a@example.com', subject: 'Test', html: '<p>hi</p>' };

describe('sendEmail', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs instead of sending when RESEND_API_KEY is not set, and reports success', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: undefined } }));
    const infoSpy = vi.fn();
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: infoSpy, error: errorSpy } }));

    const { sendEmail } = await import('./resend');
    await expect(sendEmail(INPUT)).resolves.toBe(true);

    expect(infoSpy).toHaveBeenCalledWith(
      { to: INPUT.to, subject: INPUT.subject },
      expect.stringContaining('RESEND_API_KEY not set'),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sends via Resend on the first attempt with no retries needed', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
    const sendSpy = vi.fn().mockResolvedValue({ data: { id: 'email_1' } });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    await expect(sendEmail(INPUT)).resolves.toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds on the second attempt', async () => {
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
    const sendSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ data: { id: 'email_1' } });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    const promise = sendEmail(INPUT);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('exhausts all retries, logs an error, and returns false (never throws)', async () => {
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: errorSpy } }));
    const sendSpy = vi.fn().mockRejectedValue(new Error('Resend API down'));
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    const promise = sendEmail(INPUT);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBe(false);

    expect(sendSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: INPUT.to, subject: INPUT.subject }),
      expect.stringContaining('Failed to send email after retries'),
    );
  });

  it('treats a resolved {data: null, error} response as a failure, not a success', async () => {
    // The real Resend SDK resolves (never rejects) on API-level failures — this mock
    // matches that exact shape, not a thrown exception, to prove sendEmail actually
    // inspects the resolved value rather than only reacting to a caught exception.
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: errorSpy } }));
    const sendSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { name: 'invalid_api_key', message: 'API key is invalid', statusCode: 401 },
    });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    const promise = sendEmail(INPUT);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe(false);

    expect(sendSpy).toHaveBeenCalledTimes(3); // initial + 2 retries — treated like any other failure
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: INPUT.to, subject: INPUT.subject }),
      expect.stringContaining('Failed to send email after retries'),
    );
  });

  it('succeeds without retrying when the resolved response has data and no error', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
    const sendSpy = vi.fn().mockResolvedValue({ data: { id: 'email_1' }, error: null });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    await expect(sendEmail(INPUT)).resolves.toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('treats a timeout the same as a rejection and eventually degrades', async () => {
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    const errorSpy = vi.fn();
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: errorSpy } }));
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: () => new Promise(() => {}) }; // never resolves
      },
    }));

    const { sendEmail } = await import('./resend');
    const promise = sendEmail(INPUT);
    // 3 attempts, each waiting out the 5s timeout, plus backoff between them.
    await vi.advanceTimersByTimeAsync(20000);
    await expect(promise).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('regression: every retry of one logical send carries the SAME Idempotency-Key, not a fresh one per attempt', async () => {
    // The actual fix for the confirmed bug: Resend's SDK has no AbortSignal support at
    // all (checked directly against its types), so a client-side timeout can't
    // guarantee the underlying HTTP request is cancelled — Resend may still be
    // processing the FIRST attempt when a retry fires. A shared idempotencyKey across
    // every retry is what tells Resend's own server "this is the same operation,
    // don't send it twice," regardless of what our own timeout does or doesn't manage
    // to cancel client-side.
    vi.useFakeTimers();
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
    const sendSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockRejectedValueOnce(new Error('flaky again'))
      .mockResolvedValueOnce({ data: { id: 'email_1' } });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    const promise = sendEmail(INPUT);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBe(true);

    expect(sendSpy).toHaveBeenCalledTimes(3);
    const keysUsed = sendSpy.mock.calls.map(([, options]) => options.idempotencyKey);
    expect(keysUsed[0]).toEqual(keysUsed[1]);
    expect(keysUsed[1]).toEqual(keysUsed[2]);
    expect(typeof keysUsed[0]).toBe('string');
    expect(keysUsed[0].length).toBeGreaterThan(0);
  });

  it('regression: two SEPARATE sendEmail() calls (different logical emails) get DIFFERENT idempotency keys', async () => {
    vi.doMock('../env', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));
    vi.doMock('../log', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
    const sendSpy = vi.fn().mockResolvedValue({ data: { id: 'email_1' } });
    vi.doMock('resend', () => ({
      Resend: class {
        emails = { send: sendSpy };
      },
    }));

    const { sendEmail } = await import('./resend');
    await sendEmail(INPUT);
    await sendEmail({ ...INPUT, subject: 'A different email' });

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const firstKey = sendSpy.mock.calls[0][1].idempotencyKey;
    const secondKey = sendSpy.mock.calls[1][1].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });
});
