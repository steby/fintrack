import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Real next/navigation's redirect() throws a special marker error to signal navigation
// to the framework — it never actually returns. Mimicking that (rather than a no-op)
// is what lets these tests prove requireUser() genuinely stops execution on redirect,
// not just that it "called a function."
const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const getSessionUserMock = vi.fn();
vi.mock('./session', () => ({ getSessionUser: getSessionUserMock }));

const isEnabledMock = vi.fn();
vi.mock('../flags', () => ({ isEnabled: isEnabledMock }));

const OWNER = { id: 'u1', householdId: 'h1', email: 'a@example.com', name: 'A', role: 'owner' };
const VIEWER = { id: 'u2', householdId: 'h1', email: 'b@example.com', name: 'B', role: 'viewer' };

describe('guards.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('requireUser', () => {
    it('returns the user when a valid session exists', async () => {
      getSessionUserMock.mockResolvedValue(OWNER);

      const { requireUser } = await import('./guards');
      await expect(requireUser()).resolves.toEqual(OWNER);
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('redirects to /login when there is no session', async () => {
      getSessionUserMock.mockResolvedValue(null);

      const { requireUser } = await import('./guards');
      await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/login');
      expect(redirectMock).toHaveBeenCalledWith('/login');
    });
  });

  describe('requireRole', () => {
    it('returns the user when their role permits the action', async () => {
      getSessionUserMock.mockResolvedValue(OWNER);

      const { requireRole } = await import('./guards');
      await expect(requireRole('manage_members')).resolves.toEqual(OWNER);
    });

    it('throws ForbiddenError (not a redirect) when the role does not permit the action', async () => {
      getSessionUserMock.mockResolvedValue(VIEWER);

      const { requireRole, ForbiddenError } = await import('./guards');
      await expect(requireRole('write')).rejects.toThrow(ForbiddenError);
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('redirects to /login (via requireUser) rather than throwing ForbiddenError when there is no session at all', async () => {
      getSessionUserMock.mockResolvedValue(null);

      const { requireRole } = await import('./guards');
      await expect(requireRole('write')).rejects.toThrow('NEXT_REDIRECT:/login');
    });
  });

  // Unifies what were 4 independently-shaped flag-gating patterns across
  // categories.ts/accounts.ts/goals.ts/import.ts into one "flag off -> error string"
  // primitive per flag kind — see PROGRESS.md's cross-phase cleanup pass entry.
  describe('requireConfigFlag', () => {
    it('returns null when the flag is enabled', async () => {
      const { requireConfigFlag } = await import('./guards');
      expect(requireConfigFlag(true, 'Feature not enabled.')).toBeNull();
    });

    it('returns the given message when the flag is disabled', async () => {
      const { requireConfigFlag } = await import('./guards');
      expect(requireConfigFlag(false, 'Feature not enabled.')).toBe('Feature not enabled.');
    });
  });

  describe('requireKillSwitch', () => {
    it('returns null when the kill-switch is on', async () => {
      isEnabledMock.mockResolvedValue(true);

      const { requireKillSwitch } = await import('./guards');
      await expect(requireKillSwitch('h1', 'csv_import', 'Not enabled.')).resolves.toBeNull();
      expect(isEnabledMock).toHaveBeenCalledWith('h1', 'csv_import');
    });

    it('returns the given message when the kill-switch is off', async () => {
      isEnabledMock.mockResolvedValue(false);

      const { requireKillSwitch } = await import('./guards');
      await expect(requireKillSwitch('h1', 'csv_import', 'Not enabled.')).resolves.toBe(
        'Not enabled.',
      );
    });
  });
});
