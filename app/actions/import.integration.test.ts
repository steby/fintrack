import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import {
  households,
  users,
  sessions,
  categories,
  bankAccounts,
  monthlyEntries,
} from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';
import { setFlag } from '../../lib/flags';
import type { ColumnMapping } from '../../lib/domain/csv';

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

// Every fixture CSV in this file uses the header `Date,Item,Amount` — column
// positions 0/1/2 — since app/actions/import.ts's ColumnMapping is index-based, not
// name-based (lib/domain/csv.ts's ColumnMapping doc comment explains why: duplicate
// header names, and files with no header row at all, both need a mapping that
// doesn't depend on header text).
const DEFAULT_MAPPING: ColumnMapping = {
  date: '0',
  item: '1',
  amount: '2',
  direction: '',
  category: '',
  account: '',
};

function importFormData(
  csvText: string,
  mapping: ColumnMapping = DEFAULT_MAPPING,
  extra: Record<string, string> = {},
): FormData {
  const fd = new FormData();
  fd.set('csvText', csvText);
  fd.set('hasHeaderRow', 'true');
  fd.set('mappingDate', mapping.date);
  fd.set('mappingItem', mapping.item);
  fd.set('mappingAmount', mapping.amount);
  fd.set('mappingDirection', mapping.direction);
  fd.set('mappingCategory', mapping.category);
  fd.set('mappingAccount', mapping.account);
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
}

async function cleanup(...householdIds: string[]) {
  for (const id of householdIds) {
    await db.delete(households).where(eq(households.id, id));
  }
}

describe('previewImportAction', () => {
  it('rejects when csv_import is disabled (the default)', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview A');
    mockToken = member.token;

    const result = await previewImportAction(
      undefined,
      importFormData('Date,Item,Amount\n2026-01-05,Coffee,4.50\n'),
    );
    expect(result).toEqual({ error: 'CSV import is not enabled for this household.' });

    await cleanup(member.household.id);
  });

  it('rejects when a required column is unmapped', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview B');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const result = await previewImportAction(
      undefined,
      importFormData('Date,Item,Amount\n2026-01-05,Coffee,4.50\n', {
        ...DEFAULT_MAPPING,
        amount: '',
      }),
    );
    expect(result).toEqual({ error: expect.stringContaining('amount') });

    await cleanup(member.household.id);
  });

  it('classifies a row as "new" when nothing matches, and "match" against an unactualized forecast', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview C');
    await setFlag(member.household.id, 'csv_import', true);
    const [category] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Groceries', direction: 'expense' })
      .returning();
    await db.insert(monthlyEntries).values({
      householdId: member.household.id,
      year: 2026,
      month: 1,
      item: 'Groceries',
      categoryId: category.id,
      budgetedAmount: '100.00',
    });

    mockToken = member.token;
    // Negative amounts (no direction column mapped) infer 'expense', the common
    // bank-statement sign convention — matching the 'expense' category above.
    const csv = 'Date,Item,Amount\n2026-01-05,Groceries,-100.00\n2026-01-06,Car Repair,-75.00\n';
    const result = await previewImportAction(undefined, importFormData(csv));

    expect('rows' in result! && result.rows).toBeTruthy();
    const rows = (result as { rows: { status: string; item: string }[] }).rows;
    expect(rows.find((r) => r.item === 'Groceries')?.status).toBe('match');
    expect(rows.find((r) => r.item === 'Car Repair')?.status).toBe('new');

    await cleanup(member.household.id);
  });

  it('classifies an unparseable row as "error" without failing the whole file', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview D');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const csv = 'Date,Item,Amount\n2026-01-05,Coffee,4.50\nnot-a-date,Bad Row,10.00\n';
    const result = await previewImportAction(undefined, importFormData(csv));
    const rows = (result as { rows: { status: string; message?: string }[] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'error')).toHaveLength(1);

    await cleanup(member.household.id);
  });

  it('rejects a file that decodes with UTF-8 replacement characters (wrong encoding)', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview E2');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const csv = 'Date,Item,Amount\n2026-01-05,Caf�,4.50\n';
    const result = await previewImportAction(undefined, importFormData(csv));
    expect(result).toEqual({ error: expect.stringContaining('UTF-8') });

    await cleanup(member.household.id);
  });

  it('treats every row as data when hasHeaderRow is false (missing headers)', async () => {
    const { previewImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import preview F');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    // No header line at all — the very first row is a real transaction.
    const csv = '2026-01-05,Coffee,-4.50\n2026-01-06,Tea,-3.00\n';
    const result = await previewImportAction(
      undefined,
      importFormData(csv, DEFAULT_MAPPING, { hasHeaderRow: 'false' }),
    );
    const rows = (result as { rows: { item: string }[] }).rows;
    expect(rows.map((r) => r.item).sort()).toEqual(['Coffee', 'Tea']);

    await cleanup(member.household.id);
  });

  it('a viewer cannot preview an import (server-side role check)', async () => {
    const { previewImportAction } = await import('./import');
    const viewer = await makeHouseholdWithUser('viewer', 'Import preview G');
    await setFlag(viewer.household.id, 'csv_import', true);
    mockToken = viewer.token;

    await expect(
      previewImportAction(undefined, importFormData('Date,Item,Amount\n2026-01-05,Coffee,4.50\n')),
    ).rejects.toThrow();

    await cleanup(viewer.household.id);
  });
});

