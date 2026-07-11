import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD, formatDueDate } from '../../../lib/format';
import type { UpcomingItem } from '../../../lib/domain/affordability';
import { MarkPaidButton } from './mark-paid-button';

// Cross-month upcoming list (spec.md Phase 9) — grouped Overdue / This week / Later, the
// same bucketing scheme regardless of which horizon is selected (a 30-day horizon still
// separates "due in the next 7 days" from "due later," it just has a bigger "Later"
// bucket). Every item here is already unpaid (lib/domain/affordability.ts's
// selectUpcomingItems excludes paid rows before this component ever sees them).
export function UpcomingList({ items, canManage }: { items: UpcomingItem[]; canManage: boolean }) {
  const overdue = items.filter((i) => i.overdue);
  const thisWeek = items.filter((i) => !i.overdue && i.daysUntilDue <= 7);
  const later = items.filter((i) => !i.overdue && i.daysUntilDue > 7);

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
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
