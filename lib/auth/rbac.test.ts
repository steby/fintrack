import { describe, expect, it } from 'vitest';
import { can, type Action, type Role } from './rbac';

const ALL_ACTIONS: Action[] = ['read', 'write', 'manage_members', 'manage_settings'];

describe('can', () => {
  it('owner can do everything', () => {
    for (const action of ALL_ACTIONS) {
      expect(can('owner', action)).toBe(true);
    }
  });

  it('member can read and write but not manage members or settings', () => {
    expect(can('member', 'read')).toBe(true);
    expect(can('member', 'write')).toBe(true);
    expect(can('member', 'manage_members')).toBe(false);
    expect(can('member', 'manage_settings')).toBe(false);
  });

  it('viewer can only read — every mutation is denied', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'write')).toBe(false);
    expect(can('viewer', 'manage_members')).toBe(false);
    expect(can('viewer', 'manage_settings')).toBe(false);
  });

  it('no role can escalate itself into an action outside its matrix (exhaustive check)', () => {
    const expected: Record<Role, Action[]> = {
      owner: ['read', 'write', 'manage_members', 'manage_settings'],
      member: ['read', 'write'],
      viewer: ['read'],
    };
    for (const role of Object.keys(expected) as Role[]) {
      for (const action of ALL_ACTIONS) {
        // eslint-disable-next-line security/detect-object-injection -- role is Role-typed, not arbitrary input
        expect(can(role, action)).toBe(expected[role].includes(action));
      }
    }
  });
});
