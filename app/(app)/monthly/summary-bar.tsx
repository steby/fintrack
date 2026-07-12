import { Stat } from '@/components/ui/stat';
import { formatSGD } from '../../../lib/format';

// Phase 10 restyle (spec.md task 6: "6 figures -> income/expense/net trio with money
// tokens"): the old layout showed budgeted/actual as 6 separate flat figures; this
// collapses each pair into one Stat (actual as the headline, budgeted as the sub-line)
// and colors them via the semantic --income/--expense/--warning tokens instead of the
// emerald/red Tailwind literals the pre-redesign version used — this page's own
// retirement of that older convention (see app/globals.css's Phase 8 comment: "retired
// page-by-page... through Phase 11").
export function SummaryBar({
  budgetedIncomeCents,
  actualIncomeCents,
  budgetedExpenseCents,
  actualExpenseCents,
}: {
  budgetedIncomeCents: number;
  actualIncomeCents: number;
  budgetedExpenseCents: number;
  actualExpenseCents: number;
}) {
  const netBudgeted = budgetedIncomeCents - budgetedExpenseCents;
  const netActual = actualIncomeCents - actualExpenseCents;

  return (
    <div
      data-testid="summary-bar"
      className="grid grid-cols-1 gap-4 rounded-2xl border bg-card p-4 shadow-card sm:grid-cols-3"
    >
      <Stat
        label="Income"
        value={formatSGD(actualIncomeCents)}
        subLine={`Budgeted ${formatSGD(budgetedIncomeCents)}`}
        tone="income"
      />
      <Stat
        label="Expenses"
        value={formatSGD(actualExpenseCents)}
        subLine={`Budgeted ${formatSGD(budgetedExpenseCents)}`}
        tone="expense"
      />
      <Stat
        label="Net"
        value={formatSGD(netActual)}
        subLine={`Budgeted ${formatSGD(netBudgeted)}`}
        tone={netActual >= 0 ? 'income' : 'expense'}
      />
    </div>
  );
}
