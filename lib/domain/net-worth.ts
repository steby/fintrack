// Pure logic for Phase 4's running-balance walk and net-worth trend. Per spec.md:
// "running-balance walk (opening + Σ inflow − Σ outflow per month; credit spend
// attributed to linked account)" — credit accounts have no balance of their own here;
// their spend rolls up into whichever bank account they're linked to, since a credit
// card's outflow is real money the linked account will eventually cover. A credit
// account with no link has nothing to roll up into, so its spend is simply excluded
// (there's no account left to attribute it to).

export interface NetWorthAccountInput {
  id: string;
  accountType: 'bank' | 'credit';
  openingBalanceCents: number;
  linkedBankAccountId: string | null;
}

export interface NetWorthEntryInput {
  month: number; // 1-12
  bankAccountId: string | null;
  direction: 'income' | 'expense' | null;
  // "Best estimate" cents (actual ?? budgeted) — the caller's responsibility, same
  // convention as lib/domain/dashboard.ts's bestEstimateCents.
  amountCents: number;
}

export interface AccountBalancePoint {
  accountId: string;
  month: number;
  balanceCents: number;
}

// Resolves an entry's bank_account_id to the account whose series it actually affects:
// itself if it's already a bank account, its linked bank account if it's a linked
// credit card, or null if there's nowhere to attribute it (not a known bank account,
// or an unlinked credit card).
function resolveEffectiveAccountId(
  accounts: NetWorthAccountInput[],
  bankAccountId: string,
): string | null {
  const account = accounts.find((a) => a.id === bankAccountId);
  if (account === undefined) return null;
  if (account.accountType === 'bank') return bankAccountId;
  if (account.accountType === 'credit' && account.linkedBankAccountId !== null) {
    const linked = accounts.find((a) => a.id === account.linkedBankAccountId);
    return linked?.accountType === 'bank' ? linked.id : null;
  }
  return null;
}

// Sums entries into a flat net-cents-per-account total, with no month bucketing —
// used to fold everything that happened in years before the one currently being
// viewed into a single carry-forward baseline (see buildAccountBalances' third
// parameter). Shares the exact credit-redirect rule buildAccountBalances applies
// per month, just collapsed to one running total instead of twelve.
export function sumNetCentsByAccount(
  accounts: NetWorthAccountInput[],
  entries: Pick<NetWorthEntryInput, 'bankAccountId' | 'direction' | 'amountCents'>[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.bankAccountId === null || entry.direction === null) continue;
    const effectiveAccountId = resolveEffectiveAccountId(accounts, entry.bankAccountId);
    if (effectiveAccountId === null) continue;
    const signed = entry.direction === 'income' ? entry.amountCents : -entry.amountCents;
    totals.set(effectiveAccountId, (totals.get(effectiveAccountId) ?? 0) + signed);
  }
  return totals;
}

// One running-balance series per BANK account (credit accounts never appear as their
// own series — their activity has already been redirected to whatever they're linked
// to before this function even sees it isn't there, see resolveEffectiveAccountId
// above). `carryForwardCents` seeds each account's running total on top of its
// opening_balance — the net effect of every entry from years before the one `entries`
// covers, since a lifetime running balance can't reset to opening_balance every time a
// different year is viewed (see sumNetCentsByAccount, and the caller in app/(app)/
// page.tsx, which sums all prior years into this map before calling here).
export function buildAccountBalances(
  accounts: NetWorthAccountInput[],
  entries: NetWorthEntryInput[],
  carryForwardCents: Map<string, number> = new Map(),
): Map<string, AccountBalancePoint[]> {
  const bankAccounts = accounts.filter((a) => a.accountType === 'bank');
  const netByAccountMonth = new Map<string, Map<number, number>>();
  for (const entry of entries) {
    if (entry.bankAccountId === null || entry.direction === null) continue;
    const effectiveAccountId = resolveEffectiveAccountId(accounts, entry.bankAccountId);
    if (effectiveAccountId === null) continue;

    const signed = entry.direction === 'income' ? entry.amountCents : -entry.amountCents;
    const monthMap = netByAccountMonth.get(effectiveAccountId) ?? new Map<number, number>();
    monthMap.set(entry.month, (monthMap.get(entry.month) ?? 0) + signed);
    netByAccountMonth.set(effectiveAccountId, monthMap);
  }

  const result = new Map<string, AccountBalancePoint[]>();
  for (const account of bankAccounts) {
    const monthMap = netByAccountMonth.get(account.id) ?? new Map<number, number>();
    let running = account.openingBalanceCents + (carryForwardCents.get(account.id) ?? 0);
    const points: AccountBalancePoint[] = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      running += monthMap.get(month) ?? 0;
      return { accountId: account.id, month, balanceCents: running };
    });
    result.set(account.id, points);
  }
  return result;
}

export interface NetWorthPoint {
  month: number;
  netWorthCents: number;
}

export function buildNetWorthSeries(
  accountBalances: Map<string, AccountBalancePoint[]>,
): NetWorthPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    let total = 0;
    // Every points array is always built dense and month-ordered by
    // buildAccountBalances (index i holds month i+1), so this is a direct index, not a
    // search — safe even if a caller ever passes a shorter/malformed array, since a
    // missing index just contributes undefined -> skipped below.
    for (const points of accountBalances.values()) {
      // `i` is a bounded loop index (0-11 from Array.from({length: 12}) above), never
      // user input — eslint-plugin-security's heuristic can't tell that apart from an
      // actually-unsafe dynamic property access.
      // eslint-disable-next-line security/detect-object-injection
      const point = points[i];
      if (point && point.month === month) total += point.balanceCents;
    }
    return { month, netWorthCents: total };
  });
}
