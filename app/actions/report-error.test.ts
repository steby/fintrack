import { describe, expect, it, vi } from 'vitest';

// No DB/Next-runtime dependency at all (unlike its Server Action siblings) — it only
// calls lib/observability.ts's captureException, so this is a plain unit test (mocking
// that one call), not an integration test.
const captureExceptionMock = vi.fn();
vi.mock('../../lib/observability', () => ({ captureException: captureExceptionMock }));

describe('reportClientError', () => {
  it('forwards a well-formed message and digest to captureException', async () => {
    const { reportClientError } = await import('./report-error');
    await reportClientError('Something broke', 'abc123');

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [error, context] = captureExceptionMock.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Something broke');
    expect(context).toEqual({ digest: 'abc123' });
  });

  it('omits the context argument entirely when no digest is provided', async () => {
    vi.resetModules();
    captureExceptionMock.mockClear();
    const { reportClientError } = await import('./report-error');
    await reportClientError('Something broke');

    const [, context] = captureExceptionMock.mock.calls[0];
    expect(context).toBeUndefined();
  });

  it('rejects a message over the length cap, reporting a fixed safe message instead of the raw oversized input (regression: no auth/validation on a public Server Action)', async () => {
    vi.resetModules();
    captureExceptionMock.mockClear();
    const { reportClientError } = await import('./report-error');

    const hugeMessage = 'x'.repeat(2001);
    await reportClientError(hugeMessage);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [error] = captureExceptionMock.mock.calls[0];
    expect((error as Error).message).toBe('reportClientError: received a malformed report');
    // The raw oversized input must never reach captureException/Sentry/logs.
    expect((error as Error).message).not.toContain('x'.repeat(100));
  });

  it('rejects an over-length digest the same way', async () => {
    vi.resetModules();
    captureExceptionMock.mockClear();
    const { reportClientError } = await import('./report-error');

    await reportClientError('Fine message', 'd'.repeat(201));

    const [error] = captureExceptionMock.mock.calls[0];
    expect((error as Error).message).toBe('reportClientError: received a malformed report');
  });

  it('accepts a message exactly at the length cap boundary', async () => {
    vi.resetModules();
    captureExceptionMock.mockClear();
    const { reportClientError } = await import('./report-error');

    const boundaryMessage = 'x'.repeat(2000);
    await reportClientError(boundaryMessage);

    const [error] = captureExceptionMock.mock.calls[0];
    expect((error as Error).message).toBe(boundaryMessage);
  });

  it("rejects a non-string digest sent by a direct POST bypassing the client's TypeScript types (regression: TS types are not a runtime guarantee on a public endpoint)", async () => {
    vi.resetModules();
    captureExceptionMock.mockClear();
    const { reportClientError } = await import('./report-error');

    // Simulates a crafted request reaching this action with a non-string digest —
    // impossible to construct through app/error.tsx's own call site (which always
    // passes error.digest, itself string|undefined), but exactly the kind of input a
    // direct POST to this action's public endpoint could send.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reportClientError('Fine message', { malicious: 'payload' } as any);

    const [error] = captureExceptionMock.mock.calls[0];
    expect((error as Error).message).toBe('reportClientError: received a malformed report');
  });
});
