import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../lib/db';
import { households, users, sessions, categories, recurringSchedule } from '../../lib/db/schema';
import { generateToken } from '../../lib/auth/token';
import { newExpiry } from '../../lib/auth/session-rules';

// Same mocking strategy as app/actions/members.integration.test.ts.
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
});
