import { hash, verify } from '@node-rs/argon2';

// NIST 800-63B: prefer length over forced complexity rules, no rotation requirement.
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidation = { valid: true } | { valid: false; message: string };

export function validatePassword(password: string): PasswordValidation {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed/foreign hash string throws rather than returning false — treat that
    // as a failed verification, not a crash (login must never 500 on a corrupt row).
    return false;
  }
}

// A fixed, valid argon2 hash of an arbitrary password that no real account has — used
// as the comparison target when a login is attempted against an email that doesn't
// exist, so that path takes the same time (a real argon2 verify) as the "email exists,
// wrong password" path. Without this, a nonexistent email returns near-instantly while
// an existing one pays argon2's real cost, letting an attacker enumerate valid emails
// purely from response latency even though both paths return an identical error
// message. The hash itself has no significance beyond being a valid, unguessable
// target — it doesn't correspond to any account's real password.
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$8RDkbXjmGGhurt5QtwzrxQ$4C/kgRjYEUfTK5qLyRHZ84rP8h2sbyT9patxLhDoOjY';
