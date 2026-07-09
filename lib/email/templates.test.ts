import { describe, expect, it } from 'vitest';
import { reminderEmailHtml, recapEmailHtml } from './templates';
import type { UpcomingBill } from '../domain/reminders';

describe('reminderEmailHtml', () => {
  it('escapes an item name containing HTML (stored XSS via email — spec.md adversarial case)', () => {
    const bills: UpcomingBill[] = [
      {
        id: '1',
        item: '<img src=x onerror=alert(1)>',
        dueDate: '2026-07-12',
        daysUntilDue: 3,
        budgetedAmount: '100.00',
      },
    ];
    const html = reminderEmailHtml('The Tan Household', bills);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a malicious household name', () => {
    const html = reminderEmailHtml('<script>alert(1)</script>', []);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a due-today bill distinctly from a multi-day-out bill', () => {
    const bills: UpcomingBill[] = [
      { id: '1', item: 'Rent', dueDate: '2026-07-09', daysUntilDue: 0, budgetedAmount: '2000.00' },
      {
        id: '2',
        item: 'Internet',
        dueDate: '2026-07-12',
        daysUntilDue: 3,
        budgetedAmount: '50.00',
      },
    ];
    const html = reminderEmailHtml('Household', bills);
    expect(html).toContain('(today)');
    expect(html).toContain('(in 3 days)');
  });
});

describe('recapEmailHtml', () => {
  it('escapes a malicious household name in the recap heading', () => {
    const html = recapEmailHtml('<b>evil</b>', {
      monthName: 'July',
      year: 2026,
      point: {
        month: 7,
        budgetedIncomeCents: 500000,
        actualIncomeCents: 500000,
        budgetedExpenseCents: 300000,
        actualExpenseCents: 280000,
        netBudgetedCents: 200000,
        netActualCents: 220000,
        hasActuals: true,
      },
    });
    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
    expect(html).toContain('July 2026');
  });
});
