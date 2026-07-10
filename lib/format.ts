// SGD only (spec.md: multi-currency is out of scope for v1) — every amount in the UI
// goes through this, never a hardcoded `$` prefix. The original app's USD/SGD mismatch
// (spec.md's Context) was exactly this: formatting logic scattered and hardcoded to a
// currency the household doesn't use.
const formatter = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Division by 100 here is display-only — every stored/summed value stays in integer
// cents (lib/money.ts) right up until the moment it's formatted for a human, so this
// float conversion never accumulates or feeds back into arithmetic.
export function formatSGD(cents: number): string {
  return formatter.format(cents / 100);
}

// Compact form for tight spaces (calendar cells) — mirrors the reference app's
// formatShort, ported to SGD and integer cents.
export function formatSGDCompact(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  if (abs >= 100_000) {
    return `${sign}$${(abs / 100_000).toFixed(1)}k`;
  }
  return `${sign}$${Math.round(abs / 100)}`;
}

// Shared 1-12 -> short-name lookup (index 0 = January) — used by the Monthly page's
// month tabs and the Dashboard's charts, so both stay in sync if this ever needs to
// change (locale, full names, etc.) instead of drifting as two separate copies.
export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Full-name counterpart to MONTH_SHORT, same reasoning: one shared lookup instead of
// pages hand-rolling their own copy that can drift.
export const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
