import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { categories, recurringSchedule } from '../../lib/db/schema';
import { makeHouseholdWithUser, formData, cleanup } from './test-helpers';

// Same mocking strategy as app/actions/members.integration.test.ts.
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

describe('createCategoryAction', () => {
  it('a member can create a category', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create A');
    mockToken = member.token;

    const result = await createCategoryAction(
      undefined,
      formData({ name: 'Groceries', direction: 'expense', color: '#FF0000' }),
    );

    expect(result).toEqual({ success: true });
    const rows = await db
      .select()
      .from(categories)
      .where(eq(categories.householdId, member.household.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Groceries', direction: 'expense', color: '#FF0000' });

    await cleanup(member.household.id);
  });

  it('a viewer cannot create a category', async () => {
    const { createCategoryAction } = await import('./categories');
    const viewer = await makeHouseholdWithUser('viewer', 'Cat create B');
    mockToken = viewer.token;

    await expect(
      createCategoryAction(undefined, formData({ name: 'Groceries', direction: 'expense' })),
    ).rejects.toThrow('You do not have permission to perform this action.');

    await cleanup(viewer.household.id);
  });

  it('rejects a malformed color (trust boundary)', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create C');
    mockToken = member.token;

    const result = await createCategoryAction(
      undefined,
      formData({ name: 'Groceries', direction: 'expense', color: 'not-a-color' }),
    );
    expect(result).toEqual({ error: 'Color must be a hex value like #6B7280' });

    await cleanup(member.household.id);
  });

  it('rejects a blank name', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create D');
    mockToken = member.token;

    const result = await createCategoryAction(
      undefined,
      formData({ name: '   ', direction: 'expense' }),
    );
    expect(result).toEqual({ error: 'Category name is required' });

    await cleanup(member.household.id);
  });

  it('creates a category with an explicit monthly budget cap', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create E');
    mockToken = member.token;

    const result = await createCategoryAction(
      undefined,
      formData({ name: 'Groceries', direction: 'expense', monthlyBudget: '400.00' }),
    );
    expect(result).toEqual({ success: true });

    const [row] = await db
      .select()
      .from(categories)
      .where(eq(categories.householdId, member.household.id));
    expect(row.monthlyBudget).toBe('400.00');

    await cleanup(member.household.id);
  });

  it('leaves monthlyBudget null (unset) when omitted — distinct from an explicit 0', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create F');
    mockToken = member.token;

    await createCategoryAction(undefined, formData({ name: 'Fun', direction: 'expense' }));
    const [row] = await db
      .select()
      .from(categories)
      .where(eq(categories.householdId, member.household.id));
    expect(row.monthlyBudget).toBeNull();

    await cleanup(member.household.id);
  });

  it('rejects a negative monthly budget', async () => {
    const { createCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat create G');
    mockToken = member.token;

    const result = await createCategoryAction(
      undefined,
      formData({ name: 'Groceries', direction: 'expense', monthlyBudget: '-50.00' }),
    );
    expect(result?.error).toBeTruthy();

    await cleanup(member.household.id);
  });
});

describe('updateCategoryAction', () => {
  it('updates a category within the acting household', async () => {
    const { updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update A');
    const [cat] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Old', direction: 'expense' })
      .returning();

    mockToken = member.token;
    const result = await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'New', direction: 'income', color: '#00FF00' }),
    );

    expect(result).toEqual({ success: true });
    const [updated] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(updated).toMatchObject({ name: 'New', direction: 'income', color: '#00FF00' });

    await cleanup(member.household.id);
  });

  it('cannot update a category in a DIFFERENT household (cross-tenant probe)', async () => {
    const { updateCategoryAction } = await import('./categories');
    const memberA = await makeHouseholdWithUser('member', 'Cat update B-A');
    const memberB = await makeHouseholdWithUser('member', 'Cat update B-B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: memberB.household.id, name: 'B Cat', direction: 'expense' })
      .returning();

    mockToken = memberA.token;
    const result = await updateCategoryAction(
      undefined,
      formData({ id: catInB.id, name: 'Hijacked', direction: 'expense' }),
    );

    expect(result).toEqual({ error: 'Category not found.' });
    const [unchanged] = await db.select().from(categories).where(eq(categories.id, catInB.id));
    expect(unchanged.name).toBe('B Cat');

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('sets an explicit zero cap distinctly from clearing it back to null', async () => {
    const { updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update C');
    const [cat] = await db
      .insert(categories)
      .values({
        householdId: member.household.id,
        name: 'Misc',
        direction: 'expense',
        monthlyBudget: '100.00',
      })
      .returning();

    mockToken = member.token;
    await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'Misc', direction: 'expense', monthlyBudget: '0.00' }),
    );
    const [zeroCapped] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(zeroCapped.monthlyBudget).toBe('0.00');

    // A genuinely-cleared field is PRESENT in the submission with an empty value (the
    // real shape a rendered-but-emptied <input> produces) — distinct from the field
    // being entirely absent, which the next test covers.
    await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'Misc', direction: 'expense', monthlyBudget: '' }),
    );
    const [cleared] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(cleared.monthlyBudget).toBeNull();

    await cleanup(member.household.id);
  });

  it('preserves an existing cap when monthlyBudget is entirely absent from the submission (flag off, or an income category, hides the field)', async () => {
    const { updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update C2');
    const [cat] = await db
      .insert(categories)
      .values({
        householdId: member.household.id,
        name: 'Groceries',
        direction: 'expense',
        monthlyBudget: '400.00',
      })
      .returning();

    mockToken = member.token;
    // Simulates category-row.tsx's edit form when showBudget is false (flag off) —
    // the monthlyBudget <Input> is never rendered, so it's never in the FormData at all.
    const result = await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'Food', direction: 'expense' }),
    );
    expect(result).toEqual({ success: true });

    const [updated] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(updated.name).toBe('Food');
    expect(updated.monthlyBudget).toBe('400.00');

    await cleanup(member.household.id);
  });

  it('rejects a budget cap on an income category', async () => {
    const { createCategoryAction, updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update C3');
    mockToken = member.token;

    const createResult = await createCategoryAction(
      undefined,
      formData({ name: 'Salary', direction: 'income', monthlyBudget: '5000.00' }),
    );
    expect(createResult).toEqual({ error: 'Only expense categories can have a budget cap.' });

    const [cat] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Salary', direction: 'income' })
      .returning();
    const updateResult = await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'Salary', direction: 'income', monthlyBudget: '5000.00' }),
    );
    expect(updateResult).toEqual({ error: 'Only expense categories can have a budget cap.' });

    await cleanup(member.household.id);
  });

  it('rejects setting a budget when FEATURE_CATEGORY_BUDGETS is disabled (server-side, not just hidden UI)', async () => {
    vi.doMock('../../lib/env', () => ({ env: { FEATURE_CATEGORY_BUDGETS: false } }));
    vi.resetModules();
    const { updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update D');
    const [cat] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Misc', direction: 'expense' })
      .returning();

    mockToken = member.token;
    const result = await updateCategoryAction(
      undefined,
      formData({ id: cat.id, name: 'Misc', direction: 'expense', monthlyBudget: '50.00' }),
    );
    expect(result).toEqual({ error: 'Category budgets are not enabled.' });

    const [unchanged] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(unchanged.monthlyBudget).toBeNull();

    await cleanup(member.household.id);
    vi.doUnmock('../../lib/env');
    vi.resetModules();
  });
});

