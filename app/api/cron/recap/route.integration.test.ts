import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../../../../lib/db';
import { households, users, categories, monthlyEntries, emailLog } from '../../../../lib/db/schema';
import { setFlag } from '../../../../lib/flags';
import { addMonths } from '../../../../lib/domain/recurring';

vi.mock('server-only', () => ({}));

const CRON_SECRET = 'test-cron-secret-with-enough-length-1234';

function targetPeriod() {
  const now = new Date();
  const currentYM = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return addMonths(currentYM, -1);
}

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  vi.doUnmock('../../../../lib/env');
  vi.resetModules();
});

async function makeHousehold(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  return household;
}

async function makeRecipient(householdId: string, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      householdId,
      email: `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: label,
      role: 'member',
      notifyByEmail: true,
    })
    .returning();
  return user;
}

async function makePriorMonthEntry(householdId: string, amount: string) {
  const { year, month } = targetPeriod();
  const [category] = await db
    .insert(categories)
    .values({ householdId, name: 'Salary', direction: 'income' })
    .returning();
  await db.insert(monthlyEntries).values({
    householdId,
    year,
    month,
    item: 'Paycheck',
    categoryId: category.id,
    budgetedAmount: amount,
    actualAmount: amount,
  });
}

async function cleanup(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

async function loadRouteWithMockedEnv(overrides: Record<string, unknown> = {}) {
  vi.doMock('../../../../lib/env', () => ({
    env: { CRON_SECRET, RESEND_API_KEY: undefined, ...overrides },
  }));
  vi.resetModules();
  return import('./route');
}

describe('GET /api/cron/recap', () => {
  it('rejects a request with no authorization header (401)', async () => {
    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(new Request('http://localhost/api/cron/recap'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a forged secret (401)', async () => {
    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: 'Bearer forged-secret' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('is a no-op for a household with monthly_recap off (default)', async () => {
    const household = await makeHousehold('Recap off A');
    await makePriorMonthEntry(household.id, '5000.00');
    await makeRecipient(household.id, 'Owner');

    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanup(household.id);
  });

  it('sends a recap for the prior month when enabled, with data, and opted in', async () => {
    const household = await makeHousehold('Recap on A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');
    await makeRecipient(household.id, 'Owner');

    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(1);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(1);
    expect(logged[0].type).toBe('recap');

    await cleanup(household.id);
  });

  it('skips a household with zero entries in the prior month (no empty recap), but still claims the period', async () => {
    const household = await makeHousehold('Recap empty A');
    await setFlag(household.id, 'monthly_recap', true);
    await makeRecipient(household.id, 'Owner');

    const { GET } = await loadRouteWithMockedEnv();
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);
    expect(body.skippedEmpty).toBe(1);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(1);

    await cleanup(household.id);
  });

  it('is idempotent: a second call the same month does not double-send (dedup ledger)', async () => {
    const household = await makeHousehold('Recap dedup A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');
    await makeRecipient(household.id, 'Owner');

    const { GET } = await loadRouteWithMockedEnv();
    const request = () =>
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });

    const first = await (await GET(request())).json();
    expect(first.sent).toBe(1);

    const second = await (await GET(request())).json();
    expect(second.sent).toBe(0);
    expect(second.alreadyClaimed).toBe(1);

    const logged = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.householdId, household.id), eq(emailLog.type, 'recap')));
    expect(logged).toHaveLength(1);

    await cleanup(household.id);
  });
});
