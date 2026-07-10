import { describe, expect, it } from 'vitest';
import { createAutoGenerateGuard } from './auto-generate-guard';

describe('createAutoGenerateGuard', () => {
  it('allows the run for a household never seen before', () => {
    const guard = createAutoGenerateGuard(60_000);
    expect(guard.shouldRun('household-a', new Date('2026-01-01T00:00:00Z'))).toBe(true);
  });

  it('blocks a re-run for the same household within the TTL', () => {
    const guard = createAutoGenerateGuard(60_000);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    guard.recordRun('household-a', t0);

    const t1 = new Date(t0.getTime() + 30_000); // 30s later, still inside a 60s TTL
    expect(guard.shouldRun('household-a', t1)).toBe(false);
  });

  it('allows a re-run once the TTL has elapsed', () => {
    const guard = createAutoGenerateGuard(60_000);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    guard.recordRun('household-a', t0);

    const t1 = new Date(t0.getTime() + 60_001); // just past the 60s TTL
    expect(guard.shouldRun('household-a', t1)).toBe(true);
  });

  it('treats the TTL boundary itself as still-blocked (not yet strictly elapsed)', () => {
    const guard = createAutoGenerateGuard(60_000);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    guard.recordRun('household-a', t0);

    const atBoundary = new Date(t0.getTime() + 60_000); // exactly the TTL, not past it
    expect(guard.shouldRun('household-a', atBoundary)).toBe(false);
  });

  it('scopes the guard independently per household — recording one never blocks another', () => {
    const guard = createAutoGenerateGuard(60_000);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    guard.recordRun('household-a', t0);

    expect(guard.shouldRun('household-b', t0)).toBe(true);
  });

  it('a later recordRun call moves the TTL window forward', () => {
    const guard = createAutoGenerateGuard(60_000);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    guard.recordRun('household-a', t0);

    const t1 = new Date(t0.getTime() + 50_000);
    guard.recordRun('household-a', t1); // re-recorded before the first TTL expired

    const t2 = new Date(t1.getTime() + 30_000); // 30s after the SECOND record, 80s after the first
    // Still blocked — the guard should measure from the latest recordRun, not the first.
    expect(guard.shouldRun('household-a', t2)).toBe(false);
  });

  it('two independently created guards never share state', () => {
    const guardA = createAutoGenerateGuard(60_000);
    const guardB = createAutoGenerateGuard(60_000);
    const now = new Date('2026-01-01T00:00:00.000Z');

    guardA.recordRun('household-a', now);
    expect(guardB.shouldRun('household-a', now)).toBe(true);
  });
});
