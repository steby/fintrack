import { eq } from 'drizzle-orm';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { db } from '../../../lib/db';
import { recurringSchedule, categories, bankAccounts } from '../../../lib/db/schema';
import { RecurringRow, type RecurringItem } from './recurring-row';
import { RecurringAddForm } from './recurring-add-form';
import { GenerateForm } from './generate-form';

export default async function RecurringPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'write');

  const [items, allCategories, allAccounts] = await Promise.all([
    db
      .select({
        id: recurringSchedule.id,
        item: recurringSchedule.item,
        categoryId: recurringSchedule.categoryId,
        budgetedAmount: recurringSchedule.budgetedAmount,
        bankAccountId: recurringSchedule.bankAccountId,
        frequency: recurringSchedule.frequency,
        scheduleMonths: recurringSchedule.scheduleMonths,
        actualDateDay: recurringSchedule.actualDateDay,
        isActive: recurringSchedule.isActive,
        categoryName: categories.name,
        categoryColor: categories.color,
        accountName: bankAccounts.name,
      })
      .from(recurringSchedule)
      .leftJoin(categories, eq(recurringSchedule.categoryId, categories.id))
      .leftJoin(bankAccounts, eq(recurringSchedule.bankAccountId, bankAccounts.id))
      .where(eq(recurringSchedule.householdId, user.householdId))
      .orderBy(recurringSchedule.item),
    db
      .select({ id: categories.id, name: categories.name, direction: categories.direction })
      .from(categories)
      .where(eq(categories.householdId, user.householdId))
      .orderBy(categories.direction, categories.sortOrder),
    db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.householdId, user.householdId))
      .orderBy(bankAccounts.sortOrder),
  ]);

  const groups: { label: string; items: RecurringItem[]; showMonths: boolean }[] = [
    { label: 'Monthly', items: items.filter((i) => i.frequency === 'Monthly'), showMonths: false },
    {
      label: 'Quarterly',
      items: items.filter((i) => i.frequency === 'Quarterly'),
      showMonths: true,
    },
    { label: 'Yearly', items: items.filter((i) => i.frequency === 'Yearly'), showMonths: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Recurring schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your master plan — every expected inflow and outflow. Generate a forecast to materialize
            these into actual months.
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <GenerateForm />
            <RecurringAddForm categories={allCategories} accounts={allAccounts} />
          </div>
        )}
      </div>

      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.label} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}{' '}
                <span className="font-normal normal-case">({group.items.length})</span>
              </h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="p-2 font-medium">Item</th>
                      <th className="p-2 font-medium">Category</th>
                      <th className="p-2 text-right font-medium">Budgeted</th>
                      <th className="p-2 font-medium">Account</th>
                      {group.showMonths && <th className="p-2 font-medium">Months</th>}
                      <th className="p-2 font-medium">Day</th>
                      <th className="p-2 font-medium">Status</th>
                      {canManage && <th className="p-2 text-right font-medium">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <RecurringRow
                        key={item.id}
                        item={item}
                        categories={allCategories}
                        accounts={allAccounts}
                        showMonthsColumn={group.showMonths}
                        canManage={canManage}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ),
      )}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No recurring items yet.{' '}
          {canManage ? 'Add one above to get started.' : 'Ask the household owner to add one.'}
        </p>
      )}
    </div>
  );
}
