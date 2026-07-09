import { eq } from 'drizzle-orm';
import { requireUser } from '../../../../lib/auth/guards';
import { can } from '../../../../lib/auth/rbac';
import { db } from '../../../../lib/db';
import { users } from '../../../../lib/db/schema';
import { isEnabled } from '../../../../lib/flags';
import {
  toggleEmailRemindersAction,
  toggleMonthlyRecapAction,
} from '../../../actions/notifications';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { NotificationToggle } from './notification-toggle';
import { MemberNotifyRow } from './member-notify-row';
import { SendTestEmailButton } from './send-test-email-button';

export default async function NotificationsSettingsPage() {
  const user = await requireUser();
  const canManage = can(user.role, 'manage_settings');

  const [emailRemindersOn, monthlyRecapOn, members] = await Promise.all([
    isEnabled(user.householdId, 'email_reminders'),
    isEnabled(user.householdId, 'monthly_recap'),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        notifyByEmail: users.notifyByEmail,
      })
      .from(users)
      .where(eq(users.householdId, user.householdId)),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bill reminders and monthly recap emails (spec.md Phase 6). Off by default — an owner turns
          each on, and each member separately opts in to actually receive them.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Household settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <NotificationToggle
            action={toggleEmailRemindersAction}
            enabled={emailRemindersOn}
            label="Bill reminders"
            description="Daily digest of bills due within 3 days, for anyone opted in below."
            readOnly={!canManage}
          />
          <NotificationToggle
            action={toggleMonthlyRecapAction}
            enabled={monthlyRecapOn}
            label="Monthly recap"
            description="Summary email after each month closes, for anyone opted in below."
            readOnly={!canManage}
          />
          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Only the household owner can turn these on or off.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberNotifyRow key={member.id} member={member} isSelf={member.id === user.id} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test</CardTitle>
        </CardHeader>
        <CardContent>
          <SendTestEmailButton />
        </CardContent>
      </Card>
    </div>
  );
}
