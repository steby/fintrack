export type Role = 'owner' | 'member' | 'viewer';
export type Action = 'read' | 'write' | 'manage_members' | 'manage_settings';

// owner > member > viewer. Viewers are read-only everywhere (spec.md: "Primary usage:
// owner does all data entry; family mostly views"); only owners manage membership and
// kill-switch settings (spec.md Phase 6: notification toggles are "owner-only").
const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(['read', 'write', 'manage_members', 'manage_settings']),
  member: new Set(['read', 'write']),
  viewer: new Set(['read']),
};

export function can(role: Role, action: Action): boolean {
  // eslint-plugin-security flags this as generic object injection, but `role` is
  // narrowed to the 3-value Role union at compile time (not arbitrary/untrusted input
  // reaching this line) — every real caller's role value comes from a DB column typed
  // as the same pgEnum, never from unvalidated request data directly.
  // eslint-disable-next-line security/detect-object-injection
  return MATRIX[role].has(action);
}
