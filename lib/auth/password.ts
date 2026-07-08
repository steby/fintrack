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
