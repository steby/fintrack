import Link from 'next/link';
import { Stat } from '@/components/ui/stat';
import { formatSGD, formatDueDate } from '../../../lib/format';
import type { SafeToSpend, BudgetRemaining, Horizon } from '../../../lib/domain/affordability';
import { HorizonPicker } from './horizon-picker';

// The Home hero — spec.md Phase 9: "safe-to-spend = both lenses (projected cash
// primary, budget-remaining secondary)". Cash is the PRIMARY number whenever it's
// trustworthy (FEATURE_NET_WORTH on AND at least one bank account exists); otherwise
// the budget-remaining lens is promoted to the hero and the cash lens is hidden
// entirely — never rendered as $0 or any other number that would look like a real
// answer to "can I afford this" when it isn't one (spec.md's own edge-case list).
export function SafeToSpendHero({
  cashLensActive,
  safeToSpend,
  budgetRemaining,
  expenseItemCount,
  throughDate,
  horizon,
  canManage,
}: {
  cashLensActive: boolean;
  safeToSpend: SafeToSpend | null;
  budgetRemaining: BudgetRemaining;
  expenseItemCount: number;
  throughDate: string;
  horizon: Horizon;
  canManage: boolean;
}) {
  const billWord = expenseItemCount === 1 ? 'bill' : 'bills';
  const throughText = formatDueDate(throughDate);

  // Both lenses render the exact same scaffold below (a Stat + optional HorizonPicker,
  // then a lens-specific second line) — only what feeds Stat's props, and what that
  // second line is, differs. Computed up front so there's one render path, not two
  // parallel full JSX trees.
  let statTestId: string;
  let label: string;
  let value: string;
  let subLine: string;
  let tone: 'default' | 'warning';
  const showCashLens = cashLensActive && !!safeToSpend;

  if (cashLensActive && safeToSpend) {
    const short = safeToSpend.safeToSpendCents < 0;
    statTestId = 'safe-to-spend-value';
    label = 'Safe to spend';
    value = formatSGD(safeToSpend.safeToSpendCents);
    subLine = short
      ? `Short by ${formatSGD(Math.abs(safeToSpend.safeToSpendCents))} for ${expenseItemCount} upcoming ${billWord} through ${throughText}`
      : `After ${expenseItemCount} upcoming ${billWord} through ${throughText}`;
    tone = short ? 'warning' : 'default';
  } else {
    const budgetShort = budgetRemaining.remainingCents < 0;
    statTestId = 'budget-left-value';
    label = 'Budget left this month';
    value = formatSGD(budgetRemaining.remainingCents);
    subLine =
      budgetRemaining.budgetedExpenseCents > 0
        ? `${Math.round(budgetRemaining.pctSpent)}% of ${formatSGD(budgetRemaining.budgetedExpenseCents)} budgeted spent so far`
        : 'No expenses budgeted this month yet';
    tone = budgetShort ? 'warning' : 'default';
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div data-testid={statTestId}>
          <Stat label={label} value={value} subLine={subLine} tone={tone} />
        </div>
        {canManage && <HorizonPicker horizon={horizon} />}
      </div>
      {showCashLens ? (
        <div data-testid="budget-left-value">
          <BudgetRemainingLine budgetRemaining={budgetRemaining} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <Link href="/accounts" className="underline underline-offset-2 hover:text-foreground">
            Add a bank account
          </Link>{' '}
          to see projected cash here too.
        </p>
      )}
    </div>
  );
}

function BudgetRemainingLine({ budgetRemaining }: { budgetRemaining: BudgetRemaining }) {
  if (budgetRemaining.budgetedExpenseCents === 0) return null;
  const short = budgetRemaining.remainingCents < 0;
  return (
    <p className="text-sm text-muted-foreground">
      Budget left this month:{' '}
      <span className={short ? 'font-medium text-warning' : 'font-medium text-foreground'}>
        {formatSGD(budgetRemaining.remainingCents)}
      </span>{' '}
      ({Math.round(budgetRemaining.pctSpent)}% of {formatSGD(budgetRemaining.budgetedExpenseCents)}{' '}
      spent)
    </p>
  );
}
