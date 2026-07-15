'use client';

import { useRouter } from 'next/navigation';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { CategoryBreakdownPoint } from '../../../lib/domain/dashboard';

export function CategoryChart({ breakdown }: { breakdown: CategoryBreakdownPoint[] }) {
  // Drill-down (full app review finding #6: every chart was a dead end) — a slice or
  // its legend entry opens the transactions search pre-filtered to that category.
  const router = useRouter();
  const data = breakdown.map((c) => ({
    id: c.categoryId,
    name: c.name,
    value: c.totalBudgetedCents / 100,
    color: c.color,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense by category</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No expense categories budgeted this year.
          </div>
        ) : (
          <>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    // No mount animation: sectors detach/reattach mid-animation, which
                    // makes the drill-down click flaky for anyone clicking early.
                    isAnimationActive={false}
                    onClick={(slice) => {
                      // Recharts spreads the original datum onto the sector item; its
                      // PieSectorDataItem type doesn't know our `id`, hence the cast.
                      const id = (slice as unknown as { id?: string }).id;
                      if (id) router.push(`/transactions?category=${id}`);
                    }}
                    className="cursor-pointer"
                  >
                    {data.map((entry) => (
                      <Cell key={entry.id} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                    }}
                    formatter={(value) => formatSGD(Math.round(Number(value) * 100))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Hand-rolled legend, not recharts' <Legend>: these are real buttons —
                keyboard/touch-accessible drill-down targets (a wide arc's clickable
                center can land inside the donut hole, observed under Playwright), and
                their click handling doesn't depend on recharts' internal payload
                shapes. */}
            <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
              {data.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/transactions?category=${entry.id}`)}
                    className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-muted"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: entry.color }}
                      aria-hidden
                    />
                    {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
