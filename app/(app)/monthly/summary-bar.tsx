import { formatSGD } from '../../../lib/format';

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

  const items: { label: string; cents: number; positiveClass?: string }[] = [
    { label: 'Budgeted income', cents: budgetedIncomeCents, positiveClass: 'text-emerald-600' },
    { label: 'Actual income', cents: actualIncomeCents, positiveClass: 'text-emerald-600' },
    { label: 'Budgeted expense', cents: budgetedExpenseCents, positiveClass: 'text-red-600' },
    { label: 'Actual expense', cents: actualExpenseCents, positiveClass: 'text-red-600' },
    {
      label: 'Net budgeted',
      cents: netBudgeted,
      positiveClass: netBudgeted >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    {
      label: 'Net actual',
      cents: netActual,
      positiveClass: netActual >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-6 rounded-md border p-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            {item.label}
          </span>
          <span className={`font-semibold tabular-nums ${item.positiveClass ?? ''}`}>
            {formatSGD(item.cents)}
          </span>
        </div>
      ))}
    </div>
  );
}
