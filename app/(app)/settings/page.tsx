import Link from 'next/link';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { logoutAction } from '../../actions/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { YearNav } from '../year-nav';

// The sidebar in app/(app)/layout.tsx already links every one of these pages directly
// and is always visible at md+, so a desktop user never needs this hub. It exists for
// the mobile bottom nav's "More" tab (app/(app)/bottom-nav.tsx): the sidebar is hidden
// below md, so this is the only reachable landing spot for settings, import, sign-out,
// theme, and (below) the dashboard year quick-jump — everything that didn't fit as its
// own bottom-nav tab or that the sidebar carried but BottomNav's 5 tabs don't.
export default async function SettingsHubPage() {
  const user = await requireUser();

  const links = [
    { href: '/settings/categories', label: 'Categories & Accounts' },
    { href: '/import', label: 'Import' },
    ...(can(user.role, 'manage_members') ? [{ href: '/settings/members', label: 'Members' }] : []),
    { href: '/settings/data', label: 'Data' },
    { href: '/settings/notifications', label: 'Notifications' },
    { href: '/settings/account', label: 'Account' },
  ];

  return (
    <div className="flex flex-col gap-6 pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            {user.name} &middot; <span className="capitalize">{user.role}</span>
          </p>
        </div>
        <ThemeToggle />
      </div>

      {/* md:hidden: the sidebar (app/(app)/layout.tsx) renders its own <YearNav />
          unconditionally on every (app) route, including this one — only CSS-hidden
          below md, not removed from the DOM. Without this wrapper, a desktop-width
          visit to /settings shows the "Dashboard year" widget twice (verified: without
          it, page.getByTestId('year-nav-link').count() returns 6, not 3, on this
          route). Both copies remain in the DOM regardless of viewport either way — a
          future test targeting year-nav-link on THIS route specifically should scope
          the locator to a container (this wrapper or the sidebar's <aside>), not use a
          bare page.getByTestId(), or it will hit a Playwright strict-mode violation. */}
      <div className="md:hidden">
        <YearNav />
      </div>

      <nav className="flex flex-col divide-y rounded-md border">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-14 items-center px-4 text-sm hover:bg-muted"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <form action={logoutAction}>
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
