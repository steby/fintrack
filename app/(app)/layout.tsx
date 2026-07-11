import {
  Home,
  Calendar,
  Repeat,
  Wallet,
  Target,
  ChartPie,
  Settings as SettingsIcon,
} from 'lucide-react';
import { requireUser } from '../../lib/auth/guards';
import { logoutAction } from '../actions/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavLink } from './nav-link';
import { BottomNav } from './bottom-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      {/* md:hidden below — BottomNav (mobile-only) is this sidebar's replacement below
          the md breakpoint, not an addition alongside it; see bottom-nav.tsx. */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="px-1 text-lg font-semibold text-sidebar-foreground">FinTrack</div>

        {/* "Track" — the day-to-day surfaces (what's due, where money went). */}
        <nav className="flex flex-col gap-1">
          <div className="px-2.5 text-xs font-semibold tracking-wide text-sidebar-foreground/50 uppercase">
            Track
          </div>
          <NavLink href="/" label="Home" icon={<Home className="size-4 shrink-0" />} />
          <NavLink
            href="/monthly"
            label="Money"
            icon={<Calendar className="size-4 shrink-0" />}
            matchPrefix
          />
          <NavLink
            href="/recurring"
            label="Plan"
            icon={<Repeat className="size-4 shrink-0" />}
            matchPrefix
          />
        </nav>

        {/* "Grow" — the slower-moving surfaces (balances over time, goals, analytics). */}
        <nav className="flex flex-col gap-1">
          <div className="px-2.5 text-xs font-semibold tracking-wide text-sidebar-foreground/50 uppercase">
            Grow
          </div>
          <NavLink
            href="/accounts"
            label="Net worth"
            icon={<Wallet className="size-4 shrink-0" />}
            matchPrefix
          />
          {/* Always shown, even with FEATURE_SAVINGS_GOALS off — goals/page.tsx renders
              a delete-only view of existing goals in that state (an owner who disables
              the feature still needs to be able to remove old data), so hiding this
              link would make that page undiscoverable except by bookmarked URL. */}
          <NavLink
            href="/goals"
            label="Goals"
            icon={<Target className="size-4 shrink-0" />}
            matchPrefix
          />
          <NavLink
            href="/insights"
            label="Insights"
            icon={<ChartPie className="size-4 shrink-0" />}
            matchPrefix
          />
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <nav className="flex flex-col gap-1">
            {/* Covers /import too — Import lives under Settings > Data in the new IA
                (task 7) without being nested at /settings/import; csv_import is a
                per-household runtime kill-switch (default off), so the link always
                shows and /settings/data explains/links it, /import itself explains
                when the switch is off. Members stays gated behind can(...,
                'manage_members') — same rule as before, just re-homed under one entry. */}
            <NavLink
              href="/settings"
              label="Settings"
              icon={<SettingsIcon className="size-4 shrink-0" />}
              matchPrefix
              extraPrefixes={['/import']}
            />
          </nav>
          <div className="flex items-center justify-between gap-2 border-t border-sidebar-border pt-3 text-sm">
            <div className="min-w-0 truncate text-sidebar-foreground/70">
              {user.name} &middot; <span className="capitalize">{user.role}</span>
            </div>
            <ThemeToggle />
          </div>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      {/* min-w-0 overrides a flex item's default min-width:auto — without it, a wide
          descendant (e.g. calendar-view.tsx's min-w-[800px] grid) forces this whole
          flex item to grow past the viewport instead of scrolling internally via its
          own overflow-x-auto wrapper, which on mobile expands the layout viewport
          itself and breaks BottomNav's position:fixed (it ends up pinned to the
          bottom of the oversized page, not the visible screen). */}
      <main className="min-w-0 flex-1 p-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