describe('commitImportAction', () => {
  it('reconciles a matched row (sets actualAmount/actualDate on the existing forecast)', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit A');
    await setFlag(member.household.id, 'csv_import', true);
    const [category] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Groceries', direction: 'expense' })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Groceries',
        categoryId: category.id,
        budgetedAmount: '100.00',
      })
      .returning();

    mockToken = member.token;
    const csv = 'Date,Item,Amount\n2026-01-05,Groceries,-100.00\n';
    const result = await commitImportAction(undefined, importFormData(csv));
    expect(result).toEqual({ success: true, applied: 1 });

    const [reloaded] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    expect(reloaded.actualAmount).toBe('100.00');
    expect(reloaded.actualDate).toBe('2026-01-05');

    await cleanup(member.household.id);
  });

  it('rejects when a required column is unmapped, rather than silently reporting 0 applied', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit A2');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const result = await commitImportAction(
      undefined,
      importFormData('Date,Item,Amount\n2026-01-05,Coffee,4.50\n', {
        ...DEFAULT_MAPPING,
        date: '',
      }),
    );
    expect(result).toEqual({ error: expect.stringContaining('date') });

    await cleanup(member.household.id);
  });

  it('two distinct rows that both plausibly match the same single forecast are correctly split into one match and one new entry, not two conflicting updates', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit A3');
    await setFlag(member.household.id, 'csv_import', true);
    const [category] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Restaurant', direction: 'expense' })
      .returning();
    const [entry] = await db
      .insert(monthlyEntries)
      .values({
        householdId: member.household.id,
        year: 2026,
        month: 1,
        item: 'Restaurant',
        categoryId: category.id,
        budgetedAmount: '50.00',
      })
      .returning();

    mockToken = member.token;
    // Two distinct real transactions, both plausibly close enough to the one
    // existing forecast to have matched it independently before the claiming fix.
    const csv = 'Date,Item,Amount\n2026-01-05,Restaurant,-50.00\n2026-01-12,Restaurant,-51.00\n';
    const result = await commitImportAction(undefined, importFormData(csv));
    expect(result).toEqual({ success: true, applied: 2 });

    const [reloadedForecast] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entry.id));
    // The forecast was reconciled to exactly one of the two transactions...
    expect(['50.00', '51.00']).toContain(reloadedForecast.actualAmount);

    // ...and the OTHER transaction was preserved as a genuinely new entry, not lost.
    const allRestaurantRows = await db
      .select()
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, member.household.id),
          eq(monthlyEntries.item, 'Restaurant'),
        ),
      );
    expect(allRestaurantRows).toHaveLength(2);
    const actualAmounts = allRestaurantRows.map((r) => r.actualAmount).sort();
    expect(actualAmounts).toEqual(['50.00', '51.00']);

    await cleanup(member.household.id);
  });

  it('creates a new ad-hoc entry for an unmatched row, resolving category/account by name', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit B');
    await setFlag(member.household.id, 'csv_import', true);
    await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Auto', direction: 'expense' });
    await db.insert(bankAccounts).values({ householdId: member.household.id, name: 'Checking' });

    mockToken = member.token;
    // Header: Date(0),Item(1),Amount(2),Category(3),Account(4)
    const mapping: ColumnMapping = { ...DEFAULT_MAPPING, category: '3', account: '4' };
    const fd = new FormData();
    fd.set(
      'csvText',
      'Date,Item,Amount,Category,Account\n2026-02-10,Car Repair,75.00,Auto,Checking\n',
    );
    fd.set('hasHeaderRow', 'true');
    fd.set('mappingDate', mapping.date);
    fd.set('mappingItem', mapping.item);
    fd.set('mappingAmount', mapping.amount);
    fd.set('mappingDirection', mapping.direction);
    fd.set('mappingCategory', mapping.category);
    fd.set('mappingAccount', mapping.account);

    const result = await commitImportAction(undefined, fd);
    expect(result).toEqual({ success: true, applied: 1 });

    const [created] = await db
      .select()
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, member.household.id),
          eq(monthlyEntries.item, 'Car Repair'),
        ),
      );
    expect(created).toMatchObject({
      budgetedAmount: '75.00',
      actualAmount: '75.00',
      actualDate: '2026-02-10',
    });
    expect(created.categoryId).not.toBeNull();
    expect(created.bankAccountId).not.toBeNull();

    await cleanup(member.household.id);
  });

  it('re-importing the identical file a second time applies nothing (idempotent)', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit C');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const csv = 'Date,Item,Amount\n2026-03-01,One-off Purchase,42.00\n';
    const first = await commitImportAction(undefined, importFormData(csv));
    expect(first).toEqual({ success: true, applied: 1 });

    const second = await commitImportAction(undefined, importFormData(csv));
    expect(second).toEqual({ success: true, applied: 0 });

    const rows = await db
      .select()
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, member.household.id),
          eq(monthlyEntries.item, 'One-off Purchase'),
        ),
      );
    expect(rows).toHaveLength(1); // not duplicated

    await cleanup(member.household.id);
  });

  it('skips a row listed in excludedRows', async () => {
    const { commitImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import commit D');
    await setFlag(member.household.id, 'csv_import', true);
    mockToken = member.token;

    const csv = 'Date,Item,Amount\n2026-04-01,Skip Me,10.00\n2026-04-02,Keep Me,20.00\n';
    const result = await commitImportAction(
      undefined,
      importFormData(csv, DEFAULT_MAPPING, { excludedRows: '1' }),
    );
    expect(result).toEqual({ success: true, applied: 1 });

    const skipped = await db
      .select()
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, member.household.id),
          eq(monthlyEntries.item, 'Skip Me'),
        ),
      );
    expect(skipped).toHaveLength(0);
    const kept = await db
      .select()
      .from(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, member.household.id),
          eq(monthlyEntries.item, 'Keep Me'),
        ),
      );
    expect(kept).toHaveLength(1);

    await cleanup(member.household.id);
  });

  it('never matches a forecast entry belonging to a different household (cross-tenant probe)', async () => {
    const { commitImportAction } = await import('./import');
    const memberA = await makeHouseholdWithUser('member', 'Import commit E-A');
    const memberB = await makeHouseholdWithUser('member', 'Import commit E-B');
    await setFlag(memberA.household.id, 'csv_import', true);
    const [categoryB] = await db
      .insert(categories)
      .values({ householdId: memberB.household.id, name: 'Groceries', direction: 'expense' })
      .returning();
    const [entryB] = await db
      .insert(monthlyEntries)
      .values({
        householdId: memberB.household.id,
        year: 2026,
        month: 5,
        item: 'Groceries',
        categoryId: categoryB.id,
        budgetedAmount: '100.00',
      })
      .returning();

    mockToken = memberA.token;
    const csv = 'Date,Item,Amount\n2026-05-05,Groceries,-100.00\n';
    const result = await commitImportAction(undefined, importFormData(csv));
    // No candidate in household A's own data -> created as new, never touching B's row.
    expect(result).toEqual({ success: true, applied: 1 });

    const [reloadedB] = await db
      .select()
      .from(monthlyEntries)
      .where(eq(monthlyEntries.id, entryB.id));
    expect(reloadedB.actualAmount).toBeNull();

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('a viewer cannot commit an import (server-side role check)', async () => {
    const { commitImportAction } = await import('./import');
    const viewer = await makeHouseholdWithUser('viewer', 'Import commit F');
    await setFlag(viewer.household.id, 'csv_import', true);
    mockToken = viewer.token;

    await expect(
      commitImportAction(undefined, importFormData('Date,Item,Amount\n2026-01-05,Coffee,4.50\n')),
    ).rejects.toThrow();

    await cleanup(viewer.household.id);
  });
});

describe('toggleCsvImportAction', () => {
  it('an owner can enable csv_import', async () => {
    const { toggleCsvImportAction } = await import('./import');
    const owner = await makeHouseholdWithUser('owner', 'Import toggle A');
    mockToken = owner.token;

    const fd = new FormData();
    fd.set('enabled', 'true');
    const result = await toggleCsvImportAction(undefined, fd);
    expect(result).toEqual({ success: true });

    const { isEnabled } = await import('../../lib/flags');
    expect(await isEnabled(owner.household.id, 'csv_import')).toBe(true);

    await cleanup(owner.household.id);
  });

  it('a member cannot toggle csv_import (owner-only)', async () => {
    const { toggleCsvImportAction } = await import('./import');
    const member = await makeHouseholdWithUser('member', 'Import toggle B');
    mockToken = member.token;

    const fd = new FormData();
    fd.set('enabled', 'true');
    await expect(toggleCsvImportAction(undefined, fd)).rejects.toThrow();

    await cleanup(member.household.id);
  });
});
