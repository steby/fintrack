'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, loginAttempts } from '../../lib/db/schema';
import { verifyPassword, hashPassword, validatePassword } from '../../lib/auth/password';
import { createSession, deleteSession } from '../../lib/auth/session';
import { isRateLimited, LOGIN_RATE_LIMIT_WINDOW_MS } from '../../lib/auth/rate-limit';
import { requireUser } from '../../lib/auth/guards';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string } | undefined;

async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  // Vercel sets x-forwarded-for; local dev has no proxy in front, so it's absent there
  // — rate-limiting still works locally, just keyed on one shared bucket.
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and password.' };
  }
  const { email, password } = parsed.data;
  const ip = await getClientIp();

  const recentAttempts = await db
    .select({ attemptedAt: loginAttempts.attemptedAt, success: loginAttempts.success })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.ip, ip),
        gte(loginAttempts.attemptedAt, new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS)),
      ),
    );

  if (isRateLimited(recentAttempts)) {
    return { error: 'Too many attempts. Try again in a few minutes.' };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Same generic message either way — never reveal whether the email exists (spec.md
  // threat notes call out takeover/enumeration risk on the auth surface generally).
  const genericError: LoginState = { error: 'Invalid email or password.' };

  if (!user) {
    await db.insert(loginAttempts).values({ email, ip, success: false });
    return genericError;
  }

  const validPassword = await verifyPassword(user.passwordHash, password);
  await db.insert(loginAttempts).values({ email, ip, success: validPassword });

  if (!validPassword) {
    return genericError;
  }

  await createSession(user.id);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await deleteSession();
  redirect('/login');
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string(),
});

export type ChangePasswordState = { error?: string; success?: boolean } | undefined;

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) {
    return { error: 'Both fields are required.' };
  }

  const validation = validatePassword(parsed.data.newPassword);
  if (!validation.valid) {
    return { error: validation.message };
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const dbUser = rows[0];
  if (!dbUser) {
    return { error: 'Something went wrong. Try again.' };
  }

  const validCurrent = await verifyPassword(dbUser.passwordHash, parsed.data.currentPassword);
  if (!validCurrent) {
    return { error: 'Current password is incorrect.' };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

  return { success: true };
}
