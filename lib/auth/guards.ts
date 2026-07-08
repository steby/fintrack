import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './session';
import { can, type Action } from './rbac';

// For use in Server Components/pages: redirects to /login if there's no valid session.
// proxy.ts already does this check optimistically before the page even renders, but
// per Next's own guidance, "Server Actions and page components must perform their own
// authorization checks" — this is the real (not just optimistic) check.
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

// Thrown (not redirected) by requireRole — a Server Action handling a rejected mutation
// should surface a form error, not silently navigate the user away.
export class ForbiddenError extends Error {
  constructor() {
    super('You do not have permission to perform this action.');
    this.name = 'ForbiddenError';
  }
}

// For use in Server Actions/mutations: requires both a valid session AND that the
// user's role permits the given action (spec.md: "viewer mutation attempts rejected
// server-side" — this is that server-side enforcement, independent of any client-side
// UI hiding).
export async function requireRole(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, action)) {
    throw new ForbiddenError();
  }
  return user;
}
