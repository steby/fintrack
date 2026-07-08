'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGDCompact, formatSGD, MONTH_SHORT } from '../../../lib/format';
import type { CumulativePoint } from '../../../lib/domain/dashboard';

export function SavingsChart({ series }: { series: CumulativePoint[] }) {
  const data = series.map((p) => ({
    month: MONTH_SHORT[p.month - 1],
    'Cumulative savings': p.cumulativeNetCents / 100,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cumulative savings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
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
              <Line
                type="monotone"
                dataKey="Cumulative savings"
                stroke="var(--foreground)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
