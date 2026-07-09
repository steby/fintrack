import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '../../lib/db';
import { bankAccounts, recurringSchedule } from '../../lib/db/schema';
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

describe('createAccountAction', () => {
  it('a member can create a bank account', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create A');
    mockToken = member.token;

    const result = await createAccountAction(
      undefined,
      formData({ name: 'Test Bank A', accountType: 'bank' }),
    );

    expect(result).toEqual({ success: true });
    const rows = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, member.household.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Test Bank A',
      accountType: 'bank',
      linkedBankAccountId: null,
    });
    expect(rows[0].openingBalance).toBe('0.00');

    await cleanup(member.household.id);
  });

  it('accepts an explicit opening balance, including a negative one (e.g. an overdraft)', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create OB-1');
    mockToken = member.token;

    const result = await createAccountAction(
      undefined,
      formData({ name: 'Checking', accountType: 'bank', openingBalance: '-250.50' }),
    );
    expect(result).toEqual({ success: true });

    const [row] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, member.household.id));
    expect(row.openingBalance).toBe('-250.50');

    await cleanup(member.household.id);
  });

  it('rejects a malformed opening balance', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create OB-2');
    mockToken = member.token;

    const result = await createAccountAction(
      undefined,
      formData({ name: 'Checking', accountType: 'bank', openingBalance: 'not-a-number' }),
    );
    expect(result?.error).toBeTruthy();

    await cleanup(member.household.id);
  });

  it('a credit account can link to a bank account in the same household', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create B');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await createAccountAction(
      undefined,
      formData({ name: 'Credit Card', accountType: 'credit', linkedBankAccountId: bank.id }),
    );

    expect(result).toEqual({ success: true });
    // Scoped by household, not just by name — the seed script creates its own
    // "Credit Card" account too (lib/db/seed.ts), so an unscoped query here could
    // nondeterministically match a different household's row of the same name.
    const [credit] = await db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.name, 'Credit Card'),
          eq(bankAccounts.householdId, member.household.id),
        ),
      );
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

  it('rejects linking a "bank" account to another bank account (only "credit" accounts may link out)', async () => {
    const { createAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct create E');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await createAccountAction(
      undefined,
      formData({ name: 'Test Bank B', accountType: 'bank', linkedBankAccountId: bank.id }),
    );

    expect(result).toEqual({ error: 'Only credit accounts can link to a bank account.' });

    await cleanup(member.household.id);
  });
});

