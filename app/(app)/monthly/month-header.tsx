import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTH_FULL } from '../../../lib/format';
import { monthNav, type ViewMode } from '../../../lib/domain/month-params';
import { currentYearMonth } from '../../../lib/domain/today';

// `‹ July 2026 ›` — Phase 10's month prev/next chevrons, crossing year boundaries via
// lib/domain/month-params.ts's monthNav (a thin wrapper around the same addMonths
// lib/domain/recurring.ts's generate window already relies on, not a second copy of
// the Dec<->Jan rollover math). A plain server component: every link here is a real
// `<a href>` navigation, no client state needed.
export function MonthHeader({
  year,
  month,
  view,
}: {
  year: number;
  month: number;
  view: ViewMode;
}) {
  const { prev, next } = monthNav(year, month);
  const current = currentYearMonth();
  const isCurrentMonth = year === current.year && month === current.month;

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/monthly?year=${prev.year}&month=${prev.month}&view=${view}`}
        aria-label="Previous month"
        data-testid="month-nav-prev"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-5" />
      </Link>
      <h1
        data-testid="month-header-label"
        className="min-w-[11ch] text-center text-2xl font-semibold tabular-nums"
      >
        {MONTH_FULL[month - 1]} {year}
      </h1>
      <Link
        href={`/monthly?year=${next.year}&month=${next.month}&view=${view}`}
        aria-label="Next month"
        data-testid="month-nav-next"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className="size-5" />
      </Link>
      {!isCurrentMonth && (
        <Link
          href={`/monthly?year=${current.year}&month=${current.month}&view=${view}`}
          data-testid="month-nav-today"
          className="ml-1 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Today
        </Link>
      )}
    </div>
  );
}
