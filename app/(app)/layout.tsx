import Link from 'next/link';
import { requireUser } from '../../lib/auth/guards';
import { can } from '../../lib/auth/rbac';
import { logoutAction } from '../actions/auth';
import { Button } from '@/components/ui/button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r p-4">
        <div className="font-heading text-lg font-semibold">FinTrack</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Dashboard
          </Link>
          {can(user.role, 'manage_members') && (
            <Link href="/settings/members" className="rounded-md px-2 py-1.5 hover:bg-muted">
              Members
            </Link>
          )}
          <Link href="/settings/account" className="rounded-md px-2 py-1.5 hover:bg-muted">
            Account
          </Link>
        </nav>
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
