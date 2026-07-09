import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../../lib/db';
import {
  households,
  categories,
  recurringSchedule,
  monthlyEntries,
} from '../../../../lib/db/schema';
import { setFlag } from '../../../../lib/flags';

vi.mock('server-only', () => ({}));

const CRON_SECRET = 'test-cron-secret-with-enough-length-1234';

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  vi.doUnmock('../../../../lib/env');
  vi.resetModules();
});

async function makeHouseholdWithActiveItem(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  const [category] = await db
    .insert(categories)
    .values({ householdId: household.id, name: 'Rent', direction: 'expense' })
    .returning();
  await db.insert(recurringSchedule).values({
    householdId: household.id,
    item: 'Rent',
    categoryId: category.id,
    budgetedAmount: '2000.00',
    frequency: 'Monthly',
    isActive: true,
  });
  return household;
}

async function cleanup(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

async function loadRouteWithMockedEnv() {
  vi.doMock('../../../../lib/env', () => ({ env: { CRON_SECRET } }));
  vi.resetModules();
  return import('./route');
}

describe('GET /api/cron/generate', () => {
  it('rejects a request with no authorization header (401)', async () => {
    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(new Request('http://localhost/api/cron/generate'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a forged secret (401)', async () => {
    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: 'Bearer forged-secret' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('materializes the next 3 months for a household with auto_generate on (the default)', async () => {
    const household = await makeHouseholdWithActiveItem('Generate on A');

    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(response.status).toBe(200);

    const rows = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, household.id));
    expect(rows.length).toBeGreaterThanOrEqual(3);

    await cleanup(household.id);
  });

  it('is a no-op for a household with auto_generate explicitly off', async () => {
    const household = await makeHouseholdWithActiveItem('Generate off A');
    await setFlag(household.id, 'auto_generate', false);

    const { GET } = await loadRouteWithMockedEnv();
    await GET(
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    const rows = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, household.id));
    expect(rows).toHaveLength(0);

    await cleanup(household.id);
  });

  it('is idempotent across repeated calls (ON CONFLICT DO NOTHING)', async () => {
    const household = await makeHouseholdWithActiveItem('Generate idempotent A');

    const { GET } = await loadRouteWithMockedEnv();
    const request = () =>
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
    await GET(request());
    const rowsAfterFirst = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, household.id));

    await GET(request());
    const rowsAfterSecond = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, household.id));

    expect(rowsAfterSecond).toHaveLength(rowsAfterFirst.length);

    await cleanup(household.id);
  });
});
