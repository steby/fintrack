'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { CategoryBreakdownPoint } from '../../../lib/domain/dashboard';

export function CategoryChart({ breakdown }: { breakdown: CategoryBreakdownPoint[] }) {
  const data = breakdown.map((c) => ({
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
        <div className="h-64 w-full">
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No expense categories budgeted this year.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)' }}
                  formatter={(value) => formatSGD(Math.round(Number(value) * 100))}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
