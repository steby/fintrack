import Link from 'next/link';
import type { ViewMode } from '../../../lib/domain/month-params';

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'calendar', label: 'Calendar' },
  { mode: 'agenda', label: 'Agenda' },
  { mode: 'list', label: 'List' },
];

export function ViewToggle({ year, month, view }: { year: number; month: number; view: ViewMode }) {
  return (
    <div className="flex overflow-hidden rounded-md border text-sm">
      {VIEWS.map((v) => (
        <Link
          key={v.mode}
          href={`/monthly?year=${year}&month=${month}&view=${v.mode}`}
          data-testid={`view-toggle-${v.mode}`}
          className={`px-3 py-1.5 ${view === v.mode ? 'bg-muted font-semibold' : 'hover:bg-muted/50'}`}
        >
          {v.label}
        </Link>
      ))}
    </div>
  );
}
