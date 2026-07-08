import { describe, expect, it } from 'vitest';

// Deliberately failing — proves the CI unit-test gate actually blocks a red build.
// Removed in the very next commit. See PROGRESS.md Phase 0 entry.
describe('adversarial CI gate check', () => {
  it('is intentionally false to verify CI fails on a broken test', () => {
    expect(1).toBe(2);
  });
});
