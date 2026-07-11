import Link from 'next/link';
import { BudgetHealthCard } from '../dashboard/budget-health-card';
import type { CategoryBudgetRow } from '../../../lib/db/queries';

// Compact budget-health card for Home (spec.md Phase 9) — reuses the existing
// BudgetHealthCard component/getCurrentMonthCategoryBudgets query wholesale rather than
// building a second, parallel rendering of the same per-category progress bars (this IS
// the widget's real home now — see PROGRESS.md's Phase 8 entry: BudgetHealthCard was
// deliberately NOT duplicated onto /insights or /accounts, precisely so it would land
// here instead of getting two homes).
export function BudgetMini({ categories }: { categories: CategoryBudgetRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <BudgetHealthCard categories={categories} />
      <Link
        href="/insights"
        className="self-end text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        See insights
      </Link>
    </div>
  );
}
