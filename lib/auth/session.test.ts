import { beforeEach, describe, expect, it, vi } from 'vitest';

// session.ts is coupled to next/headers's cookies() (only works in a real Next.js
// request context) and the DB — mocking both lets this be a genuine unit test rather
// than needing a live DB, same pattern as lib/auth/members.integration.test.ts uses for
// the Server Actions layer, just one level lower (no real DB here at all).
vi.mock('server-only', () => ({}));

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};
vi.mock('../db', () => ({ db: dbMock }));

describe('session.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getSessionUser is wrapped in React's cache(), which memoizes per module instance
    // — without resetting the module registry, a later test's call could silently
    // return an earlier test's cached result instead of exercising the mocked DB again.
    vi.resetModules();
  });

  describe('createSession', () => {
    it('inserts a session row and sets the cookie with the same token', async () => {
      const valuesSpy = vi.fn<
        (row: { id: string; userId: string; expiresAt: Date }) => Promise<void>
      >(() => Promise.resolve());
      dbMock.insert.mockReturnValue({ values: valuesSpy });

      const { createSession, SESSION_COOKIE_NAME } = await import('./session');
      await createSession('user-1');

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', id: expect.any(String) }),
      );
      expect(cookieStore.set).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      // The token inserted into the DB and the token set on the cookie must be the
      // same value — the whole point of an opaque bearer token.
      const insertedToken = valuesSpy.mock.calls[0][0].id;
      const cookieToken = cookieStore.set.mock.calls[0][1];
      expect(insertedToken).toBe(cookieToken);
    });
  });

  describe('getSessionUser', () => {
    it('returns null when there is no session cookie at all', async () => {
      cookieStore.get.mockReturnValue(undefined);

      const { getSessionUser } = await import('./session');
      await expect(getSessionUser()).resolves.toBeNull();
      expect(dbMock.select).not.toHaveBeenCalled();
    });

    it('returns null when the cookie token matches no session row', async () => {
      cookieStore.get.mockReturnValue({ value: 'some-token' });
      dbMock.select.mockReturnValue(createSelectChain([]));

      const { getSessionUser } = await import('./session');
      await expect(getSessionUser()).resolves.toBeNull();
    });

    it('returns null (not the stale user) when the matched session row is expired', async () => {
      cookieStore.get.mockReturnValue({ value: 'some-token' });
      dbMock.select.mockReturnValue(
        createSelectChain([
          {
            expiresAt: new Date(Date.now() - 1000),
            userId: 'u1',
            householdId: 'h1',
            email: 'a@example.com',
            name: 'A',
            role: 'owner',
          },
        ]),
      );

      const { getSessionUser } = await import('./session');
      await expect(getSessionUser()).resolves.toBeNull();
    });

    it('returns the mapped user for a valid, unexpired session', async () => {
      cookieStore.get.mockReturnValue({ value: 'some-token' });
      dbMock.select.mockReturnValue(
        createSelectChain([
          {
            expiresAt: new Date(Date.now() + 60_000),
            userId: 'u1',
            householdId: 'h1',
            email: 'a@example.com',
            name: 'A',
            role: 'owner',
          },
        ]),
      );

      const { getSessionUser } = await import('./session');
      await expect(getSessionUser()).resolves.toEqual({
        id: 'u1',
        householdId: 'h1',
        email: 'a@example.com',
        name: 'A',
        role: 'owner',
      });
    });
  });

  describe('deleteSession', () => {
    it('deletes the session row and clears the cookie when a session cookie is present', async () => {
      cookieStore.get.mockReturnValue({ value: 'some-token' });
      const whereSpy = vi.fn(() => Promise.resolve());
      dbMock.delete.mockReturnValue({ where: whereSpy });

      const { deleteSession, SESSION_COOKIE_NAME } = await import('./session');
      await deleteSession();

      expect(whereSpy).toHaveBeenCalled();
      expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    });

    it('still clears the cookie even when there was no session cookie to begin with', async () => {
      cookieStore.get.mockReturnValue(undefined);

      const { deleteSession, SESSION_COOKIE_NAME } = await import('./session');
      await deleteSession();

      expect(dbMock.delete).not.toHaveBeenCalled();
      expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    });
  });

  describe('sessionCookieOptions', () => {
    it('is not marked secure outside production (so login works over plain http in dev)', async () => {
      const { sessionCookieOptions } = await import('./session');
      expect(sessionCookieOptions(new Date()).secure).toBe(false);
    });
  });
});
