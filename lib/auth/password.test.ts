import { describe, expect, it } from 'vitest';
import { validatePassword, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './password';

describe('validatePassword', () => {
  it('rejects a password shorter than the minimum length', () => {
    const result = validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.valid).toBe(false);
  });

  it('accepts a password at exactly the minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toEqual({ valid: true });
  });

  it('accepts a long password with no complexity requirements', () => {
    expect(validatePassword('just some plain words as a passphrase')).toEqual({ valid: true });
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips: a hashed password verifies against its original plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('produces a different hash for the same password on each call (random salt)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);
    expect(a).not.toBe(b);
  });

  it('returns false (not a throw) for a malformed/foreign hash string', async () => {
    await expect(verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });
});
