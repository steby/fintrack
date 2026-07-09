import Link from 'next/link';
import { requireUser } from '../../lib/auth/guards';
import { can } from '../../lib/auth/rbac';
import { logoutAction } from '../actions/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { YearNav } from './year-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r p-4">
        <div className="flex items-center justify-between">
          <div className="font-heading text-lg font-semibold">FinTrack</div>
          <ThemeToggle />
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Dashboard
          </Link>
          <Link href="/recurring" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Recurring
          </Link>
          <Link href="/monthly" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Monthly
          </Link>
          {/* Always shown, even with FEATURE_SAVINGS_GOALS off — goals/page.tsx renders
              a delete-only view of existing goals in that state (an owner who disables
              the feature still needs to be able to remove old data), so hiding this
              link would make that page undiscoverable except by bookmarked URL. */}
          <Link href="/goals" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Goals
          </Link>
          {/* csv_import is a per-household runtime kill-switch (default off), not a
              build-time env flag like FEATURE_SAVINGS_GOALS above — this link always
              shows so a member can discover the feature and ask an owner to enable it;
              /import itself checks the flag server-side and explains when it's off. */}
          <Link href="/import" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Import
          </Link>
          <Link href="/settings/categories" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Categories &amp; Accounts
          </Link>
          {can(user.role, 'manage_members') && (
            <Link href="/settings/members" className="rounded-md px-2 py-1.5 hover:bg-muted">
              Members
            </Link>
          )}
          <Link href="/settings/data" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Data
          </Link>
          <Link href="/settings/account" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Account
          </Link>
        </nav>
        <YearNav />
        <div className="mt-auto flex flex-col gap-2 text-sm">
          <div className="text-muted-foreground">
            {user.name} &middot; <span className="capitalize">{user.role}</span>
          </div>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
