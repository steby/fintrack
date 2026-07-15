import Link from 'next/link';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { requireUser } from '../../../lib/auth/guards';
import { db } from '../../../lib/db';
import { categories } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  searchTransactions,
  TRANSACTION_SEARCH_LIMIT,
  type TransactionSearchRow,
} from '../../../lib/db/queries';
import { formatSGD } from '../../../lib/format';
import { parseAmountToCents } from '../../../lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

const MONTH_SHORT = [
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

// Cross-month search (full app review finding #5) — a plain GET form over server-
// rendered results: the URL is the whole state (shareable, back-button-friendly), no
// client component needed. Insights' category donut drills down to here (?category=).
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  // Trust boundary: q is only ever used as an escaped LIKE fragment (queries.ts), but
  // cap its length; category must be a UUID or it's ignored outright (a garbage value
  // just means "no filter", never an error page).
  const q = typeof params.q === 'string' ? params.q.slice(0, 200) : '';
  const rawCategory = typeof params.category === 'string' ? params.category : '';
  const categoryId = z.string().uuid().safeParse(rawCategory).success ? rawCategory : undefined;

  const hasFilters = q !== '' || categoryId !== undefined;
  const [rows, householdCategories] = await Promise.all([
    hasFilters
      ? searchTransactions(user.householdId, { q: q || undefined, categoryId })
      : Promise.resolve([] as TransactionSearchRow[]),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.householdId, user.householdId))
      .orderBy(categories.direction, categories.sortOrder),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Search every entry across all months and years.
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          Item
          <Input name="q" defaultValue={q} placeholder="e.g. dentist" maxLength={200} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select
            name="category"
            defaultValue={categoryId ?? ''}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All categories</option>
            {householdCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="gap-1.5">
          <Search className="size-4" />
          Search
        </Button>
      </form>

      {!hasFilters ? (
        <EmptyState
          icon={Search}
          title="Search your history"
          description="Find an entry by name, or filter a whole category across every month."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matches" description="Try a shorter search or another category." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {rows.map((row) => (
                <TransactionRow key={row.id} row={row} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {rows.length === TRANSACTION_SEARCH_LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing the {TRANSACTION_SEARCH_LIMIT} most recent matches — narrow the search to see
          older ones.
        </p>
      )}
    </div>
  );
}

function TransactionRow({ row }: { row: TransactionSearchRow }) {
  const paid = row.actualAmount !== null;
  const cents = parseAmountToCents(paid ? row.actualAmount! : row.budgetedAmount);
  const when = row.actualDate ?? `${MONTH_SHORT[row.month - 1]} ${row.year}`;
  return (
    <li>
      <Link
        href={`/monthly?year=${row.year}&month=${row.month}&view=list`}
        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: row.categoryColor ?? '#6B7280' }}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{row.item}</div>
            <div className="text-xs text-muted-foreground">
              {when}
              {row.categoryName ? ` · ${row.categoryName}` : ''}
              {paid ? '' : ' · planned'}
            </div>
          </div>
        </div>
        <span
          className={
            row.direction === 'income'
              ? 'shrink-0 text-sm font-medium text-income tabular-nums'
              : 'shrink-0 text-sm tabular-nums'
          }
        >
          {row.direction === 'income' ? '+' : ''}
          {formatSGD(cents)}
        </span>
      </Link>
    </li>
  );
}
