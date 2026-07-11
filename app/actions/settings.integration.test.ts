import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '../../lib/db';
import { householdSettings } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

let mockToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterEach(() => {
  mockToken = undefined;
});

describe('setHorizonAction', () => {
  it('writes the horizon to household_settings (round-trip)', async () => {
    const { setHorizonAction } = await import('./settings');
    const member = await makeHouseholdWithUser('member', 'Horizon A');

    mockToken = member.token;
    const result = await setHorizonAction(undefined, formData({ horizon: '14' }));

    expect(result).toEqual({ success: true });
    const [row] = await db
      .select()
      .from(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, member.household.id),
          eq(householdSettings.key, 'affordability_horizon'),
        ),
      );
    expect(row.value).toBe('14');

    await cleanup(member.household.id);
  });

  it('a member (not just an owner) may change it — this is a viewing preference, not manage_settings', async () => {
    const { setHorizonAction } = await import('./settings');
    const member = await makeHouseholdWithUser('member', 'Horizon B');

    mockToken = member.token;
    const result = await setHorizonAction(undefined, formData({ horizon: '7' }));
    expect(result).toEqual({ success: true });

    await cleanup(member.household.id);
  });

  it('a viewer cannot change the horizon', async () => {
    const { setHorizonAction } = await import('./settings');
    const viewer = await makeHouseholdWithUser('viewer', 'Horizon C');

    mockToken = viewer.token;
    await expect(setHorizonAction(undefined, formData({ horizon: '30' }))).rejects.toThrow(
      'You do not have permission to perform this action.',
    );

    await cleanup(viewer.household.id);
  });

  it('rejects a tampered/out-of-set horizon value (adversarial: forged form field)', async () => {
    const { setHorizonAction } = await import('./settings');
    const member = await makeHouseholdWithUser('member', 'Horizon D');

    mockToken = member.token;
    const result = await setHorizonAction(undefined, formData({ horizon: '9999' }));
    expect(result).toEqual({ error: 'Invalid horizon.' });

    const rows = await db
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, member.household.id));
    expect(rows).toHaveLength(0);

    await cleanup(member.household.id);
  });

  it('an existing horizon can be updated (upsert), not duplicated', async () => {
    const { setHorizonAction } = await import('./settings');
    const member = await makeHouseholdWithUser('member', 'Horizon E');

    mockToken = member.token;
    await setHorizonAction(undefined, formData({ horizon: '7' }));
    await setHorizonAction(undefined, formData({ horizon: 'month' }));

    const rows = await db
      .select()
      .from(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, member.household.id),
          eq(householdSettings.key, 'affordability_horizon'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('month');

    await cleanup(member.household.id);
  });
});
