import Link from 'next/link';
import type { MonthStatus } from '../../../lib/domain/month-status';
import { MONTH_SHORT } from '../../../lib/format';

const STATUS_DOT: Record<MonthStatus, string> = {
  empty: 'bg-transparent',
  forecast: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  closed: 'bg-emerald-500',
};

export function MonthTabs({
  year,
  month,
  view,
  statuses,
}: {
  year: number;
  month: number;
  view: string;
  statuses: MonthStatus[];
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2">
      {MONTH_SHORT.map((name, i) => {
        const m = i + 1;
        const isActive = m === month;
        return (
          <Link
            key={name}
            href={`/monthly?year=${year}&month=${m}&view=${view}`}
            data-testid="month-tab"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
              isActive ? 'bg-muted font-semibold' : 'hover:bg-muted/50'
            }`}
          >
            {/* `i` is bounded by MONTH_SHORT.map's own array (fixed length 12), and
                statuses[i]'s value is narrowed to the MonthStatus union — neither is
                external/untrusted input (same false positive as lib/auth/rbac.ts's
                MATRIX[role]). */}
            {/* eslint-disable-next-line security/detect-object-injection */}
            <span className={`size-1.5 rounded-full ${STATUS_DOT[statuses[i]]}`} aria-hidden />
            {name}
          </Link>
        );
      })}
    </div>
  );
}
