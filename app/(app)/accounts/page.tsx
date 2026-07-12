import { Landmark } from 'lucide-react';
import { requireUser } from '../../../lib/auth/guards';
import { env } from '../../../lib/env';
import {
  getDashboardRows,
  getAccountsForNetWorth,
  getAccountEntriesBeforeYear,
} from '../../../lib/db/queries';
import { bestEstimateCents, buildBankSummary } from '../../../lib/domain/dashboard';
import {
  buildAccountBalances,
  buildNetWorthSeries,
  sumNetCentsByAccount,
} from '../../../lib/domain/net-worth';
import { parseYearParam } from '../../../lib/domain/month-params';
import { formatSGD } from '../../../lib/format';
import { Stat } from '@/components/ui/stat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NetWorthAboutSheet } from './net-worth-about-sheet';
import { NetWorthChart } from '../dashboard/net-worth-chart';
import { AccountBalancesTable } from '../dashboard/account-balances-table';
import { BankSummaryTable } from '../dashboard/bank-summary-table';
import { YearPicker } from '../dashboard/year-picker';

// Net worth — NetWorthChart + AccountBalancesTable + BankSummaryTable, the same
// balance-walk (lib/domain/net-worth.ts) app/(app)/page.tsx (the dashboard) has always
// run, lifted onto their own route (spec.md Phase 8). The old dashboard KEEPS rendering
// all of this too, unchanged, until Phase 9 — the duplication is deliberate.
//
// post-redesign bug-fix pass: BankSummaryTable (buildBankSummary) needs only entries
// tagged to a bank account for the selected year — no opening-balance carry-forward, no
// FEATURE_NET_WORTH dependency at all — so it's fetched and rendered UNCONDITIONALLY
// below. Only the genuinely net-worth-specific pieces (NetWorthChart,
// AccountBalancesTable, the hero "Total net worth" Stat, and the opening-balance
// carry-forward math feeding them) stay gated behind FEATURE_NET_WORTH. Previously the
// whole page early-returned an EmptyState when the flag was off, which made
// BankSummaryTable completely unreachable — a regression from the pre-redesign
// dashboard, which rendered Bank Summary unconditionally, independent of this flag.
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const year = parseYearParam(params.year);

  const [currentRows, netWorthAccounts, priorYearsEntries] = await Promise.all([
    getDashboardRows(user.householdId, year),
    env.FEATURE_NET_WORTH ? getAccountsForNetWorth(user.householdId) : Promise.resolve([]),
    env.FEATURE_NET_WORTH
      ? getAccountEntriesBeforeYear(user.householdId, year)
      : Promise.resolve([]),
  ]);

  const bankSummary = buildBankSummary(currentRows);

  if (!env.FEATURE_NET_WORTH) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Net worth</h1>
          <YearPicker year={year} basePath="/accounts" />
        </div>
        <p className="flex max-w-xl items-center gap-2 text-sm text-muted-foreground">
          <Landmark className="size-4 shrink-0" aria-hidden />
          Net-worth tracking (balances, the net-worth chart) is turned off for this deployment — ask
          whoever manages the app&apos;s environment to turn on FEATURE_NET_WORTH. Bank summary
          below still works either way.
        </p>
        <BankSummaryTable accounts={bankSummary} />
      </div>
    );
  }

  // Net worth is a lifetime running total, not something that resets every time a
  // different year is browsed — everything from years before `year` is folded into a
  // carry-forward baseline on top of each account's one-time opening_balance, then the
  // selected year's entries walk forward from there month by month. Maintainability-pass
  // note: this used to point at "the dashboard's own copy (app/(app)/page.tsx)" as a
  // sibling doing the same math — that's stale. app/(app)/page.tsx was rewritten in
  // Phase 9 into the forecast-first Home page and no longer runs any carry-forward/
  // net-worth-series computation at all; it only sums CURRENT cash across bank accounts
  // for the safe-to-spend hero (a narrower, differently-shaped calculation, not a
  // duplicate of this page's yearly balance walk). There is no longer a second copy of
  // this specific math anywhere else in the app to extract a shared helper against.
  const carryForward = sumNetCentsByAccount(netWorthAccounts, priorYearsEntries);
  const accountBalances = buildAccountBalances(
    netWorthAccounts,
    currentRows.map((row) => ({
      month: row.month,
      bankAccountId: row.bankAccountId,
      direction: row.direction,
      amountCents: bestEstimateCents(row),
    })),
    carryForward,
  );
  const netWorthSeries = buildNetWorthSeries(accountBalances);
  const latestBalances = netWorthAccounts
    .filter((a) => a.accountType === 'bank')
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      // Every bank account passed in always gets a full 12-point series back, so this
      // is never the empty-array fallback — buildAccountBalances only ever omits an
      // account entirely, never returns it with zero points.
      balanceCents: accountBalances.get(a.id)![11].balanceCents,
    }));
  const totalNetWorthCents = netWorthSeries.at(-1)?.netWorthCents ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Net worth</h1>
          <Tooltip>
            <TooltipTrigger
              aria-label="How net worth is calculated"
              className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Landmark className="size-4" />
            </TooltipTrigger>
            <TooltipContent>
              Each bank account&apos;s opening balance plus every entry recorded against it to date;
              linked credit-card spend rolls up into its linked account.
            </TooltipContent>
          </Tooltip>
        </div>
        <YearPicker year={year} basePath="/accounts" />
      </div>

      <div className="flex items-end justify-between gap-4">
        <Stat
          label="Total net worth"
          value={formatSGD(totalNetWorthCents)}
          subLine={`Across ${latestBalances.length} bank account${latestBalances.length === 1 ? '' : 's'}`}
        />
        <NetWorthAboutSheet />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NetWorthChart series={netWorthSeries} />
        </div>
        <AccountBalancesTable accounts={latestBalances} />
      </div>

      <BankSummaryTable accounts={bankSummary} />
    </div>
  );
}