describe('updateAccountAction', () => {
  it('rejects linking an account to itself', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update A');
    // Must be a 'credit' account — a 'bank' account can't have any linkedBankAccountId
    // at all (the "source must be credit" check below fires first otherwise), so
    // exercising the self-link guard specifically requires a type it's actually legal
    // to attempt a link from.
    const [acct] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Credit Card', accountType: 'credit' })
      .returning();

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({
        id: acct.id,
        name: 'Credit Card',
        accountType: 'credit',
        linkedBankAccountId: acct.id,
      }),
    );

    expect(result).toEqual({ error: 'An account cannot link to itself.' });

    await cleanup(member.household.id);
  });

  it('updates the opening balance', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update OB');
    const [acct] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Checking', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({ id: acct.id, name: 'Checking', accountType: 'bank', openingBalance: '1234.56' }),
    );
    expect(result).toEqual({ success: true });

    const [updated] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, acct.id));
    expect(updated.openingBalance).toBe('1234.56');

    await cleanup(member.household.id);
  });

  it('preserves an existing opening balance when the field is entirely absent from the submission (flag off, or accountType isn\'t "bank", hides the field)', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update OB2');
    const [acct] = await db
      .insert(bankAccounts)
      .values({
        householdId: member.household.id,
        name: 'Checking',
        accountType: 'bank',
        openingBalance: '10000.00',
      })
      .returning();

    mockToken = member.token;
    // Simulates account-row.tsx's edit form when showOpeningBalance is false, or the
    // account isn't (or is being switched away from) 'bank' — the openingBalance
    // <Input> is never rendered, so it's never in the FormData at all.
    const result = await updateAccountAction(
      undefined,
      formData({ id: acct.id, name: 'Everyday Checking', accountType: 'bank' }),
    );
    expect(result).toEqual({ success: true });

    const [updated] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, acct.id));
    expect(updated.name).toBe('Everyday Checking');
    expect(updated.openingBalance).toBe('10000.00');

    await cleanup(member.household.id);
  });

  it('rejects a nonzero opening balance when FEATURE_NET_WORTH is disabled (server-side, not just hidden UI)', async () => {
    vi.doMock('../../lib/env', () => ({ env: { FEATURE_NET_WORTH: false } }));
    vi.resetModules();
    const { createAccountAction, updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update OB3');

    mockToken = member.token;
    const createResult = await createAccountAction(
      undefined,
      formData({ name: 'Checking', accountType: 'bank', openingBalance: '500.00' }),
    );
    expect(createResult).toEqual({ error: 'Net worth tracking is not enabled.' });

    const [acct] = await db
      .insert(bankAccounts)
      .values({
        householdId: member.household.id,
        name: 'Checking',
        accountType: 'bank',
        openingBalance: '10000.00',
      })
      .returning();
    const updateResult = await updateAccountAction(
      undefined,
      formData({ id: acct.id, name: 'Checking', accountType: 'bank', openingBalance: '500.00' }),
    );
    expect(updateResult).toEqual({ error: 'Net worth tracking is not enabled.' });

    const [unchanged] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, acct.id));
    expect(unchanged.openingBalance).toBe('10000.00');

    await cleanup(member.household.id);
    vi.doUnmock('../../lib/env');
    vi.resetModules();
  });

  it('rejects setting a linkedBankAccountId while accountType is "bank"', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update E');
    const [bank1] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
      .returning();
    const [bank2] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank B', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({
        id: bank1.id,
        name: 'Test Bank A',
        accountType: 'bank',
        linkedBankAccountId: bank2.id,
      }),
    );

    expect(result).toEqual({ error: 'Only credit accounts can link to a bank account.' });

    await cleanup(member.household.id);
  });

  it('rejects changing an account\'s type away from "bank" while another account links to it', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update F');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
      .returning();
    await db.insert(bankAccounts).values({
      householdId: member.household.id,
      name: 'Credit Card',
      accountType: 'credit',
      linkedBankAccountId: bank.id,
    });

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({ id: bank.id, name: 'Test Bank A', accountType: 'credit' }),
    );

    expect(result).toEqual({
      error: 'Cannot change type: another account is linked to this one as its bank account.',
    });
    const [unchanged] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, bank.id));
    expect(unchanged.accountType).toBe('bank');

    await cleanup(member.household.id);
  });

  it('allows changing an account\'s type away from "bank" once nothing links to it', async () => {
    const { updateAccountAction } = await import('./accounts');
    const member = await makeHouseholdWithUser('member', 'Acct update G');
    const [bank] = await db
      .insert(bankAccounts)
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
      .returning();

    mockToken = member.token;
    const result = await updateAccountAction(
      undefined,
      formData({ id: bank.id, name: 'Test Bank A', accountType: 'credit' }),
    );

    expect(result).toEqual({ success: true });

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
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
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
      .values({ householdId: member.household.id, name: 'Test Bank A', accountType: 'bank' })
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

  it('cannot delete an account in a DIFFERENT household (cross-tenant probe)', async () => {
    const { deleteAccountAction } = await import('./accounts');
    const memberA = await makeHouseholdWithUser('member', 'Acct delete C-A');
    const memberB = await makeHouseholdWithUser('member', 'Acct delete C-B');
    const [acctInB] = await db
      .insert(bankAccounts)
      .values({ householdId: memberB.household.id, name: 'B Acct', accountType: 'bank' })
      .returning();

    mockToken = memberA.token;
    const result = await deleteAccountAction(undefined, formData({ id: acctInB.id }));

    expect(result).toEqual({ error: 'Account not found.' });
    const [stillThere] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, acctInB.id));
    expect(stillThere).toBeDefined();

    await cleanup(memberA.household.id, memberB.household.id);
  });
});
