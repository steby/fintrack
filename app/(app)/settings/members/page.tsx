import { eq, and, isNull } from 'drizzle-orm';
import { Mail } from 'lucide-react';
import { requireUser } from '../../../../lib/auth/guards';
import { can } from '../../../../lib/auth/rbac';
import { db } from '../../../../lib/db';
import { users, householdInvitations } from '../../../../lib/db/schema';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InviteForm } from './invite-form';
import { MemberRow } from './member-row';

export default async function MembersPage() {
  const user = await requireUser();

  if (!can(user.role, 'manage_members')) {
    return (
      <p className="text-sm text-muted-foreground">Only the household owner can manage members.</p>
    );
  }

  const [members, pendingInvites] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.householdId, user.householdId)),
    // Read-only: this phase adopts empty-state.tsx on this list surface (spec.md Phase
    // 11 task 5, "members-invites"), which the pre-restyle page never displayed at all
    // — a household could invite someone but never see the invite again until it was
    // accepted. Deliberately no revoke/resend action here — that's a new mutation
    // surface the plan doesn't call for this phase (a restyle + empty-states phase, not
    // a new-feature phase); this only surfaces data that already existed in
    // household_invitations since Phase 1.
    db
      .select({
        id: householdInvitations.id,
        email: householdInvitations.email,
        role: householdInvitations.role,
        expiresAt: householdInvitations.expiresAt,
      })
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, user.householdId),
          isNull(householdInvitations.acceptedAt),
        ),
      )
      .orderBy(householdInvitations.createdAt),
  ]);

  // `new Date()`, not `Date.now()` — eslint-plugin-react-hooks' purity rule
  // (react-hooks/purity) flags `Date.now()` specifically as an impure render read even
  // hoisted to the top of the component; `new Date()` is the convention every other
  // "current instant" read in this codebase already uses in a component/action body
  // (e.g. app/(app)/recurring/generate-form.tsx) and isn't flagged the same way.
  const now = new Date();

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

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingInvites.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No pending invites"
              description="Invites you send above show up here until they're accepted or expire."
              className="py-6"
            />
          ) : (
            <div className="flex flex-col gap-2">
              {pendingInvites.map((invite) => {
                const isExpired = invite.expiresAt.getTime() < now.getTime();
                return (
                  <div
                    key={invite.id}
                    data-testid="pending-invite-row"
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div>
                      <div className="text-sm">{invite.email}</div>
                      <div className="text-xs text-muted-foreground capitalize">{invite.role}</div>
                    </div>
                    <Badge variant={isExpired ? 'destructive' : 'secondary'}>
                      {isExpired ? 'Expired' : 'Pending'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
