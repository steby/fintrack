import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './index';
import { households, categories, bankAccounts, monthlyEntries, recurringSchedule } from './schema';
import {
  getDashboardRows,
  getIncomeExpenseRows,
  getDashboardRowsForMonth,
  getAccountsForNetWorth,
  getAccountEntriesBeforeYear,
  getCurrentMonthExpenseCategories,
  getCurrentMonthCategoryBudgets,
  getExportRows,
  getMatchCandidates,
  getNameLookup,
  getUpcomingEntryCandidates,
  getActualizedCashRows,
} from './queries';

async function makeHousehold(label: string) {
  const [household] = await db.insert(households).values({ name: label }).returning();
  return household;
}

async function cleanup(householdId: string) {
  await db.delete(households).where(eq(households.id, householdId));
}

describe('getDashboardRows', () => {
  it('returns an empty array for a household/year with no entries', async () => {
    const household = await makeHousehold('Dashboard query A');
    try {
      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('joins category direction/name/color and bank account name, converting amounts to cents', async () => {
    const household = await makeHousehold('Dashboard query B');
    try {
      const [category] = await db
        .insert(categories)
        .values({
          householdId: household.id,
          name: 'Salary',
          direction: 'income',
          color: '#111111',
        })
        .returning();
      const [account] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 3,
        item: 'Salary',
        categoryId: category.id,
        bankAccountId: account.id,
        budgetedAmount: '5000.00',
        actualAmount: '5200.50',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        month: 3,
        budgetedCents: 500000,
        actualCents: 520050,
        direction: 'income',
        categoryName: 'Salary',
        categoryColor: '#111111',
        bankAccountName: 'Checking',
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('leaves actualCents null when no actual has been entered yet', async () => {
    const household = await makeHousehold('Dashboard query C');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        item: 'Forecast only',
        budgetedAmount: '100.00',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows[0]).toMatchObject({
        budgetedCents: 10000,
        actualCents: null,
        direction: null,
        categoryName: null,
        bankAccountName: null,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Dashboard query D-A');
    const householdB = await makeHousehold('Dashboard query D-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 1,
        item: 'Other household entry',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRows(householdA.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });

  it('scopes by year — entries from a different year are excluded', async () => {
    const household = await makeHousehold('Dashboard query E');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2025,
        month: 12,
        item: 'Last year',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });
});

describe('getIncomeExpenseRows', () => {
  it('returns an empty array for a household/year with no entries', async () => {
    const household = await makeHousehold('Income/expense query A');
    try {
      const rows = await getIncomeExpenseRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('returns direction (via the category join) and amounts in cents, without the columns getDashboardRows also fetches', async () => {
    const household = await makeHousehold('Income/expense query B');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Salary', direction: 'income' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 3,
        item: 'Salary',
        categoryId: category.id,
        budgetedAmount: '5000.00',
        actualAmount: '5200.50',
      });

      const rows = await getIncomeExpenseRows(household.id, 2026);
      expect(rows).toEqual([{ direction: 'income', budgetedCents: 500000, actualCents: 520050 }]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('leaves direction null for an uncategorized entry, same as getDashboardRows', async () => {
    const household = await makeHousehold('Income/expense query C');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        item: 'Uncategorized',
        budgetedAmount: '100.00',
      });

      const rows = await getIncomeExpenseRows(household.id, 2026);
      expect(rows).toEqual([{ direction: null, budgetedCents: 10000, actualCents: null }]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Income/expense query D-A');
    const householdB = await makeHousehold('Income/expense query D-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 1,
        item: 'Other household entry',
        budgetedAmount: '1.00',
      });

      const rows = await getIncomeExpenseRows(householdA.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });

  it('scopes by year — entries from a different year are excluded', async () => {
    const household = await makeHousehold('Income/expense query E');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2025,
        month: 12,
        item: 'Last year',
        budgetedAmount: '1.00',
      });

      const rows = await getIncomeExpenseRows(household.id, 2026);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });
});

describe('getDashboardRowsForMonth', () => {
  it('returns an empty array for a household/year/month with no entries', async () => {
    const household = await makeHousehold('Month-scoped dashboard query A');
    try {
      const rows = await getDashboardRowsForMonth(household.id, 2026, 3);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('returns month/direction/amounts/categoryId, matching getDashboardRows for the same rows', async () => {
    const household = await makeHousehold('Month-scoped dashboard query B');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Rent', direction: 'expense' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 3,
        item: 'Rent',
        categoryId: category.id,
        budgetedAmount: '2000.00',
        actualAmount: '2000.00',
      });

      const rows = await getDashboardRowsForMonth(household.id, 2026, 3);
      expect(rows).toEqual([
        {
          month: 3,
          direction: 'expense',
          budgetedCents: 200000,
          actualCents: 200000,
          categoryId: category.id,
        },
      ]);
    } finally {
      await cleanup(household.id);
    }
  });

  // categoryId is what app/(app)/page.tsx (Home) now feeds into
  // lib/domain/dashboard.ts's buildCategoryBudgetRows alongside these same rows, so an
  // uncategorized entry must come back with categoryId: null (not undefined, not the
  // row silently dropped) — buildCategoryBudgetRows relies on that exact null check to
  // exclude it from any category's spend sum.
  it('returns categoryId: null for an uncategorized entry', async () => {
    const household = await makeHousehold('Month-scoped dashboard query B2');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 3,
        item: 'Uncategorized',
        budgetedAmount: '75.00',
      });

      const rows = await getDashboardRowsForMonth(household.id, 2026, 3);
      expect(rows).toEqual([
        {
          month: 3,
          direction: null,
          budgetedCents: 7500,
          actualCents: null,
          categoryId: null,
        },
      ]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('excludes entries from a different month in the same year', async () => {
    const household = await makeHousehold('Month-scoped dashboard query C');
    try {
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 4,
        item: 'Different month',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRowsForMonth(household.id, 2026, 3);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Month-scoped dashboard query D-A');
    const householdB = await makeHousehold('Month-scoped dashboard query D-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 3,
        item: 'Other household entry',
        budgetedAmount: '1.00',
      });

      const rows = await getDashboardRowsForMonth(householdA.id, 2026, 3);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getAccountsForNetWorth', () => {
  it('converts opening balance to cents and preserves account type/link', async () => {
    const household = await makeHousehold('Net worth accounts A');
    try {
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking', openingBalance: '-150.25' })
        .returning();
      await db.insert(bankAccounts).values({
        householdId: household.id,
        name: 'Credit Card',
        accountType: 'credit',
        linkedBankAccountId: bank.id,
      });

      const accounts = await getAccountsForNetWorth(household.id);
      expect(accounts).toHaveLength(2);
      const bankRow = accounts.find((a) => a.id === bank.id)!;
      expect(bankRow).toMatchObject({ accountType: 'bank', openingBalanceCents: -15025 });
      const creditRow = accounts.find((a) => a.accountType === 'credit')!;
      expect(creditRow.linkedBankAccountId).toBe(bank.id);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Net worth accounts B-A');
    const householdB = await makeHousehold('Net worth accounts B-B');
    try {
      await db.insert(bankAccounts).values({ householdId: householdB.id, name: 'Other' });
      const accounts = await getAccountsForNetWorth(householdA.id);
      expect(accounts).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getAccountEntriesBeforeYear', () => {
  it('returns only entries from years strictly before the given year', async () => {
    const household = await makeHousehold('Prior years entries A');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Groceries', direction: 'expense' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2024,
          month: 6,
          item: 'Old expense',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '100.00',
          actualAmount: '100.00',
        },
        {
          householdId: household.id,
          year: 2025,
          month: 1,
          item: 'This year expense',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '50.00',
        },
      ]);

      const rows = await getAccountEntriesBeforeYear(household.id, 2025);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        bankAccountId: bank.id,
        direction: 'expense',
        amountCents: 10000,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('prefers actual over budgeted per entry, same as getDashboardRows', async () => {
    const household = await makeHousehold('Prior years entries B');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Salary', direction: 'income' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2024,
        month: 3,
        item: 'Pay',
        categoryId: category.id,
        bankAccountId: bank.id,
        budgetedAmount: '5000.00',
        actualAmount: '5200.00',
      });

      const rows = await getAccountEntriesBeforeYear(household.id, 2025);
      expect(rows[0].amountCents).toBe(520000);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Prior years entries C-A');
    const householdB = await makeHousehold('Prior years entries C-B');
    try {
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: householdB.id, name: 'Other' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2024,
        month: 1,
        item: 'Other',
        bankAccountId: bank.id,
        budgetedAmount: '10.00',
      });
      const rows = await getAccountEntriesBeforeYear(householdA.id, 2025);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });

  it('sums multiple entries across different years/months for the same account+direction into one row (SQL aggregate correctness)', async () => {
    const household = await makeHousehold('Prior years entries D');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Groceries', direction: 'expense' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2023,
          month: 6,
          item: 'Old A',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '100.00',
          actualAmount: '100.00',
        },
        {
          householdId: household.id,
          year: 2024,
          month: 3,
          item: 'Old B',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '50.00', // no actual — falls back to budgeted
        },
        {
          householdId: household.id,
          year: 2024,
          month: 9,
          item: 'Old C',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '20.00',
          actualAmount: '25.50',
        },
      ]);

      const rows = await getAccountEntriesBeforeYear(household.id, 2025);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        bankAccountId: bank.id,
        direction: 'expense',
        amountCents: 10000 + 5000 + 2550, // 100.00 + 50.00 + 25.50
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('keeps different accounts and different directions in separate groups, not merged together', async () => {
    const household = await makeHousehold('Prior years entries E');
    try {
      const [expenseCategory, incomeCategory] = await db
        .insert(categories)
        .values([
          { householdId: household.id, name: 'Groceries', direction: 'expense' },
          { householdId: household.id, name: 'Salary', direction: 'income' },
        ])
        .returning();
      const [bankA, bankB] = await db
        .insert(bankAccounts)
        .values([
          { householdId: household.id, name: 'Checking' },
          { householdId: household.id, name: 'Savings' },
        ])
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2024,
          month: 1,
          item: 'Groceries A',
          categoryId: expenseCategory.id,
          bankAccountId: bankA.id,
          budgetedAmount: '30.00',
          actualAmount: '30.00',
        },
        {
          householdId: household.id,
          year: 2024,
          month: 2,
          item: 'Pay',
          categoryId: incomeCategory.id,
          bankAccountId: bankA.id,
          budgetedAmount: '1000.00',
          actualAmount: '1000.00',
        },
        {
          householdId: household.id,
          year: 2024,
          month: 3,
          item: 'Groceries B',
          categoryId: expenseCategory.id,
          bankAccountId: bankB.id,
          budgetedAmount: '15.00',
          actualAmount: '15.00',
        },
      ]);

      const rows = await getAccountEntriesBeforeYear(household.id, 2025);
      expect(rows).toHaveLength(3);
      expect(rows).toContainEqual({
        bankAccountId: bankA.id,
        direction: 'expense',
        amountCents: 3000,
      });
      expect(rows).toContainEqual({
        bankAccountId: bankA.id,
        direction: 'income',
        amountCents: 100000,
      });
      expect(rows).toContainEqual({
        bankAccountId: bankB.id,
        direction: 'expense',
        amountCents: 1500,
      });
    } finally {
      await cleanup(household.id);
    }
  });
});

describe('getCurrentMonthExpenseCategories', () => {
  it('returns expense categories only, converting monthlyBudget to cents (null stays null)', async () => {
    const household = await makeHousehold('Expense categories A');
    try {
      await db.insert(categories).values([
        {
          householdId: household.id,
          name: 'Groceries',
          direction: 'expense',
          monthlyBudget: '400.00',
        },
        { householdId: household.id, name: 'No cap', direction: 'expense' },
        {
          householdId: household.id,
          name: 'Salary',
          direction: 'income',
          monthlyBudget: '5000.00',
        },
      ]);

      const rows = await getCurrentMonthExpenseCategories(household.id);
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual(
        expect.objectContaining({ name: 'Groceries', monthlyBudgetCents: 40000 }),
      );
      expect(rows).toContainEqual(
        expect.objectContaining({ name: 'No cap', monthlyBudgetCents: null }),
      );
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns categories from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Expense categories B-A');
    const householdB = await makeHousehold('Expense categories B-B');
    try {
      await db.insert(categories).values({
        householdId: householdB.id,
        name: 'Other',
        direction: 'expense',
        monthlyBudget: '100.00',
      });
      const rows = await getCurrentMonthExpenseCategories(householdA.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getCurrentMonthCategoryBudgets', () => {
  it('only returns expense categories with a monthly budget cap set', async () => {
    const household = await makeHousehold('Budget rows A');
    try {
      await db.insert(categories).values([
        {
          householdId: household.id,
          name: 'Groceries',
          direction: 'expense',
          monthlyBudget: '400.00',
        },
        { householdId: household.id, name: 'No cap', direction: 'expense' },
        {
          householdId: household.id,
          name: 'Salary',
          direction: 'income',
          monthlyBudget: '5000.00',
        },
      ]);

      const rows = await getCurrentMonthCategoryBudgets(household.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Groceries',
        monthlyBudgetCents: 40000,
        spentCents: 0,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('sums current-month spend, preferring actual over budgeted per entry', async () => {
    const household = await makeHousehold('Budget rows B');
    try {
      const [category] = await db
        .insert(categories)
        .values({
          householdId: household.id,
          name: 'Groceries',
          direction: 'expense',
          monthlyBudget: '400.00',
        })
        .returning();
      const now = new Date();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Actualized',
          categoryId: category.id,
          budgetedAmount: '100.00',
          actualAmount: '120.00',
        },
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Forecast only',
          categoryId: category.id,
          budgetedAmount: '50.00',
        },
      ]);

      const rows = await getCurrentMonthCategoryBudgets(household.id);
      expect(rows[0].spentCents).toBe(17000); // 120.00 (actual) + 50.00 (budgeted fallback)
    } finally {
      await cleanup(household.id);
    }
  });

  // Proves the getCurrentMonthExpenseCategories + buildCategoryBudgetRows split produces
  // the exact same output the old single-function inline aggregation did — two capped
  // categories, one uncapped, mixed actual/budgeted entries per category, and one
  // uncategorized entry (categoryId: null) that must be silently excluded rather than
  // crashing or landing in either category's sum. Hand-computed expected totals:
  // Groceries = 45.00 (actual) + 30.00 (budgeted fallback) = 7500 cents; Rent = 1500.00
  // (actual) = 150000 cents; "No cap" is excluded entirely (monthlyBudget unset); the
  // uncategorized $9.99 entry contributes to neither.
  it('hand-verified multi-category, mixed-actual/budgeted, null-categoryId fixture matches by-hand totals', async () => {
    const household = await makeHousehold('Budget rows D');
    try {
      const [groceries, rent] = await db
        .insert(categories)
        .values([
          {
            householdId: household.id,
            name: 'Groceries',
            direction: 'expense',
            monthlyBudget: '400.00',
          },
          {
            householdId: household.id,
            name: 'Rent',
            direction: 'expense',
            monthlyBudget: '1500.00',
          },
          { householdId: household.id, name: 'No cap', direction: 'expense' },
        ])
        .returning();
      const now = new Date();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Groceries actualized',
          categoryId: groceries.id,
          budgetedAmount: '50.00',
          actualAmount: '45.00',
        },
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Groceries forecast',
          categoryId: groceries.id,
          budgetedAmount: '30.00',
        },
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Rent actualized',
          categoryId: rent.id,
          budgetedAmount: '1500.00',
          actualAmount: '1500.00',
        },
        {
          householdId: household.id,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          item: 'Uncategorized',
          budgetedAmount: '9.99',
        },
      ]);

      const rows = await getCurrentMonthCategoryBudgets(household.id);
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual(
        expect.objectContaining({
          name: 'Groceries',
          monthlyBudgetCents: 40000,
          spentCents: 7500,
        }),
      );
      expect(rows).toContainEqual(
        expect.objectContaining({ name: 'Rent', monthlyBudgetCents: 150000, spentCents: 150000 }),
      );
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Budget rows C-A');
    const householdB = await makeHousehold('Budget rows C-B');
    try {
      await db.insert(categories).values({
        householdId: householdB.id,
        name: 'Other',
        direction: 'expense',
        monthlyBudget: '100.00',
      });
      const rows = await getCurrentMonthCategoryBudgets(householdA.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getExportRows', () => {
  it('returns entries across every year, joined with category/account names and scheduled day', async () => {
    const household = await makeHousehold('Export rows A');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Rent', direction: 'expense' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      const [schedule] = await db
        .insert(recurringSchedule)
        .values({
          householdId: household.id,
          item: 'Rent',
          categoryId: category.id,
          bankAccountId: bank.id,
          frequency: 'Monthly',
          actualDateDay: 1,
        })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2024,
          month: 1,
          recurringScheduleId: schedule.id,
          item: 'Rent',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '2000.00',
          actualAmount: '2000.00',
          actualDate: '2024-01-01',
        },
        {
          householdId: household.id,
          year: 2025,
          month: 6,
          item: 'Car Repair',
          budgetedAmount: '150.00',
        },
      ]);

      const rows = await getExportRows(household.id);
      expect(rows).toHaveLength(2);
      const rentRow = rows.find((r) => r.item === 'Rent')!;
      expect(rentRow).toMatchObject({
        year: 2024,
        month: 1,
        scheduledDay: 1,
        categoryName: 'Rent',
        direction: 'expense',
        budgetedAmount: '2000.00',
        actualAmount: '2000.00',
        actualDate: '2024-01-01',
        accountName: 'Checking',
      });
      const adhocRow = rows.find((r) => r.item === 'Car Repair')!;
      expect(adhocRow).toMatchObject({
        scheduledDay: null,
        categoryName: null,
        direction: null,
        actualAmount: null,
        actualDate: null,
        accountName: null,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Export rows B-A');
    const householdB = await makeHousehold('Export rows B-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2025,
        month: 1,
        item: 'Other',
        budgetedAmount: '10.00',
      });
      const rows = await getExportRows(householdA.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getMatchCandidates', () => {
  it('returns entries scoped to exactly one household/year/month, with parsed cents', async () => {
    const household = await makeHousehold('Match candidates A');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Groceries', direction: 'expense' })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2026,
          month: 1,
          item: 'Groceries',
          categoryId: category.id,
          budgetedAmount: '400.00',
        },
        {
          // Different month — must not be returned.
          householdId: household.id,
          year: 2026,
          month: 2,
          item: 'Groceries',
          categoryId: category.id,
          budgetedAmount: '400.00',
        },
      ]);

      const rows = await getMatchCandidates(household.id, 2026, 1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        item: 'Groceries',
        direction: 'expense',
        budgetedCents: 40000,
        actualCents: null,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Match candidates B-A');
    const householdB = await makeHousehold('Match candidates B-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 1,
        item: 'Other',
        budgetedAmount: '10.00',
      });
      const rows = await getMatchCandidates(householdA.id, 2026, 1);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getNameLookup', () => {
  it('maps category/account names to ids, case-insensitively', async () => {
    const household = await makeHousehold('Name lookup A');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Groceries', direction: 'expense' })
        .returning();
      const [account] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();

      const lookup = await getNameLookup(household.id);
      expect(lookup.categoryIdByName.get('groceries')).toBe(category.id);
      expect(lookup.accountIdByName.get('checking')).toBe(account.id);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns names from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Name lookup B-A');
    const householdB = await makeHousehold('Name lookup B-B');
    try {
      await db.insert(categories).values({
        householdId: householdB.id,
        name: 'Other',
        direction: 'expense',
      });
      const lookup = await getNameLookup(householdA.id);
      expect(lookup.categoryIdByName.size).toBe(0);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getUpcomingEntryCandidates', () => {
  it('returns an empty array for an empty bucket list, without querying the DB', async () => {
    expect(await getUpcomingEntryCandidates('does-not-matter', [])).toEqual([]);
  });

  it('includes an ad-hoc entry (no recurring_schedule_id) with actualDateDay null', async () => {
    const household = await makeHousehold('Upcoming candidates A');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Misc', direction: 'expense' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 7,
        item: 'Car repair',
        categoryId: category.id,
        budgetedAmount: '150.00',
      });

      const rows = await getUpcomingEntryCandidates(household.id, [{ year: 2026, month: 7 }]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        item: 'Car repair',
        actualDateDay: null,
        direction: 'expense',
        categoryName: 'Misc',
        budgetedAmount: '150.00',
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('includes a recurring-generated entry with its schedule actualDateDay and category direction/color', async () => {
    const household = await makeHousehold('Upcoming candidates B');
    try {
      const [category] = await db
        .insert(categories)
        .values({
          householdId: household.id,
          name: 'Housing',
          direction: 'expense',
          color: '#abcdef',
        })
        .returning();
      const [schedule] = await db
        .insert(recurringSchedule)
        .values({
          householdId: household.id,
          item: 'Rent',
          categoryId: category.id,
          budgetedAmount: '2000.00',
          frequency: 'Monthly',
          actualDateDay: 1,
        })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 7,
        recurringScheduleId: schedule.id,
        item: 'Rent',
        categoryId: category.id,
        budgetedAmount: '2000.00',
      });

      const rows = await getUpcomingEntryCandidates(household.id, [{ year: 2026, month: 7 }]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        item: 'Rent',
        actualDateDay: 1,
        direction: 'expense',
        categoryColor: '#abcdef',
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('spans multiple (year, month) buckets in one call', async () => {
    const household = await makeHousehold('Upcoming candidates C');
    try {
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2026,
          month: 12,
          item: 'Dec item',
          budgetedAmount: '10.00',
        },
        {
          householdId: household.id,
          year: 2027,
          month: 1,
          item: 'Jan item',
          budgetedAmount: '20.00',
        },
      ]);

      const rows = await getUpcomingEntryCandidates(household.id, [
        { year: 2026, month: 12 },
        { year: 2027, month: 1 },
      ]);
      expect(rows.map((r) => r.item).sort()).toEqual(['Dec item', 'Jan item']);
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Upcoming candidates D-A');
    const householdB = await makeHousehold('Upcoming candidates D-B');
    try {
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 7,
        item: 'Other household item',
        budgetedAmount: '10.00',
      });
      const rows = await getUpcomingEntryCandidates(householdA.id, [{ year: 2026, month: 7 }]);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});

describe('getActualizedCashRows', () => {
  it('returns an empty array when nothing has been actualized', async () => {
    const household = await makeHousehold('Actualized cash A');
    try {
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: household.id,
        year: 2026,
        month: 1,
        item: 'Forecast only',
        bankAccountId: bank.id,
        budgetedAmount: '100.00',
      });

      const rows = await getActualizedCashRows(household.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(household.id);
    }
  });

  it('sums only actualized entries, ignoring an unpaid forecast row entirely', async () => {
    const household = await makeHousehold('Actualized cash B');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Groceries', direction: 'expense' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2026,
          month: 1,
          item: 'Paid grocery run',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '50.00',
          actualAmount: '48.50',
        },
        {
          householdId: household.id,
          year: 2026,
          month: 2,
          item: 'Unpaid forecast',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '999.00', // must NOT be counted — no actualAmount
        },
      ]);

      const rows = await getActualizedCashRows(household.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        bankAccountId: bank.id,
        direction: 'expense',
        amountCents: 4850,
      });
    } finally {
      await cleanup(household.id);
    }
  });

  it('spans every year (no year bound), unlike getAccountEntriesBeforeYear', async () => {
    const household = await makeHousehold('Actualized cash C');
    try {
      const [category] = await db
        .insert(categories)
        .values({ householdId: household.id, name: 'Salary', direction: 'income' })
        .returning();
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: household.id, name: 'Checking' })
        .returning();
      await db.insert(monthlyEntries).values([
        {
          householdId: household.id,
          year: 2020,
          month: 1,
          item: 'Old pay',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '1000.00',
          actualAmount: '1000.00',
        },
        {
          householdId: household.id,
          year: 2030,
          month: 1,
          item: 'Far-future pay',
          categoryId: category.id,
          bankAccountId: bank.id,
          budgetedAmount: '1000.00',
          actualAmount: '1000.00',
        },
      ]);

      const rows = await getActualizedCashRows(household.id);
      expect(rows[0]).toMatchObject({ amountCents: 200000 });
    } finally {
      await cleanup(household.id);
    }
  });

  it('never returns rows from a different household (household scoping)', async () => {
    const householdA = await makeHousehold('Actualized cash D-A');
    const householdB = await makeHousehold('Actualized cash D-B');
    try {
      const [bank] = await db
        .insert(bankAccounts)
        .values({ householdId: householdB.id, name: 'Other' })
        .returning();
      await db.insert(monthlyEntries).values({
        householdId: householdB.id,
        year: 2026,
        month: 1,
        item: 'Other',
        bankAccountId: bank.id,
        budgetedAmount: '10.00',
        actualAmount: '10.00',
      });
      const rows = await getActualizedCashRows(householdA.id);
      expect(rows).toEqual([]);
    } finally {
      await cleanup(householdA.id);
      await cleanup(householdB.id);
    }
  });
});
