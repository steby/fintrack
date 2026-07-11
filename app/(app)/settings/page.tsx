import Link from 'next/link';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { logoutAction } from '../../actions/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

// The sidebar in app/(app)/layout.tsx collapses to ONE "Settings" entry (Phase 8's IA
// rework) and is always visible at md+, so this hub is now the desktop landing spot too
// — not just the mobile "More" tab's destination as it was pre-Phase-8. Plan and
// Insights get their own sidebar entries already, so their links here are mobile-only
// (md:hidden) escape hatches for the bottom nav's condensed 5-tab set, which has no room
// for either.
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

      {/* md:hidden: the desktop sidebar already has dedicated Plan/Insights entries
          (app/(app)/layout.tsx); the bottom nav's 5 tabs don't have room for either, so
          this hub is their only mobile landing spot. */}
      <nav className="flex flex-col divide-y rounded-2xl border md:hidden">
        <Link href="/recurring" className="flex min-h-14 items-center px-4 text-sm hover:bg-muted">
          Plan
        </Link>
        <Link href="/insights" className="flex min-h-14 items-center px-4 text-sm hover:bg-muted">
          Insights
        </Link>
      </nav>

      <nav className="flex flex-col divide-y rounded-2xl border">
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
