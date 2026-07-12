import { requireUser } from '../../../../lib/auth/guards';
import { UpdateNameForm } from './update-name-form';
import { ChangePasswordForm } from './change-password-form';

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      </div>

      <UpdateNameForm currentName={user.name} />
      <ChangePasswordForm />
    </div>
  );
}
