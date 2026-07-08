import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildAccountBalances,
  buildNetWorthSeries,
  sumNetCentsByAccount,
  type NetWorthAccountInput,
  type NetWorthEntryInput,
} from './net-worth';

describe('buildAccountBalances', () => {
  it('carries the opening balance through an empty year unchanged', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'acc-1', accountType: 'bank', openingBalanceCents: 100000, linkedBankAccountId: null },
    ];
    const balances = buildAccountBalances(accounts, []);
    const points = balances.get('acc-1')!;
    expect(points).toHaveLength(12);
    expect(points.every((p) => p.balanceCents === 100000)).toBe(true);
  });

  it('accumulates income minus expense per month for a bank account', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'acc-1', accountType: 'bank', openingBalanceCents: 0, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'acc-1', direction: 'income', amountCents: 5000 },
      { month: 1, bankAccountId: 'acc-1', direction: 'expense', amountCents: 2000 },
      { month: 2, bankAccountId: 'acc-1', direction: 'expense', amountCents: 1000 },
    ];
    const points = buildAccountBalances(accounts, entries).get('acc-1')!;
    expect(points[0].balanceCents).toBe(3000); // 0 + 5000 - 2000
    expect(points[1].balanceCents).toBe(2000); // 3000 - 1000
    expect(points[11].balanceCents).toBe(2000); // carries forward unchanged
  });

  it('can go negative — a real, valid running-balance state, not an error', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'acc-1', accountType: 'bank', openingBalanceCents: 0, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'acc-1', direction: 'expense', amountCents: 5000 },
    ];
    const points = buildAccountBalances(accounts, entries).get('acc-1')!;
    expect(points[0].balanceCents).toBe(-5000);
  });

  it('rolls credit account spend up into its linked bank account', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 10000, linkedBankAccountId: null },
      {
        id: 'credit-1',
        accountType: 'credit',
        openingBalanceCents: 0,
        linkedBankAccountId: 'bank-1',
      },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'credit-1', direction: 'expense', amountCents: 3000 },
    ];
    const balances = buildAccountBalances(accounts, entries);
    expect(balances.has('credit-1')).toBe(false); // credit accounts never get their own series
    expect(balances.get('bank-1')![0].balanceCents).toBe(7000); // 10000 - 3000
  });

  it('excludes an entry referencing an unknown/orphaned bank account id', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 5000, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'does-not-exist', direction: 'expense', amountCents: 999 },
    ];
    const points = buildAccountBalances(accounts, entries).get('bank-1')!;
    expect(points[0].balanceCents).toBe(5000);
  });

  it('excludes a credit account whose link points at a non-existent/non-bank account', () => {
    const accounts: NetWorthAccountInput[] = [
      {
        id: 'credit-1',
        accountType: 'credit',
        openingBalanceCents: 0,
        linkedBankAccountId: 'does-not-exist',
      },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'credit-1', direction: 'expense', amountCents: 999 },
    ];
    // No bank accounts at all — nothing should throw or accumulate anywhere.
    const balances = buildAccountBalances(accounts, entries);
    expect(balances.size).toBe(0);
  });

  it('excludes a credit account with no link — nowhere to attribute its spend', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 10000, linkedBankAccountId: null },
      { id: 'credit-1', accountType: 'credit', openingBalanceCents: 0, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'credit-1', direction: 'expense', amountCents: 3000 },
    ];
    const balances = buildAccountBalances(accounts, entries);
    expect(balances.get('bank-1')![0].balanceCents).toBe(10000); // unaffected
  });

  it('excludes entries with no bank account or no direction', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 5000, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: null, direction: 'income', amountCents: 999 },
      { month: 1, bankAccountId: 'bank-1', direction: null, amountCents: 999 },
    ];
    const points = buildAccountBalances(accounts, entries).get('bank-1')!;
    expect(points[0].balanceCents).toBe(5000);
  });

  it('seeds the running balance from carryForwardCents on top of opening_balance', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 1000, linkedBankAccountId: null },
    ];
    const entries: NetWorthEntryInput[] = [
      { month: 1, bankAccountId: 'bank-1', direction: 'income', amountCents: 500 },
    ];
    const carryForward = new Map([['bank-1', 20000]]);
    const points = buildAccountBalances(accounts, entries, carryForward).get('bank-1')!;
    // 1000 (opening) + 20000 (prior years) + 500 (this year's January) = 21500 — a
    // year viewed after the account has accumulated real history shouldn't restart at
    // just its one-time opening_balance.
    expect(points[0].balanceCents).toBe(21500);
    expect(points[11].balanceCents).toBe(21500);
  });

  it('defaults to no carry-forward when the third argument is omitted (first-year view)', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 1000, linkedBankAccountId: null },
    ];
    const points = buildAccountBalances(accounts, []).get('bank-1')!;
    expect(points[0].balanceCents).toBe(1000);
  });
});

