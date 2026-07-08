import { requireUser } from '../../lib/auth/guards';

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mt-2 text-muted-foreground">
        The real dashboard (budgets, recurring items, monthly entries) lands in later phases. Phase
        1 proves auth, sessions, and household sharing work end to end.
      </p>
    </div>
  );
}
