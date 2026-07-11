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

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Tue 15 Jul" — Home's upcoming-list due-date display (Phase 9). Takes a YYYY-MM-DD
// string (already UTC-normalized upstream by lib/domain/affordability.ts's dueDate)
// rather than a Date, and re-parses it via Date.UTC from its own components rather than
// `new Date(iso)` — both produce the same UTC instant for a bare YYYY-MM-DD string per
// spec, but spelling it out explicitly matches this app's "date arithmetic is UTC, said
// out loud" convention (lib/domain/today.ts) instead of relying on a reader recalling
// that particular parsing detail.
export function formatDueDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAY_SHORT[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_SHORT[month - 1]}`;
}

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
