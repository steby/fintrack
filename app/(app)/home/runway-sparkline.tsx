'use client';

import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD } from '../../../lib/format';
import type { RunwayPoint } from '../../../lib/domain/affordability';

// Day-by-day projected cash sparkline (spec.md Phase 9) — single series, no axes/legend
// (a glance-able shape, not a detailed chart; StatTiles/CashFlowChart on /insights are
// where the detailed view lives), zero-reference line so a dip below $0 reads instantly
// as a warning without needing to read the axis. lib/domain/affordability.ts's
// buildRunway INCLUDES income here, unlike the hero's conservative safeToSpend figure —
// see that file's own comment for why the two are deliberately different philosophies.
export function RunwaySparkline({ points }: { points: RunwayPoint[] }) {
  const data = points.map((p) => ({ date: p.date, cash: p.projectedCashCents / 100 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash runway</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              {/* Hidden — establishes the date-keyed x mapping recharts' Tooltip needs
                  to label each point, without drawing any visible axis chrome (this
                  sparkline is deliberately axis-free, per the comment above). */}
              <XAxis dataKey="date" hide />
              <ReferenceLine y={0} stroke="var(--warning)" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)' }}
                formatter={(value) => [
                  formatSGD(Math.round(Number(value) * 100)),
                  'Projected cash',
                ]}
              />
              <Line
                type="monotone"
                dataKey="cash"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
