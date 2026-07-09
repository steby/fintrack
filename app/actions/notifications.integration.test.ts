import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { users } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

let mockToken: string | undefined;
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'session' && mockToken ? { name, value: mockToken } : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

afterAll(async () => {
  await pool.end();
});

afterEach(() => {
  mockToken = undefined;
  vi.doUnmock('../../lib/email/resend');
  vi.resetModules();
});

describe('toggleEmailRemindersAction', () => {
  it('an owner can enable email_reminders', async () => {
    const { toggleEmailRemindersAction } = await import('./notifications');
    const owner = await makeHouseholdWithUser('owner', 'Notif reminders A');
    mockToken = owner.token;

    const result = await toggleEmailRemindersAction(undefined, formData({ enabled: 'true' }));
    expect(result).toEqual({ success: true });

    const { isEnabled } = await import('../../lib/flags');
    expect(await isEnabled(owner.household.id, 'email_reminders')).toBe(true);

    await cleanup(owner.household.id);
  });

  it('a member cannot toggle email_reminders (owner-only)', async () => {
    const { toggleEmailRemindersAction } = await import('./notifications');
    const member = await makeHouseholdWithUser('member', 'Notif reminders B');
    mockToken = member.token;

    await expect(
      toggleEmailRemindersAction(undefined, formData({ enabled: 'true' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(member.household.id);
  });
});

describe('toggleMonthlyRecapAction', () => {
  it('an owner can enable monthly_recap', async () => {
    const { toggleMonthlyRecapAction } = await import('./notifications');
    const owner = await makeHouseholdWithUser('owner', 'Notif recap A');
    mockToken = owner.token;

    const result = await toggleMonthlyRecapAction(undefined, formData({ enabled: 'true' }));
    expect(result).toEqual({ success: true });

    const { isEnabled } = await import('../../lib/flags');
    expect(await isEnabled(owner.household.id, 'monthly_recap')).toBe(true);

    await cleanup(owner.household.id);
  });

  it('a viewer cannot toggle monthly_recap (owner-only)', async () => {
    const { toggleMonthlyRecapAction } = await import('./notifications');
    const viewer = await makeHouseholdWithUser('viewer', 'Notif recap B');
    mockToken = viewer.token;

    await expect(
      toggleMonthlyRecapAction(undefined, formData({ enabled: 'true' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id);
  });
});

describe('updateNotifyByEmailAction', () => {
  it('lets any role (not just the owner) opt themselves in', async () => {
    const { updateNotifyByEmailAction } = await import('./notifications');
    const viewer = await makeHouseholdWithUser('viewer', 'Notif opt-in A');
    mockToken = viewer.token;

    const result = await updateNotifyByEmailAction(undefined, formData({ enabled: 'true' }));
    expect(result).toEqual({ success: true });

    const [row] = await db.select().from(users).where(eq(users.id, viewer.user.id));
    expect(row.notifyByEmail).toBe(true);

    await cleanup(viewer.household.id);
  });

  it('only ever updates the acting user, never another member (no userId in the input)', async () => {
    const { updateNotifyByEmailAction } = await import('./notifications');
    const member = await makeHouseholdWithUser('member', 'Notif opt-in B-actor');
    const other = await makeHouseholdWithUser('member', 'Notif opt-in B-other');
    mockToken = member.token;

    await updateNotifyByEmailAction(undefined, formData({ enabled: 'true' }));

    const [actorRow] = await db.select().from(users).where(eq(users.id, member.user.id));
    const [otherRow] = await db.select().from(users).where(eq(users.id, other.user.id));
    expect(actorRow.notifyByEmail).toBe(true);
    expect(otherRow.notifyByEmail).toBe(false);

    await cleanup(member.household.id, other.household.id);
  });
});

describe('sendTestEmailAction', () => {
  it('sends to the acting user’s own address, never an arbitrary recipient', async () => {
    const sendEmailSpy = vi.fn().mockResolvedValue(true);
    vi.doMock('../../lib/email/resend', () => ({ sendEmail: sendEmailSpy }));
    vi.resetModules();

    const { sendTestEmailAction } = await import('./notifications');
    const member = await makeHouseholdWithUser('member', 'Notif test-email A');
    mockToken = member.token;

    const result = await sendTestEmailAction(undefined, new FormData());
    expect(result).toEqual({ success: true });
    expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: member.user.email }));

    await cleanup(member.household.id);
  });

  it('surfaces an error when the send genuinely fails after retries', async () => {
    vi.doMock('../../lib/email/resend', () => ({ sendEmail: vi.fn().mockResolvedValue(false) }));
    vi.resetModules();

    const { sendTestEmailAction } = await import('./notifications');
    const member = await makeHouseholdWithUser('member', 'Notif test-email B');
    mockToken = member.token;

    const result = await sendTestEmailAction(undefined, new FormData());
    expect(result?.error).toBeTruthy();

    await cleanup(member.household.id);
  });
});
