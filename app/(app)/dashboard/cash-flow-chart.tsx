'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGDCompact, formatSGD, MONTH_SHORT } from '../../../lib/format';
import type { MonthlyPoint } from '../../../lib/domain/dashboard';

export function CashFlowChart({ series }: { series: MonthlyPoint[] }) {
  // Budgeted bars render in a lighter shade alongside actual — for a month with a
  // budget but no actuals yet (spec.md Phase 3's "charts show budget-only" edge case),
  // the actual bar is simply zero-height while the budgeted bar still shows the plan.
  const data = series.map((m) => ({
    month: MONTH_SHORT[m.month - 1],
    'Budgeted income': m.budgetedIncomeCents / 100,
    'Actual income': m.actualIncomeCents / 100,
    'Budgeted expense': m.budgetedExpenseCents / 100,
    'Actual expense': m.actualExpenseCents / 100,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash flow</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickFormatter={(v: number) => formatSGDCompact(Math.round(v * 100))}
              />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)' }}
                formatter={(value) => formatSGD(Math.round(Number(value) * 100))}
              />
              <Legend />
              <Bar
                dataKey="Budgeted income"
                fill="#10b981"
                fillOpacity={0.3}
                radius={[3, 3, 0, 0]}
              />
              <Bar dataKey="Actual income" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar
                dataKey="Budgeted expense"
                fill="#ef4444"
                fillOpacity={0.3}
                radius={[3, 3, 0, 0]}
              />
              <Bar dataKey="Actual expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
