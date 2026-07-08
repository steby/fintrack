import { describe, expect, it } from 'vitest';
import { generateToken } from './token';

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
