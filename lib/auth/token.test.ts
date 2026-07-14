import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './token';

describe('hashToken', () => {
  it('is deterministic — same token, same hash', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces 64 lowercase hex chars (SHA-256)', () => {
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinct tokens produce distinct hashes, never equal to their input', () => {
    const a = generateToken();
    const b = generateToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toBe(a);
  });
});

describe('generateToken', () => {
  it('produces a URL-safe string with no padding characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
  });

  it('produces 256 bits of entropy (43 base64url chars for 32 bytes)', () => {
    expect(generateToken()).toHaveLength(43);
  });

  it('never produces the same token twice across many calls', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
  });
});
