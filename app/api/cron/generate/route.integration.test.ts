import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../../../lib/db';
import { categories, recurringSchedule, monthlyEntries } from '../../../../lib/db/schema';
import { setFlag } from '../../../../lib/flags';
import { CRON_SECRET, makeHousehold, cleanupHousehold, mockCronEnv } from '../test-helpers';

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  vi.doUnmock('../../../../lib/env');
  vi.doUnmock('../../../../lib/flags');
  vi.resetModules();
});

async function makeHouseholdWithActiveItem(label: string) {
  const household = await makeHousehold(label);
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

describe('GET /api/cron/generate', () => {
  it('rejects a request with no authorization header (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/cron/generate'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a forged secret (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: 'Bearer forged-secret' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('materializes the next 3 months for a household with auto_generate on (the default)', async () => {
    const household = await makeHouseholdWithActiveItem('Generate on A');

    mockCronEnv();
    const { GET } = await import('./route');
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

    await cleanupHousehold(household.id);
  });

  it('is a no-op for a household with auto_generate explicitly off', async () => {
    const household = await makeHouseholdWithActiveItem('Generate off A');
    await setFlag(household.id, 'auto_generate', false);

    mockCronEnv();
    const { GET } = await import('./route');
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

    await cleanupHousehold(household.id);
  });

  it('is idempotent across repeated calls (ON CONFLICT DO NOTHING)', async () => {
    const household = await makeHouseholdWithActiveItem('Generate idempotent A');

    mockCronEnv();
    const { GET } = await import('./route');
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

    await cleanupHousehold(household.id);
  });

  it('one household throwing (e.g. a transient flag-check error) does not stop other households from being processed', async () => {
    const failing = await makeHouseholdWithActiveItem('Generate isolation FAIL');
    const healthy = await makeHouseholdWithActiveItem('Generate isolation OK');

    mockCronEnv();
    vi.doMock('../../../../lib/flags', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../../lib/flags')>();
      return {
        ...actual,
        isEnabled: vi.fn((householdId: string, flag: Parameters<typeof actual.isEnabled>[1]) => {
          if (householdId === failing.id) throw new Error('simulated flag-check failure');
          return actual.isEnabled(householdId, flag);
        }),
      };
    });
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/generate', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(200); // one household's throw never 500s the whole request

    const healthyRows = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.householdId, healthy.id));
    expect(healthyRows.length).toBeGreaterThanOrEqual(3); // the healthy household still got processed

    await cleanupHousehold(failing.id);
    await cleanupHousehold(healthy.id);
  });
});