describe('sumNetCentsByAccount', () => {
  it('sums income minus expense per account, ignoring month', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 0, linkedBankAccountId: null },
    ];
    const entries = [
      { bankAccountId: 'bank-1', direction: 'income' as const, amountCents: 300000 },
      { bankAccountId: 'bank-1', direction: 'expense' as const, amountCents: 50000 },
      { bankAccountId: 'bank-1', direction: 'expense' as const, amountCents: 20000 },
    ];
    const totals = sumNetCentsByAccount(accounts, entries);
    expect(totals.get('bank-1')).toBe(230000);
  });

  it('redirects a linked credit account into its bank account, same as buildAccountBalances', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 0, linkedBankAccountId: null },
      {
        id: 'credit-1',
        accountType: 'credit',
        openingBalanceCents: 0,
        linkedBankAccountId: 'bank-1',
      },
    ];
    const entries = [
      { bankAccountId: 'credit-1', direction: 'expense' as const, amountCents: 1000 },
    ];
    const totals = sumNetCentsByAccount(accounts, entries);
    expect(totals.has('credit-1')).toBe(false);
    expect(totals.get('bank-1')).toBe(-1000);
  });

  it('is empty for no entries, never throws', () => {
    const totals = sumNetCentsByAccount([], []);
    expect(totals.size).toBe(0);
  });

  it('excludes entries with no bank account, no direction, or an unresolvable account', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'bank-1', accountType: 'bank', openingBalanceCents: 0, linkedBankAccountId: null },
    ];
    const totals = sumNetCentsByAccount(accounts, [
      { bankAccountId: null, direction: 'income', amountCents: 999 },
      { bankAccountId: 'bank-1', direction: null, amountCents: 999 },
      { bankAccountId: 'does-not-exist', direction: 'income', amountCents: 999 },
    ]);
    expect(totals.size).toBe(0);
  });
});

describe('buildNetWorthSeries', () => {
  it('sums balances across all bank accounts per month', () => {
    const accounts: NetWorthAccountInput[] = [
      { id: 'acc-1', accountType: 'bank', openingBalanceCents: 10000, linkedBankAccountId: null },
      { id: 'acc-2', accountType: 'bank', openingBalanceCents: 5000, linkedBankAccountId: null },
    ];
    const balances = buildAccountBalances(accounts, []);
    const series = buildNetWorthSeries(balances);
    expect(series).toHaveLength(12);
    expect(series[0]).toEqual({ month: 1, netWorthCents: 15000 });
  });

  it('is all-zero for no accounts, never NaN', () => {
    const series = buildNetWorthSeries(new Map());
    expect(series.every((p) => p.netWorthCents === 0)).toBe(true);
    expect(series.every((p) => Number.isFinite(p.netWorthCents))).toBe(true);
  });
});

describe('property: running balance is order-independent per month', () => {
  it('summing entries for the same month in any order yields the same balance', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 0, maxLength: 20 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (amounts, openingBalanceCents) => {
          const accounts: NetWorthAccountInput[] = [
            { id: 'acc-1', accountType: 'bank', openingBalanceCents, linkedBankAccountId: null },
          ];
          const makeEntries = (values: number[]): NetWorthEntryInput[] =>
            values.map((amount) => ({
              month: 1,
              bankAccountId: 'acc-1',
              direction: amount >= 0 ? 'income' : 'expense',
              amountCents: Math.abs(amount),
            }));

          const forward = buildAccountBalances(accounts, makeEntries(amounts)).get('acc-1')![0]
            .balanceCents;
          const reversed = buildAccountBalances(accounts, makeEntries([...amounts].reverse())).get(
            'acc-1',
          )![0].balanceCents;

          expect(forward).toBe(reversed);
          expect(Number.isFinite(forward)).toBe(true);
        },
      ),
    );
  });
});
