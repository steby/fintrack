import { EntryRow } from './entry-row';
import type { MonthlyEntryRow } from './types';

export function ListView({
  entries,
  canManage,
}: {
  entries: MonthlyEntryRow[];
  canManage: boolean;
}) {
  const income = entries.filter((e) => e.categoryDirection === 'income');
  const expense = entries.filter((e) => e.categoryDirection === 'expense');
  // An entry with no category (categoryDirection null) matches neither filter above —
  // the reference app's table view silently drops these rows entirely. Given an
  // uncategorized item, one keystroke away from "Category: None," is a completely
  // ordinary state (not a data-integrity error), silently hiding it from the one view
  // meant to show every entry violates "nothing fails silently."
  const uncategorized = entries.filter((e) => e.categoryDirection === null);
  const groups = [
    { label: 'Income', items: income, arrow: '↑' },
    { label: 'Expenses', items: expense, arrow: '↓' },
    { label: 'Uncategorized', items: uncategorized, arrow: '•' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.label} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {group.arrow} {group.label}
              </h2>
              <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="p-2 font-medium">Item</th>
                      <th className="p-2 font-medium">Category</th>
                      <th className="p-2 text-right font-medium">Budgeted</th>
                      <th className="p-2 text-right font-medium">Actual</th>
                      <th className="p-2 text-right font-medium">Difference</th>
                      <th className="p-2 font-medium">Account</th>
                      <th className="p-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} canManage={canManage} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ),
      )}
    </div>
  );
}
