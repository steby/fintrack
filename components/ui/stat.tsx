import { cn } from '@/lib/utils';

interface StatProps {
  label: string;
  value: string;
  subLine?: string;
  tone?: 'default' | 'income' | 'expense' | 'warning';
  className?: string;
}

const TONE_CLASS: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-foreground',
  income: 'text-income',
  expense: 'text-expense',
  warning: 'text-warning',
};

// Label + big number + optional sub-line — the shared shape for both the (Phase 9) Home
// hero and any stat-tile grid. `value` is a pre-formatted string (formatSGD etc.), never
// a raw cents number — this component only lays it out, it doesn't do money math.
function Stat({ label, value, subLine, tone = 'default', className }: StatProps) {
  return (
    <div data-slot="stat" className={cn('flex flex-col gap-1', className)}>
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      {/* `tone` is one of the 4 literal union members typed above, never external
          input — eslint-plugin-security's heuristic can't distinguish that from an
          actually-unsafe dynamic property access (same rationale as
          lib/domain/net-worth.ts's bounded-loop-index disable). */}
      {/* eslint-disable-next-line security/detect-object-injection */}
      <div className={cn('text-display font-bold tabular-nums', TONE_CLASS[tone])}>{value}</div>
      {subLine && <div className="text-sm text-muted-foreground">{subLine}</div>}
    </div>
  );
}

export { Stat };
