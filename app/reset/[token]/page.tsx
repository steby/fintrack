import { ResetPasswordForm } from './reset-password-form';

// The token param is consumed by resetPasswordAction, which is the sole validator —
// this page renders the form for ANY token shape (an invalid one just gets the generic
// error on submit), so there's no separate render-time validation to keep in sync.
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
