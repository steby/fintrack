'use client';

import { useActionState, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, ChevronDown } from 'lucide-react';
import { addAdhocAction } from '../actions/monthly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Fab } from '@/components/ui/fab';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { parseYearParam, parseMonthParam } from '../../lib/domain/month-params';
import { currentYearMonth } from '../../lib/domain/today';

interface Option {
  id: string;
  name: string;
}

// Phase 10's global quick-add — a FAB on mobile (Phase 8's fab.tsx primitive, mounted
// for the first time) and a "+ Add" header-area button on desktop, both opening the
// SAME ResponsiveSheet (open state managed here, not by ResponsiveSheet's own optional
// `trigger` prop, which only accepts one trigger element). Mounted once in
// app/(app)/layout.tsx (inside a Suspense boundary — see that file's comment) so it's
// reachable from every page, not just /monthly; replaces the old page-local
// adhoc-form.tsx entirely (spec.md Phase 10: "rename/refactor adhoc-form.tsx ->
// quick-add.tsx").
export function QuickAdd({
  categories,
  accounts,
  members,
  entryAttributionEnabled,
}: {
  categories: (Option & { direction: 'income' | 'expense' })[];
  accounts: Option[];
  members: Option[];
  entryAttributionEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Defaults to whichever month the CURRENT page's URL is showing (e.g.
  // /monthly?year=&month=), falling back to the current month everywhere else
  // (spec.md Phase 10 edge case: "quick-add from a non-Money page defaults to
  // currentYearMonth()").
  //
  // post-redesign bug-fix pass: year and month must be trusted as a PAIR, not parsed
  // independently. /monthly always sets both together, but /insights only ever sets
  // `year` (never `month`) — parsing them independently meant `/insights?year=2023`
  // silently combined the URL's year=2023 with parseMonthParam(undefined)'s fallback
  // to THIS month, filing a quick-add entry into "2023 + current month," a real,
  // silently-wrong year/month combo the user never chose. Only trust the URL's
  // year+month when BOTH are genuinely present together (the /monthly shape); if
  // either is missing, default the WHOLE pair to currentYearMonth() instead of mixing
  // a URL-sourced half with a currentYearMonth()-sourced half.
  const searchParams = useSearchParams();
  const rawYear = searchParams.get('year');
  const rawMonth = searchParams.get('month');
  const { year, month } =
    rawYear !== null && rawMonth !== null
      ? { year: parseYearParam(rawYear), month: parseMonthParam(rawMonth) }
      : currentYearMonth();

  return (
    <>
      {/* Fixed header slot (spec.md Phase 10's own explicit "top of sidebar OR a fixed
          header slot" choice) rather than nesting inside app/(app)/layout.tsx's
          <aside> — that sidebar is `hidden` below the md breakpoint, and this whole
          component is mounted OUTSIDE it specifically so the Fab below still renders on
          mobile; a fixed-position desktop button needs no such placement at all.
          Labeled "New entry", deliberately NOT containing the substring "add" in any
          form ("Add", "Quick add", etc.) — a first attempt at "Quick add" broke a real,
          pre-existing E2E test (categories.spec.ts's bank-account create/delete flow,
          `getByRole('button', { name: 'Add' }).last()`): Playwright's role-name
          matching is a case-insensitive SUBSTRING match by default, not exact, so
          "Quick add" silently satisfied that query too. This button is mounted on
          EVERY (app) page via the layout — /recurring, /settings/categories,
          /settings/accounts, and Home's own goal/entry forms all already have their
          own "Add"/"Add item"/"Add goal" submit buttons using positional
          `.first()`/`.last()` disambiguation that assumed a fixed element count; any
          label sharing "add" as a substring adds an uncounted-for match everywhere at
          once. "New entry" shares no substring with any of those. */}
      <Button
        type="button"
        size="sm"
        className="fixed top-4 right-4 z-20 hidden gap-1.5 shadow-lg md:inline-flex"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        New entry
      </Button>
      <Fab type="button" aria-label="New entry" onClick={() => setOpen(true)}>
        <Plus className="size-5" />
      </Fab>
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Quick add"
        description="Log an income or expense entry."
      >
        <QuickAddForm
          year={year}
          month={month}
          categories={categories}
          accounts={accounts}
          members={members}
          entryAttributionEnabled={entryAttributionEnabled}
          onSuccess={() => setOpen(false)}
        />
      </ResponsiveSheet>
    </>
  );
}

function QuickAddForm({
  year,
  month,
  categories,
  accounts,
  members,
  entryAttributionEnabled,
  onSuccess,
}: {
  year: number;
  month: number;
  categories: (Option & { direction: 'income' | 'expense' })[];
  accounts: Option[];
  members: Option[];
  entryAttributionEnabled: boolean;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(addAdhocAction, undefined);
  const [showMore, setShowMore] = useState(false);

  // post-redesign bug-fix pass: onSuccess() is the PARENT QuickAdd's setOpen(false) —
  // a DIFFERENT component's state, not this one's own. Calling it synchronously during
  // this component's own render (the render-time "reacted to" pattern used safely
  // elsewhere in this codebase, e.g. goal-add-form.tsx) is the unsafe "update a
  // different component's state during another component's render" pattern: React
  // explicitly only sanctions that render-time trick when a component touches its OWN
  // state, since doing so schedules a same-component re-render React already expects;
  // reaching into an ANCESTOR's setState from here has no such guarantee and can tear
  // or warn under concurrent rendering. Moved into a useEffect keyed on `state` so the
  // parent's setOpen(false) fires as a proper effect after render commits, not during
  // this component's render.
  useEffect(() => {
    if (state?.success) onSuccess();
    // onSuccess is a fresh closure from the parent every render (not memoized);
    // depending on it here would fire this effect on every parent re-render, not just
    // on a genuine state change — `state` is the one value that actually changes
    // exactly when a submission completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="quick-add-form">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col gap-1 text-sm">
        Item
        <Input name="item" placeholder="e.g. Car Repair" required autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Amount
        <Input name="actualAmount" type="number" step="0.01" min="0" placeholder="0.00" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select name="categoryId" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.direction === 'income' ? '↑' : '↓'} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Account
          <select name="bankAccountId" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Date
        <Input name="actualDate" type="date" />
      </label>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit gap-1 text-muted-foreground"
        aria-expanded={showMore}
        onClick={() => setShowMore((v) => !v)}
      >
        <ChevronDown className={`size-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`} />
        More options
      </Button>

      {showMore && (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
          <label className="flex flex-col gap-1 text-sm">
            Budgeted amount
            <Input
              name="budgetedAmount"
              type="number"
              step="0.01"
              min="0"
              placeholder="Same as amount"
            />
          </label>
          {entryAttributionEnabled && (
            <label className="flex flex-col gap-1 text-sm">
              Paid by
              <select
                name="paidByUserId"
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Unspecified</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add entry'}
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
