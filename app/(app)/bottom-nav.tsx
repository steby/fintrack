'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Repeat, Target, Menu } from 'lucide-react';
import type { ComponentType } from 'react';

// Deliberately a separate, hand-written list from the sidebar's <Link> list
// (app/(app)/layout.tsx) and the settings hub's `links` array
// (app/(app)/settings/page.tsx), not a single shared source of truth — the three
// aren't 1:1 duplicates (full desktop sidebar vs. this condensed 5-tab set vs. the
// hub's "everything else" leftovers), and this project's own established convention
// (see PROGRESS.md) tolerates small, non-mechanical duplication like this over a
// speculative shared-nav-model abstraction. Adding a page: remember it needs a home on
// at least one of the three surfaces, or it becomes unreachable on mobile/desktop.
const TABS: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: (pathname: string) => boolean;
}[] = [
  { href: '/', label: 'Dashboard', icon: Home, isActive: (p) => p === '/' },
  { href: '/monthly', label: 'Monthly', icon: Calendar, isActive: (p) => p.startsWith('/monthly') },
  {
    href: '/recurring',
    label: 'Recurring',
    icon: Repeat,
    isActive: (p) => p.startsWith('/recurring'),
  },
  { href: '/goals', label: 'Goals', icon: Target, isActive: (p) => p.startsWith('/goals') },
  {
    href: '/settings',
    label: 'More',
    icon: Menu,
    isActive: (p) => p.startsWith('/settings') || p.startsWith('/import'),
  },
];

// Mobile-only (md:hidden — see AppLayout): the sidebar in app/(app)/layout.tsx is the
// primary nav at md+ and is hidden below that breakpoint, so this is the only way to
// move between sections on a phone. Fixed to the viewport bottom, not part of normal
// document flow — AppLayout adds matching bottom padding to <main> so page content
// never sits underneath it.
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      {TABS.map(({ href, label, icon: Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.65rem] ${
              active ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Icon className={active ? 'size-5' : 'size-5 opacity-80'} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
