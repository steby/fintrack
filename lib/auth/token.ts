import { randomBytes } from 'crypto';

// 32 random bytes, base64url-encoded (43 chars, URL-safe, no padding) — used as both the
// session id and the invite token (spec.md: "opaque 32-byte token"). 256 bits of entropy
// makes guessing infeasible; the token itself IS the credential, not a lookup key paired
// with a separate secret.
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
