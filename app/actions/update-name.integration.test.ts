import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

// Same mockToken/cookies plumbing as members.integration.test.ts — see that file's
// comment for why cookies is a vi.fn() rather than a plain arrow function.
let mockToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

afterEach(() => {
  mockToken = undefined;
});

describe('updateNameAction', () => {
  it('updates the authenticated user’s own name', async () => {
    const { updateNameAction } = await import('./auth');
    const { user, household, token } = await makeHouseholdWithUser('owner', 'Update name A');
    mockToken = token;

    const result = await updateNameAction(undefined, formData({ name: 'Steven' }));
    expect(result).toEqual({ success: true });

    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated.name).toBe('Steven');

    await cleanup(household.id);
  });

  it('rejects an empty name and leaves the stored name unchanged', async () => {
    const { updateNameAction } = await import('./auth');
    const { user, household, token } = await makeHouseholdWithUser('owner', 'Update name B');
    mockToken = token;

    const result = await updateNameAction(undefined, formData({ name: '' }));
    expect(result).toEqual({ error: 'Name is required' });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.name).toBe('owner');

    await cleanup(household.id);
  });

  it('rejects a whitespace-only name (trimmed to empty) and leaves the stored name unchanged', async () => {
    const { updateNameAction } = await import('./auth');
    const { user, household, token } = await makeHouseholdWithUser('owner', 'Update name C');
    mockToken = token;

    const result = await updateNameAction(undefined, formData({ name: '   ' }));
    expect(result).toEqual({ error: 'Name is required' });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.name).toBe('owner');

    await cleanup(household.id);
  });

  it('trims surrounding whitespace from an otherwise-valid name', async () => {
    const { updateNameAction } = await import('./auth');
    const { user, household, token } = await makeHouseholdWithUser('owner', 'Update name D');
    mockToken = token;

    const result = await updateNameAction(undefined, formData({ name: '  Steven  ' }));
    expect(result).toEqual({ success: true });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.name).toBe('Steven');

    await cleanup(household.id);
  });
});
