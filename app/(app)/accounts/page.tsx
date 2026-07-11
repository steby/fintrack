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
import { EmptyState } from '@/components/ui/empty-state';
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
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const year = parseYearParam(params.year);

  if (!env.FEATURE_NET_WORTH) {
    return (
      <div className="flex max-w-lg flex-col gap-3">
        <h1 className="text-2xl font-semibold">Net worth</h1>
        <EmptyState
          icon={Landmark}
          title="Net worth tracking is turned off"
          description="This deployment has balances and net-worth tracking disabled. Ask whoever manages the app's environment to turn on FEATURE_NET_WORTH."
        />
      </div>
    );
  }

  const [currentRows, netWorthAccounts, priorYearsEntries] = await Promise.all([
    getDashboardRows(user.householdId, year),
    getAccountsForNetWorth(user.householdId),
    getAccountEntriesBeforeYear(user.householdId, year),
  ]);

  const bankSummary = buildBankSummary(currentRows);

  // Net worth is a lifetime running total, not something that resets every time a
  // different year is browsed — everything from years before `year` is folded into a
  // carry-forward baseline on top of each account's one-time opening_balance, then the
  // selected year's entries walk forward from there month by month. Same math as the
  // dashboard's own copy (app/(app)/page.tsx) — not extracted into a shared helper
  // there, since that page is deliberately untouched this phase.
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
