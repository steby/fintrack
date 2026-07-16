import { describe, expect, it } from 'vitest';
import { uuidOrEmpty, dateInputSchema } from './validation';

describe('uuidOrEmpty', () => {
  it('accepts a real UUID, the empty string, and absence', () => {
    expect(uuidOrEmpty.safeParse('4f6c6e0a-58de-4a67-9a0c-8c1a2b3c4d5e').success).toBe(true);
    expect(uuidOrEmpty.safeParse('').success).toBe(true);
    expect(uuidOrEmpty.safeParse(undefined).success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(uuidOrEmpty.safeParse('not-a-uuid').success).toBe(false);
    expect(uuidOrEmpty.safeParse('123').success).toBe(false);
  });
});

describe('dateInputSchema', () => {
  it('accepts a real date and the empty string ("no date")', () => {
    expect(dateInputSchema.safeParse('2026-07-17').success).toBe(true);
    expect(dateInputSchema.safeParse('').success).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(dateInputSchema.safeParse('not-a-date').success).toBe(false);
    expect(dateInputSchema.safeParse('17/07/2026').success).toBe(false);
  });

  it('rejects a shape-valid but nonexistent calendar date (Postgres would roll it over)', () => {
    expect(dateInputSchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateInputSchema.safeParse('2026-13-01').success).toBe(false);
  });
});
