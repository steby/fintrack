import Link from 'next/link';

// Sidebar year selector (spec.md Phase 3) — URL-driven, jumps to the dashboard for a
// given year from anywhere in the app. Layouts don't receive searchParams in Next.js
// (only page.tsx does), so this can't reflect whichever year the dashboard page itself
// is currently showing — it's anchored to the real current year instead, functioning as
// a quick-jump control. The dashboard page has its own prev/next controls for
// fine-grained navigation once you're already there.
export function YearNav() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="flex flex-col gap-1">
      <div className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Dashboard year
      </div>
      <div className="flex gap-1 px-2">
        {years.map((year) => (
          <Link
            key={year}
            href={`/?year=${year}`}
            data-testid="year-nav-link"
            className="rounded-md px-2 py-1 text-xs hover:bg-muted"
          >
            {year}
          </Link>
        ))}
      </div>
    </div>
  );
}
