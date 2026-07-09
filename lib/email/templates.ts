import type { UpcomingBill } from '../domain/reminders';
import type { MonthlyPoint } from '../domain/dashboard';
import { parseAmountToCents } from '../money';
import { formatSGD } from '../format';

// Every value interpolated below can originate from user-entered text (a recurring
// item's name, ultimately) — spec.md's adversarial pass explicitly calls this out:
// "template with entry names containing HTML (escape — stored XSS via email)". Escape
// before interpolating into any HTML template in this file, never the reverse order.
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function reminderEmailHtml(householdName: string, bills: UpcomingBill[]): string {
  const rows = bills
    .map(
      (bill) =>
        `<li>${escapeHtml(bill.item)} — ${escapeHtml(formatSGD(parseAmountToCents(bill.budgetedAmount)))} due ${escapeHtml(bill.dueDate)}` +
        `${bill.daysUntilDue === 0 ? ' (today)' : ` (in ${bill.daysUntilDue} day${bill.daysUntilDue === 1 ? '' : 's'})`}</li>`,
    )
    .join('');

  return (
    `<h1>Upcoming bills for ${escapeHtml(householdName)}</h1>` +
    `<p>The following bills are due within the next 3 days:</p>` +
    `<ul>${rows}</ul>`
  );
}

export interface RecapMonthSummary {
  monthName: string;
  year: number;
  point: MonthlyPoint;
}

export function recapEmailHtml(householdName: string, summary: RecapMonthSummary): string {
  const { monthName, year, point } = summary;
  return (
    `<h1>${escapeHtml(monthName)} ${year} recap for ${escapeHtml(householdName)}</h1>` +
    `<table>` +
    `<tr><td>Budgeted income</td><td>${formatSGD(point.budgetedIncomeCents)}</td></tr>` +
    `<tr><td>Actual income</td><td>${formatSGD(point.actualIncomeCents)}</td></tr>` +
    `<tr><td>Budgeted expense</td><td>${formatSGD(point.budgetedExpenseCents)}</td></tr>` +
    `<tr><td>Actual expense</td><td>${formatSGD(point.actualExpenseCents)}</td></tr>` +
    `<tr><td>Net (actual)</td><td>${formatSGD(point.netActualCents)}</td></tr>` +
    `</table>`
  );
}
