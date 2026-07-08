import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MIN_YEAR, MAX_YEAR } from '../../../lib/domain/month-params';

// Fine-grained year navigation relative to whichever year the dashboard is actually
// showing — complements the sidebar's YearNav quick-jump (which can't know the current
// page's selected year since Next.js layouts don't receive searchParams).
//
// Disabled (not just visually, the href itself is omitted) past MIN_YEAR/MAX_YEAR —
// parseYearParam falls back to the current calendar year for anything out of that
// range, so a plain `year - 1`/`year + 1` link at the boundary would otherwise silently
// teleport the user decades forward/back instead of stopping.
export function YearPicker({ year }: { year: number }) {
  const atMin = year <= MIN_YEAR;
  const atMax = year >= MAX_YEAR;

  return (
    <div className="flex items-center gap-2">
      {atMin ? (
        <span aria-hidden className="rounded-md p-1.5 text-muted-foreground/40">
          <ChevronLeft className="size-4" />
        </span>
      ) : (
        <Link
          href={`/?year=${year - 1}`}
          data-testid="year-picker-prev"
          aria-label="Previous year"
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </Link>
      )}
      <span className="w-12 text-center text-sm font-semibold tabular-nums">{year}</span>
      {atMax ? (
        <span aria-hidden className="rounded-md p-1.5 text-muted-foreground/40">
          <ChevronRight className="size-4" />
        </span>
      ) : (
        <Link
          href={`/?year=${year + 1}`}
          data-testid="year-picker-next"
          aria-label="Next year"
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
