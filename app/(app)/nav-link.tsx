'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface NavLinkProps {
  href: string;
  label: string;
  // A rendered icon element (e.g. <Home className="size-4" />), not a component
  // reference — a Server Component (app/(app)/layout.tsx) can pass an already-rendered
  // ReactNode across the server/client boundary to a Client Component, but NOT a bare
  // function/component reference (React throws "Functions cannot be passed directly to
  // Client Components" at render time; caught live via a full E2E run, not just a type
  // error — TypeScript alone doesn't know this constraint).
  icon: ReactNode;
  // Defaults to exact-match; pass true for sections with sub-routes (e.g. /monthly's
  // list/calendar/agenda views all count as "on this link") so the active state doesn't
  // only light up on the bare segment root.
  matchPrefix?: boolean;
  // Escape hatch for links that also cover a route outside their own href (Settings
  // covers /import too — Import lives under the Settings/Data section in the new IA
  // without literally being nested at /settings/import). Plain strings only, for the
  // same server/client-boundary reason `icon` is a ReactNode and not a function above —
  // an isActive(pathname) callback prop would hit the identical "functions can't cross
  // the boundary" error.
  extraPrefixes?: string[];
}

// Client-only piece of an otherwise server-rendered sidebar (app/(app)/layout.tsx) —
// usePathname needs the client, but the rest of the shell (user role checks, the
// sign-out form) has no reason to ship as client JS. Kept intentionally tiny.
export function NavLink({ href, label, icon, matchPrefix = false, extraPrefixes }: NavLinkProps) {
  const pathname = usePathname();
  const active =
    (matchPrefix ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href) ||
    (extraPrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ??
      false);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
