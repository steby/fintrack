import Link from 'next/link';
import type { MonthStatus } from '../../../lib/domain/month-status';
import { MONTH_SHORT } from '../../../lib/format';

const STATUS_DOT: Record<MonthStatus, string> = {
  empty: 'bg-transparent',
  forecast: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  closed: 'bg-emerald-500',
};

function Pill({
  year,
  view,
  name,
  m,
  isActive,
  status,
}: {
  year: number;
  view: string;
  name: string;
  m: number;
  isActive: boolean;
  status: MonthStatus;
}) {
  return (
    <Link
      href={`/monthly?year=${year}&month=${m}&view=${view}`}
      data-testid="month-tab"
      className={`flex shrink-0 snap-start items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
        isActive ? 'bg-muted font-semibold' : 'hover:bg-muted/50'
      }`}
    >
      {/* `status` is narrowed to the MonthStatus union by Pill's own prop type, not
          external input (same false positive as lib/auth/rbac.ts's MATRIX[role]). */}
      {/* eslint-disable-next-line security/detect-object-injection */}
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {name}
    </Link>
  );
}

// Two renders of the SAME 12 months (Phase 10 — spec.md's task 3): a flex-wrap grid at
// md+ (unchanged from before this phase) and a horizontally scrollable, snap-scrolling
// single row below md, where a wrapped 12-pill grid would eat 3+ rows of a phone
// screen. Deliberately two separate containers (not one set of elements re-styled with
// responsive classes) — this project's own established convention for a
// desktop/mobile nav split (see bottom-nav.tsx vs the sidebar's NavLink list) is
// tolerating small, non-mechanical duplication like this over a single element trying
// to serve two very different layouts; distinct container testids
// (month-tabs-desktop/month-tabs-mobile) let a future E2E test scope a locator to
// whichever one the current viewport is actually showing, per the plan's own
// Playwright strict-mode warning (bare month names/testids repeat across the page).
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
  // Built once and rendered into both the desktop and mobile wrappers below (spec.md
  // Phase 10 task 3 still wants two separate CONTAINERS — see the comment above this
  // component for why — but there's no reason the pill list itself needs two separate
  // `.map()` calls producing byte-identical <Pill> elements; a single element list is
  // valid to render into more than one parent).
  const pills = MONTH_SHORT.map((name, i) => {
    // `i` is bounded by MONTH_SHORT's own fixed 12-length array, not external
    // input (same false positive as lib/auth/rbac.ts's MATRIX[role]). Pulled into
    // its own statement (not inlined in the JSX below) so this disable comment
    // reliably stays on the line directly above the flagged access regardless of
    // how Prettier wraps the Pill call's own props.
    // eslint-disable-next-line security/detect-object-injection
    const status = statuses[i];
    return (
      <Pill
        key={name}
        year={year}
        view={view}
        name={name}
        m={i + 1}
        isActive={i + 1 === month}
        status={status}
      />
    );
  });

  return (
    <>
      <div
        data-testid="month-tabs-desktop"
        className="hidden flex-wrap gap-1 border-b pb-2 md:flex"
      >
        {pills}
      </div>
      <div
        data-testid="month-tabs-mobile"
        className="flex snap-x snap-mandatory gap-1 overflow-x-auto border-b pb-2 md:hidden"
      >
        {pills}
      </div>
    </>
  );
}
