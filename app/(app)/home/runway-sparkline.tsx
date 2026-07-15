'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatSGD, formatDueDate } from '../../../lib/format';
import type { RunwayPoint } from '../../../lib/domain/affordability';

const WIDTH = 600; // viewBox units — scales to the container via preserveAspectRatio
const HEIGHT = 120;
const PAD = 8;

// Day-by-day projected cash sparkline (spec.md Phase 9) — single series, no axes/legend
// (a glance-able shape, not a detailed chart; /insights holds the detailed views), zero
// line so a dip below $0 reads instantly. lib/domain/affordability.ts's buildRunway
// INCLUDES income here, unlike the hero's conservative safeToSpend — see that file's
// comment for why the two are deliberately different philosophies.
//
// Hand-rolled SVG, not Recharts (batch-4 bundle finding): this sparkline was the ONLY
// reason Home loaded the ~368KB Recharts chunk — a polyline, a dashed line, and a
// nearest-point hover need none of it. Recharts still powers /insights and /accounts,
// where the detailed charts earn its weight.
export function RunwaySparkline({ points }: { points: RunwayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) return null;

  const values = points.map((p) => p.projectedCashCents);
  // Always include 0 in the domain so the zero-reference line is on-canvas even when
  // the whole runway is comfortably positive (or entirely negative).
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const x = (i: number) =>
    PAD + (points.length === 1 ? 0 : (i / (points.length - 1)) * (WIDTH - 2 * PAD));
  const y = (cents: number) => PAD + (1 - (cents - min) / span) * (HEIGHT - 2 * PAD);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.projectedCashCents)}`)
    .join(' ');
  const zeroY = y(0);
  // .at() rather than [hover]: identical semantics for a clamped index, without
  // tripping eslint's object-injection rule on a state-derived subscript.
  const hovered = hover === null ? null : (points.at(hover) ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cash runway</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-[120px] w-full">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label="Projected cash by day"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientX - rect.left) / rect.width;
              const index = Math.round(fraction * (points.length - 1));
              setHover(Math.max(0, Math.min(points.length - 1, index)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            <line
              x1={PAD}
              x2={WIDTH - PAD}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--warning)"
              strokeDasharray="4 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null && hovered !== null && (
              <circle
                cx={x(hover)}
                cy={y(hovered.projectedCashCents)}
                r={3.5}
                fill="var(--chart-1)"
              />
            )}
          </svg>
          {hovered && (
            <div
              className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
              style={
                // Flip sides at the midpoint so the tooltip never clips off-canvas.
                hover !== null && hover / (points.length - 1) < 0.5
                  ? { left: `${(hover / (points.length - 1)) * 100}%`, marginLeft: 8 }
                  : { right: `${100 - (hover! / (points.length - 1)) * 100}%`, marginRight: 8 }
              }
            >
              <div className="text-muted-foreground">{formatDueDate(hovered.date)}</div>
              <div className="font-medium tabular-nums">
                {formatSGD(hovered.projectedCashCents)}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
