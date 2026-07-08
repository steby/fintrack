import { eq } from 'drizzle-orm';
import { requireUser } from '../../../../lib/auth/guards';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { InviteForm } from './invite-form';
import { MemberRow } from './member-row';

export default async function MembersPage() {
  const user = await requireUser();

  if (user.role !== 'owner') {
    return (
      <p className="text-sm text-muted-foreground">Only the household owner can manage members.</p>
    );
  }

  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.householdId, user.householdId));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Household members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite family members and manage their access.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} isSelf={m.id === user.id} />
        ))}
      </div>

      <InviteForm />
    </div>
  );
}
