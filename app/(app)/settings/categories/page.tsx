import { eq } from 'drizzle-orm';
import { requireUser } from '../../../../lib/auth/guards';
import { can } from '../../../../lib/auth/rbac';
import { db } from '../../../../lib/db';
import { categories, bankAccounts } from '../../../../lib/db/schema';
import { env } from '../../../../lib/env';
import { getCurrentMonthCategoryBudgets } from '../../../../lib/db/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryRow } from './category-row';
import { CategoryAddForm } from './category-add-form';
import { AccountRow } from './account-row';
import { AccountAddForm } from './account-add-form';

export default async function CategoriesPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'write');
  const showBudget = env.FEATURE_CATEGORY_BUDGETS;

  const [allCategories, allAccounts, budgetRows] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.householdId, user.householdId))
      .orderBy(categories.direction, categories.sortOrder),
    db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, user.householdId))
      .orderBy(bankAccounts.sortOrder),
    showBudget ? getCurrentMonthCategoryBudgets(user.householdId) : Promise.resolve([]),
  ]);
  const spentByCategory = new Map(budgetRows.map((b) => [b.categoryId, b.spentCents]));

  const incomeCategories = allCategories.filter((c) => c.direction === 'income');
  const expenseCategories = allCategories.filter((c) => c.direction === 'expense');
  const bankOnlyAccounts = allAccounts
    .filter((a) => a.accountType === 'bank')
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Categories &amp; accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Used across recurring items and monthly entries. Deleting one clears the reference on
          anything that used it — nothing else is deleted.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                Income
              </h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {incomeCategories.length === 0 && (
                  <p className="text-xs text-muted-foreground">No income categories yet.</p>
                )}
                {incomeCategories.map((c) => (
                  <CategoryRow key={c.id} category={c} canManage={canManage} showBudget={false} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">
                Expense
              </h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {expenseCategories.length === 0 && (
                  <p className="text-xs text-muted-foreground">No expense categories yet.</p>
                )}
                {expenseCategories.map((c) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    canManage={canManage}
                    showBudget={showBudget}
                    currentMonthSpentCents={spentByCategory.get(c.id)}
                  />
                ))}
              </div>
            </div>
            {canManage && <CategoryAddForm showBudget={showBudget} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank accounts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              {allAccounts.length === 0 && (
                <p className="text-xs text-muted-foreground">No accounts yet.</p>
              )}
              {allAccounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  bankOnlyAccounts={bankOnlyAccounts}
                  canManage={canManage}
                  showOpeningBalance={env.FEATURE_NET_WORTH}
                />
              ))}
            </div>
            {canManage && (
              <AccountAddForm
                bankOnlyAccounts={bankOnlyAccounts}
                showOpeningBalance={env.FEATURE_NET_WORTH}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
