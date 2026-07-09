import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../../../../lib/db';
import { categories, monthlyEntries, emailLog } from '../../../../lib/db/schema';
import { setFlag } from '../../../../lib/flags';
import { addMonths } from '../../../../lib/domain/recurring';
import {
  CRON_SECRET,
  makeHousehold,
  makeRecipient,
  cleanupHousehold,
  mockCronEnv,
} from '../test-helpers';

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

describe('GET /api/cron/recap', () => {
  it('rejects a request with no authorization header (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/cron/recap'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a forged secret (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
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

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('sends a recap for the prior month when enabled, with data, and opted in', async () => {
    const household = await makeHousehold('Recap on A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
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

    await cleanupHousehold(household.id);
  });

  it('skips, and does not claim the period, for a household with zero entries in the prior month (no empty recap)', async () => {
    const household = await makeHousehold('Recap empty A');
    await setFlag(household.id, 'monthly_recap', true);
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);
    expect(body.skippedEmpty).toBeGreaterThanOrEqual(1);

    // Not claimed — a household could still get real entries added for that month
    // before the month is truly closed out, so the period isn't permanently forfeited.
    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('does not send, and does not claim the period, when no member has opted in', async () => {
    const household = await makeHousehold('Recap no recipients A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);
    expect(body.skippedNoRecipients).toBeGreaterThanOrEqual(1);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('sends once a member opts in, even after an earlier call found no recipients for the same month', async () => {
    const household = await makeHousehold('Recap late opt-in A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');

    mockCronEnv();
    const { GET } = await import('./route');
    const request = () =>
      new Request('http://localhost/api/cron/recap', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });

    const first = await (await GET(request())).json();
    expect(first.sent).toBe(0);
    expect(first.skippedNoRecipients).toBeGreaterThanOrEqual(1);

    await makeRecipient(household.id, 'Owner');

    const second = await (await GET(request())).json();
    expect(second.sent).toBe(1); // not stuck behind a stale claim from the first call

    await cleanupHousehold(household.id);
  });

  it('is idempotent: a second call the same month does not double-send (dedup ledger)', async () => {
    const household = await makeHousehold('Recap dedup A');
    await setFlag(household.id, 'monthly_recap', true);
    await makePriorMonthEntry(household.id, '5000.00');
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
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

    await cleanupHousehold(household.id);
  });
});
