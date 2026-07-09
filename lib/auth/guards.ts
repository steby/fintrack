import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './session';
import { can, type Action } from './rbac';
import { isEnabled, type KillSwitchKey } from '../flags';

// For use in Server Components/pages: redirects to /login if there's no valid session.
// proxy.ts already does a real, DB-backed check of its own before the page even
// renders, but per Next's own guidance, "Server Actions and page components must
// perform their own authorization checks" regardless — this is that independent check,
// defense-in-depth against a future matcher change or moved route silently dropping
// proxy.ts's coverage, not a stronger version of a weaker check proxy.ts does.
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

// Config flags (env-var-backed, sync — spec.md Feature Matrix: category_budgets,
// savings_goals, net_worth, entry_attribution, pwa; a flip requires a redeploy).
// Returns a user-facing error string rather than throwing, matching how every Server
// Action already surfaces a rejected requireRole check as a form error, not an
// uncaught exception. The caller still decides WHEN to check (e.g. categories.ts only
// gates a write that actually touches monthlyBudget, not every category edit) — this
// only standardizes the "flag off -> error string" translation itself, which four
// independently-shaped call sites had each been reimplementing.
export function requireConfigFlag(enabled: boolean, message: string): string | null {
  return enabled ? null : message;
}

// Kill-switches (household_settings-backed via lib/flags.ts's isEnabled, async,
// runtime-toggleable without a redeploy — spec.md Feature Matrix: auto_generate,
// csv_import, email_reminders, monthly_recap). Same "return an error string" contract
// as requireConfigFlag, so a Server Action gates a feature the same way regardless of
// which kind of flag it is.
export async function requireKillSwitch(
  householdId: string,
  flag: KillSwitchKey,
  message: string,
): Promise<string | null> {
  return (await isEnabled(householdId, flag)) ? null : message;
}
