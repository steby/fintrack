import { randomBytes, createHash } from 'crypto';

// 32 random bytes, base64url-encoded (43 chars, URL-safe, no padding) — used as both the
// session id and the invite token (spec.md: "opaque 32-byte token"). 256 bits of entropy
// makes guessing infeasible; the token itself IS the credential, not a lookup key paired
// with a separate secret.
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// Sessions store ONLY this hash as their row id — the raw token lives exclusively in
// the user's cookie, so read access to the DB (a leaked connection string, a backup)
// can't be replayed as a session cookie. Plain SHA-256, no salt/stretching: unlike a
// password, the input already carries 256 bits of entropy, so there's nothing for a
// precomputation attack to enumerate — and determinism is required anyway (the hash IS
// the lookup key).
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
