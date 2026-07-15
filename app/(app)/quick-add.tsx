'use client';

import { useActionState, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, ChevronDown } from 'lucide-react';
import { addAdhocAction } from '../actions/monthly';
import { getFxRateAction } from '../actions/fx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Fab } from '@/components/ui/fab';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useQuickAddOpen } from './quick-add-context';
import { parseYearParam, parseMonthParam } from '../../lib/domain/month-params';
import { currentYearMonth } from '../../lib/domain/today';
import { SUPPORTED_FX_CURRENCIES, convertToSgdCents } from '../../lib/domain/fx-rules';
import { parseAmountToCents, centsToAmount } from '../../lib/money';

interface Option {
  id: string;
  name: string;
}

type CategoryOption = Option & { direction: 'income' | 'expense'; isSystem: boolean };

// The global quick-add sheet + mobile Fab (spec.md Phase 10), mounted once in
// app/(app)/layout.tsx so it's reachable from every page. The desktop trigger lives in
// the sidebar (quick-add-context.tsx's NewEntryButton); open state is shared via
// QuickAddProvider since the sidebar is a separate server-rendered subtree.
export function QuickAdd({
  categories,
  accounts,
  members,
  entryAttributionEnabled,
}: {
  categories: CategoryOption[];
  accounts: Option[];
  members: Option[];
  entryAttributionEnabled: boolean;
}) {
  const { open, setOpen } = useQuickAddOpen();
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
      {/* aria-label "New entry" must never contain the substring "add" — several E2E
          specs disambiguate pre-existing "Add"/"Add item"/"Add goal" buttons
          positionally, and Playwright role-name matching is substring-based; a
          layout-mounted trigger whose label matched would break them all at once. */}
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
  categories: CategoryOption[];
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
      <AmountWithCurrency />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Category
          {/* Empty value = the server files it under the household's reserved
              Uncategorized expense category (addAdhocAction) — labeled honestly here
              so nobody expects "None" to mean "outside the numbers". */}
          <select name="categoryId" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">Uncategorized</option>
            {categories
              .filter((c) => !c.isSystem)
              .map((c) => (
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

// Amount entry with optional foreign-currency assist (full app review FX item): pick a
// currency, type what you actually paid, and the SGD field pre-fills from a cached
// estimated rate (lib/fx.ts) — EDITABLE, because the rate is an estimate and the card
// statement is the truth. SGD stays the stored value (name="actualAmount"); the
// foreign amount/currency/rate ride along as a display-only annotation. Rate fetch is
// lazy (only when a foreign currency is picked) and failure degrades to manual SGD
// entry with no annotation.
function AmountWithCurrency() {
  const [currency, setCurrency] = useState('SGD');
  const [foreignAmount, setForeignAmount] = useState('');
  const [sgdAmount, setSgdAmount] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  async function pickCurrency(next: string) {
    setCurrency(next);
    setRate(null);
    setRateError(null);
    if (next === 'SGD') return;
    const result = await getFxRateAction(next);
    if (!result || 'error' in result) {
      setRateError(result?.error ?? 'Rate unavailable — enter the SGD amount manually.');
      return;
    }
    setRate(result.rate);
  }

  function syncSgdFrom(foreignRaw: string, currentRate: number | null) {
    if (currentRate === null || foreignRaw === '') return;
    try {
      setSgdAmount(centsToAmount(convertToSgdCents(parseAmountToCents(foreignRaw), currentRate)));
    } catch {
      // Partial input mid-typing ("12.") — leave the SGD field as-is.
    }
  }

  const foreign = currency !== 'SGD';

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>Amount</span>
      <div className="flex gap-2">
        <select
          aria-label="Currency"
          value={currency}
          onChange={(e) => void pickCurrency(e.target.value)}
          className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
        >
          <option value="SGD">SGD</option>
          {SUPPORTED_FX_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {foreign ? (
          <Input
            aria-label={`Amount in ${currency}`}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={foreignAmount}
            onChange={(e) => {
              setForeignAmount(e.target.value);
              syncSgdFrom(e.target.value, rate);
            }}
            className="flex-1"
          />
        ) : (
          <Input
            name="actualAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="flex-1"
          />
        )}
      </div>
      {foreign && (
        <>
          <label className="mt-1 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {rate !== null
                ? `≈ SGD @ ${rate.toFixed(4)} (estimated — adjust if your statement differs)`
                : (rateError ?? 'Fetching rate…')}
            </span>
            <Input
              name="actualAmount"
              aria-label="Amount in SGD"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={sgdAmount}
              onChange={(e) => setSgdAmount(e.target.value)}
              required
            />
          </label>
          {/* Annotation only rides along when a rate was actually involved — manual
              SGD entry after a failed fetch is a plain SGD entry. */}
          {rate !== null && foreignAmount !== '' && (
            <>
              <input type="hidden" name="originalAmount" value={foreignAmount} />
              <input type="hidden" name="originalCurrency" value={currency} />
              <input type="hidden" name="fxRate" value={rate} />
            </>
          )}
        </>
      )}
    </div>
  );
}
