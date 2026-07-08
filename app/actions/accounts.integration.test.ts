import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { households, users, sessions, bankAccounts, recurringSchedule } from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';

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
});

async function makeHouseholdWithUser(role: 'owner' | 'member' | 'viewer', label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      email: `${label.replace(/\s+/g, '-')}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: role,
      role,
    })
    .returning();
  const token = generateToken();
  await db.insert(sessions).values({ id: token, userId: user.id, expiresAt: newExpiry() });
  return { household, user, token };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function cleanup(...householdIds: string[]) {
  for (const id of householdIds) {
    await db.delete(households).where(eq(households.id, id));
  }
}

describe('createAccountAction', () => {
  it('a member can create a bank account', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create A');
    mockToken = member.token;

    const result = await createAccountAction(
      undefined,
      formData({ name: 'DBS', accountType: 'bank' }),
    );

    expect(result).toEqual({ success: true });
    const rows = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, member.household.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'DBS', accountType: 'bank', linkedBankAccountId: null });

    await cleanup(member.household.id);
  });

  it('a credit account can link to a bank account in the same household', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create B');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'DBS', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await createAccountAction(
      undefined,
      formData({ name: 'Credit Card', accountType: 'credit', linkedBankAccountId: bank.id }),
    );

    expect(result).toEqual({ success: true });
    const [credit] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.name, 'Credit Card'));
    expect(credit.linkedBankAccountId).toBe(bank.id);

    await cleanup(member.household.id);
  });

  it('rejects linking to a bank account in a DIFFERENT household (cross-tenant probe)', async () => {
    const { createAccountAction } = await import('./accounts');
    const memberA = await makeHouseholdWithUser('member', 'Acct create C-A');
    const memberB = await makeHouseholdWithUser('member', 'Acct create C-B');
    const [bankInB] = await db
      .insert(bankAccounts)
      .values({ householdId: memberB.household.id, name: 'B Bank', accountType: 'bank' })
      .returning();

    mockToken = memberA.token;
    const result = await createAccountAction(
      undefined,
      formData({ name: 'Credit Card', accountType: 'credit', linkedBankAccountId: bankInB.id }),
    );

    expect(result).toEqual({ error: 'Linked bank account not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('rejects linking to a "credit" account (only "bank" accounts are valid link targets)', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create D');
    const [otherCredit] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Other Credit', accountType: 'credit' })
      .returning();

    mockToken = member.token;
    const result = await createAccountAction(
      undefined,
      formData({ name: 'New Credit', accountType: 'credit', linkedBankAccountId: otherCredit.id }),
    );

    expect(result).toEqual({ error: 'Linked bank account not found.' });

    await cleanup(member.household.id);
  });
});

describe('updateAccountAction', () => {
  it('rejects linking an account to itself', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update A');
    const [acct] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'DBS', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({ id: acct.id, name: 'DBS', accountType: 'bank', linkedBankAccountId: acct.id }),
    );

    expect(result).toEqual({ error: 'An account cannot link to itself.' });

    await cleanup(member.household.id);
  });

  it('cannot update an account in a DIFFERENT household (cross-tenant probe)', async () => {
    const { updateAccountAction } = await import('./accounts');
    const memberA = await makeHouseholdWithUser('member', 'Acct update B-A');
    const memberB = await makeHouseholdWithUser('member', 'Acct update B-B');
    const [acctInB] = await db
      .insert(bankAccounts)
      .values({ householdId: memberB.household.id, name: 'B Acct', accountType: 'bank' })
      .returning();

    mockToken = memberA.token;
    const result = await updateAccountAction(
      undefined,
      formData({ id: acctInB.id, name: 'Hijacked', accountType: 'bank' }),
    );

    expect(result).toEqual({ error: 'Account not found.' });

    await cleanup(memberA.household.id, memberB.household.id);
  });
});

describe('deleteAccountAction', () => {
  it('deletes an account and nullifies references via ON DELETE SET NULL', async () => {
    const { deleteAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct delete A');
    const [acct] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'DBS', accountType: 'bank' })
      .returning();
    const [item] = await db
      .insert(recurringSchedule)
      .values({
        householdId: member.household.id,
        item: 'Mortgage',
        bankAccountId: acct.id,
        frequency: 'Monthly',
      })
      .returning();

    mockToken = member.token;
    const result = await deleteAccountAction(undefined, formData({ id: acct.id }));

    expect(result).toEqual({ success: true });
    const [reloadedItem] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.id, item.id));
    expect(reloadedItem.bankAccountId).toBeNull();

    await cleanup(member.household.id);
  });

  it('deleting a linked bank account nullifies the linking credit account, not cascade-deletes it', async () => {
    const { deleteAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct delete B');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'DBS', accountType: 'bank' })
      .returning();
    const [credit] = await db
      .insert(bankAccounts)
      .values({
        householdId: member.household.id,
        name: 'Credit Card',
        accountType: 'credit',
        linkedBankAccountId: bank.id,
      })
      .returning();

    mockToken = member.token;
    const result = await deleteAccountAction(undefined, formData({ id: bank.id }));

    expect(result).toEqual({ success: true });
    const [reloadedCredit] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, credit.id));
    expect(reloadedCredit).toBeDefined();
    expect(reloadedCredit.linkedBankAccountId).toBeNull();

    await cleanup(member.household.id);
  });
});