describe('deleteCategoryAction', () => {
  it('deletes a category and nullifies references via ON DELETE SET NULL', async () => {
    const { deleteCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat delete A');
    const [cat] = await db
      .insert(categories)
      .values({ householdId: member.household.id, name: 'Rent', direction: 'expense' })
      .returning();
    const [item] = await db
      .insert(recurringSchedule)
      .values({
        householdId: member.household.id,
        item: 'Mortgage',
        categoryId: cat.id,
        frequency: 'Monthly',
      })
      .returning();

    mockToken = member.token;
    const result = await deleteCategoryAction(undefined, formData({ id: cat.id }));

    expect(result).toEqual({ success: true });
    const [deleted] = await db.select().from(categories).where(eq(categories.id, cat.id));
    expect(deleted).toBeUndefined();
    const [reloadedItem] = await db
      .select()
      .from(recurringSchedule)
      .where(eq(recurringSchedule.id, item.id));
    expect(reloadedItem.categoryId).toBeNull();

    await cleanup(member.household.id);
  });

  it('cannot delete a category in a DIFFERENT household (cross-tenant probe)', async () => {
    const { deleteCategoryAction } = await import('./categories');
    const memberA = await makeHouseholdWithUser('member', 'Cat delete B-A');
    const memberB = await makeHouseholdWithUser('member', 'Cat delete B-B');
    const [catInB] = await db
      .insert(categories)
      .values({ householdId: memberB.household.id, name: 'B Cat', direction: 'expense' })
      .returning();

    mockToken = memberA.token;
    const result = await deleteCategoryAction(undefined, formData({ id: catInB.id }));

    expect(result).toEqual({ error: 'Category not found.' });
    const [stillThere] = await db.select().from(categories).where(eq(categories.id, catInB.id));
    expect(stillThere).toBeDefined();

    await cleanup(memberA.household.id, memberB.household.id);
  });

  it('refuses to delete the reserved Uncategorized category, even by direct form post (adversarial)', async () => {
    const { deleteCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat delete system');
    const [systemCat] = await db
      .insert(categories)
      .values({
        householdId: member.household.id,
        name: 'Uncategorized',
        direction: 'expense',
        isSystem: true,
      })
      .returning();

    mockToken = member.token;
    const result = await deleteCategoryAction(undefined, formData({ id: systemCat.id }));

    expect(result).toEqual({ error: 'The built-in Uncategorized category can’t be deleted.' });
    const [stillThere] = await db.select().from(categories).where(eq(categories.id, systemCat.id));
    expect(stillThere).toBeDefined();

    await cleanup(member.household.id);
  });

  it('refuses to flip the reserved Uncategorized category to income; rename stays allowed (adversarial)', async () => {
    const { updateCategoryAction } = await import('./categories');
    const member = await makeHouseholdWithUser('member', 'Cat update system');
    const [systemCat] = await db
      .insert(categories)
      .values({
        householdId: member.household.id,
        name: 'Uncategorized',
        direction: 'expense',
        isSystem: true,
      })
      .returning();

    mockToken = member.token;
    const result = await updateCategoryAction(
      undefined,
      formData({ id: systemCat.id, name: 'Uncategorized', direction: 'income' }),
    );

    expect(result).toEqual({
      error: 'The built-in Uncategorized category must stay an expense category.',
    });
    const [reloaded] = await db.select().from(categories).where(eq(categories.id, systemCat.id));
    expect(reloaded.direction).toBe('expense');

    // Rename/color stay allowed on the system row — only direction is pinned.
    mockToken = member.token;
    const rename = await updateCategoryAction(
      undefined,
      formData({ id: systemCat.id, name: 'Misc', direction: 'expense' }),
    );
    expect(rename).toEqual({ success: true });

    await cleanup(member.household.id);
  });
});
