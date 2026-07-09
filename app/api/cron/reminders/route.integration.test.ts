import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../../../../lib/db';
import { categories, recurringSchedule, monthlyEntries, emailLog } from '../../../../lib/db/schema';
import { setFlag } from '../../../../lib/flags';
import {
  CRON_SECRET,
  makeHousehold,
  makeRecipient,
  cleanupHousehold,
  mockCronEnv,
} from '../test-helpers';

vi.mock('server-only', () => ({}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  vi.doUnmock('../../../../lib/env');
  vi.doUnmock('../../../../lib/db/queries');
  vi.resetModules();
});

async function makeUnpaidBill(householdId: string, item: string, actualDateDay: number) {
  const now = new Date();
  const [category] = await db
    .insert(categories)
    .values({ householdId, name: 'Bills', direction: 'expense' })
    .returning();
  const [schedule] = await db
    .insert(recurringSchedule)
    .values({
      householdId,
      item,
      categoryId: category.id,
      budgetedAmount: '100.00',
      frequency: 'Monthly',
      actualDateDay,
    })
    .returning();
  await db.insert(monthlyEntries).values({
    householdId,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    recurringScheduleId: schedule.id,
    item,
    categoryId: category.id,
    budgetedAmount: '100.00',
  });
}

describe('GET /api/cron/reminders', () => {
  it('rejects a request with no authorization header (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/cron/reminders'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a forged secret (401)', async () => {
    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: 'Bearer forged-secret' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('is a no-op for a household with email_reminders off (default)', async () => {
    const household = await makeHousehold('Reminders off A');
    await makeUnpaidBill(household.id, 'Rent', new Date().getUTCDate());
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('sends a reminder digest for a bill due within the window, when enabled and opted in', async () => {
    const household = await makeHousehold('Reminders on A');
    await setFlag(household.id, 'email_reminders', true);
    await makeUnpaidBill(household.id, 'Rent', new Date().getUTCDate());
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);

    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(1);
    expect(logged[0].type).toBe('reminder');

    await cleanupHousehold(household.id);
  });

  it('does not send, and does not claim the day, when there are no upcoming bills (no empty email)', async () => {
    const household = await makeHousehold('Reminders no bills A');
    await setFlag(household.id, 'email_reminders', true);
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);
    expect(body.skippedNoBills).toBeGreaterThanOrEqual(1);

    // Not claimed — a bill could show up later the same day (e.g. an ad-hoc entry),
    // and there's no reason to permanently forfeit the day when nothing was sent yet.
    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('does not send when no member has opted in', async () => {
    const household = await makeHousehold('Reminders no recipients A');
    await setFlag(household.id, 'email_reminders', true);
    await makeUnpaidBill(household.id, 'Rent', new Date().getUTCDate());

    mockCronEnv();
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();
    expect(body.sent).toBe(0);
    expect(body.skippedNoRecipients).toBeGreaterThanOrEqual(1);

    // Not claimed — see the "opts in after an earlier empty check" test below for why
    // this matters: a member could opt in before a later legitimate invocation.
    const logged = await db.select().from(emailLog).where(eq(emailLog.householdId, household.id));
    expect(logged).toHaveLength(0);

    await cleanupHousehold(household.id);
  });

  it('sends once a member opts in, even after an earlier call found no recipients for the same day', async () => {
    const household = await makeHousehold('Reminders late opt-in A');
    await setFlag(household.id, 'email_reminders', true);
    await makeUnpaidBill(household.id, 'Rent', new Date().getUTCDate());

    mockCronEnv();
    const { GET } = await import('./route');
    const request = () =>
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });

    const first = await (await GET(request())).json();
    expect(first.sent).toBe(0);
    expect(first.skippedNoRecipients).toBeGreaterThanOrEqual(1);

    // A member opts in after the first (empty) check for the same UTC day.
    await makeRecipient(household.id, 'Owner');

    const second = await (await GET(request())).json();
    expect(second.sent).toBe(1); // not stuck behind a stale claim from the first call

    await cleanupHousehold(household.id);
  });

  it('is idempotent: a second call the same UTC day does not double-send (dedup ledger)', async () => {
    const household = await makeHousehold('Reminders dedup A');
    await setFlag(household.id, 'email_reminders', true);
    await makeUnpaidBill(household.id, 'Rent', new Date().getUTCDate());
    await makeRecipient(household.id, 'Owner');

    mockCronEnv();
    const { GET } = await import('./route');
    const request = () =>
      new Request('http://localhost/api/cron/reminders', {
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
      .where(and(eq(emailLog.householdId, household.id), eq(emailLog.type, 'reminder')));
    expect(logged).toHaveLength(1); // exactly one row, not two

    await cleanupHousehold(household.id);
  });

  it('one household throwing (e.g. a transient DB error) does not stop other households from being processed', async () => {
    const failing = await makeHousehold('Reminders isolation FAIL');
    await setFlag(failing.id, 'email_reminders', true);
    await makeUnpaidBill(failing.id, 'Rent', new Date().getUTCDate());
    await makeRecipient(failing.id, 'Owner');

    const healthy = await makeHousehold('Reminders isolation OK');
    await setFlag(healthy.id, 'email_reminders', true);
    await makeUnpaidBill(healthy.id, 'Rent', new Date().getUTCDate());
    await makeRecipient(healthy.id, 'Owner');

    mockCronEnv();
    vi.doMock('../../../../lib/db/queries', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../../lib/db/queries')>();
      return {
        ...actual,
        getUpcomingBillCandidates: vi.fn((householdId: string, buckets: unknown) => {
          if (householdId === failing.id) throw new Error('simulated DB failure');
          return actual.getUpcomingBillCandidates(
            householdId,
            buckets as Parameters<typeof actual.getUpcomingBillCandidates>[1],
          );
        }),
      };
    });
    vi.resetModules();

    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/cron/reminders', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200); // one household's throw never 500s the whole request
    expect(body.sent).toBe(1); // the healthy household still got its email

    await cleanupHousehold(failing.id);
    await cleanupHousehold(healthy.id);
  });
});
