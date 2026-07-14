import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD, formatDueDate } from '../../../lib/format';
import type { UpcomingItem } from '../../../lib/domain/affordability';
import { MarkPaidButton } from './mark-paid-button';

// Cross-month upcoming list (spec.md Phase 9) — grouped Overdue / This week / Later, the
// same bucketing scheme regardless of which horizon is selected. Every item here is
// already unpaid (selectUpcomingItems excludes paid rows).
//
// Zero-amount items get their own "Needs an amount" group instead of the date buckets:
// a $0.00 recurring item is a template the user hasn't finished setting up (user's
// explicit read: "a visual reminder for me to set them up"), not a bill — rendering it
// as red overdue debt next to a real $3,200 mortgage buries the actual signal. The
// domain math is untouched: a $0 item contributes nothing to any total either way.
export function UpcomingList({ items, canManage }: { items: UpcomingItem[]; canManage: boolean }) {
  const needsAmount = items.filter((i) => i.amountCents === 0);
  const billed = items.filter((i) => i.amountCents !== 0);
  const overdue = billed.filter((i) => i.overdue);
  const thisWeek = billed.filter((i) => !i.overdue && i.daysUntilDue <= 7);
  const later = billed.filter((i) => !i.overdue && i.daysUntilDue > 7);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing due within this horizon.
          </p>
        ) : (
          <>
            <Group title="Overdue" items={overdue} canManage={canManage} tone="warning" />
            <Group title="This week" items={thisWeek} canManage={canManage} />
            <Group title="Later" items={later} canManage={canManage} />
            <NeedsAmountGroup items={needsAmount} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Group({
  title,
  items,
  canManage,
  tone,
}: {
  title: string;
  items: UpcomingItem[];
  canManage: boolean;
  tone?: 'warning';
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div
        className={
          tone === 'warning'
            ? 'text-xs font-semibold tracking-wide text-warning uppercase'
            : 'text-xs font-semibold tracking-wide text-muted-foreground uppercase'
        }
      >
        {title}
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.entryId}
            data-testid="upcoming-item"
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: item.categoryColor ?? '#6B7280' }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.item}</div>
                <div className="text-xs text-muted-foreground">{formatDueDate(item.dueDate)}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className={
                  item.direction === 'income'
                    ? 'text-sm font-medium text-income tabular-nums'
                    : 'text-sm tabular-nums'
                }
              >
                {item.direction === 'income' ? '+' : ''}
                {formatSGD(item.amountCents)}
              </span>
              {canManage && (
                <MarkPaidButton
                  entryId={item.entryId}
                  item={item.item}
                  amountCents={item.amountCents}
                  direction={item.direction}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Muted setup prompts, not bills: name + due context, and a "Set amount" link into the
// Plan page (where the recurring template's budgeted amount lives) instead of a
// mark-paid button. Own testid so E2E counts of real upcoming-item rows stay honest.
function NeedsAmountGroup({ items }: { items: UpcomingItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Needs an amount
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.entryId}
            data-testid="upcoming-needs-amount"
            className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/60 px-3 py-2 opacity-70"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: item.categoryColor ?? '#6B7280' }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.item}</div>
                <div className="text-xs text-muted-foreground">{formatDueDate(item.dueDate)}</div>
              </div>
            </div>
            <Link
              href="/recurring"
              className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Set amount
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
