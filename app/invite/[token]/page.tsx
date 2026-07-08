import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { householdInvitations } from '../../../lib/db/schema';
import { validateInvite } from '../../../lib/auth/invite-rules';
import { AcceptInviteForm } from './accept-form';

function InviteError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const rows = await db
    .select()
    .from(householdInvitations)
    .where(eq(householdInvitations.token, token))
    .limit(1);
  const invitation = rows[0];

  if (!invitation) {
    return <InviteError message="This invite link is invalid." />;
  }

  const result = validateInvite(invitation, token);
  if (!result.valid) {
    const messages: Record<typeof result.reason, string> = {
      token_mismatch: 'This invite link is invalid.',
      already_accepted: 'This invite has already been used.',
      expired: 'This invite link has expired. Ask the household owner to send a new one.',
    };
    return <InviteError message={messages[result.reason]} />;
  }

  return <AcceptInviteForm token={token} email={invitation.email} role={invitation.role} />;
}
