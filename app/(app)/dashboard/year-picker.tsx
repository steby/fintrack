import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Fine-grained year navigation relative to whichever year the dashboard is actually
// showing — complements the sidebar's YearNav quick-jump (which can't know the current
// page's selected year since Next.js layouts don't receive searchParams).
export function YearPicker({ year }: { year: number }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/?year=${year - 1}`}
        data-testid="year-picker-prev"
        aria-label="Previous year"
        className="rounded-md p-1.5 hover:bg-muted"
      >
        <ChevronLeft className="size-4" />
      </Link>
      <span className="w-12 text-center text-sm font-semibold tabular-nums">{year}</span>
      <Link
        href={`/?year=${year + 1}`}
        data-testid="year-picker-next"
        aria-label="Next year"
        className="rounded-md p-1.5 hover:bg-muted"
      >
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
