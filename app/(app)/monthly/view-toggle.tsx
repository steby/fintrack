'use client';

import Link from 'next/link';
import { Tabs, TabsList, TabsTab, TabsIndicator } from '@/components/ui/tabs';
import type { ViewMode } from '../../../lib/domain/month-params';

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'calendar', label: 'Calendar' },
  { mode: 'agenda', label: 'Agenda' },
  { mode: 'list', label: 'List' },
];

// Phase 8's Tabs primitive, wired up for real for the first time (its own entry noted
// "real home is the Monthly view-toggle, Phase 10"). Each Tab renders AS a real
// `next/link` (Base UI's `render` composition prop — same mechanism as
// `<Dialog.Trigger render={<Button/>}/>`), so this is still ordinary browser
// navigation/prefetch driven by a URL change, not Tabs managing panel visibility itself
// — `Tabs.Root`'s `value` is controlled straight from the server-derived `view` prop
// (updates when the URL round-trips back through page.tsx), with a no-op
// `onValueChange` since selection is never decided client-side.
//
// The cookie write happens in the SAME click that navigates, not a separate server
// action: `fintrack_view` is a non-sensitive UI preference (spec.md Phase 10 trust
// boundary note), and lib/domain/month-params.ts's parseViewParam parses/clamps it
// identically on every read (URL wins; a garbage/tampered cookie value falls back to
// the documented 'agenda' default) — a plain client-side `document.cookie` write is a
// correct, simpler choice than round-tripping through a Server Action just to persist a
// nav click.
export function ViewToggle({ year, month, view }: { year: number; month: number; view: ViewMode }) {
  return (
    <Tabs value={view} onValueChange={() => {}}>
      <TabsList data-testid="view-toggle">
        {VIEWS.map((v) => (
          <TabsTab
            key={v.mode}
            value={v.mode}
            data-testid={`view-toggle-${v.mode}`}
            // Each tab renders as a Link, not a <button> — without this, Base UI warns
            // (dev builds) that a component acting as a button isn't a native one.
            nativeButton={false}
            onClick={() => {
              document.cookie = `fintrack_view=${v.mode};path=/;max-age=31536000`;
            }}
            render={<Link href={`/monthly?year=${year}&month=${month}&view=${v.mode}`} />}
          >
            {v.label}
          </TabsTab>
        ))}
        <TabsIndicator />
      </TabsList>
    </Tabs>
  );
}
