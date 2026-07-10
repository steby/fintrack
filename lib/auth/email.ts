import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Single canonical email-normalization point (confirmed bug: case-sensitive handling
// everywhere — login lookup, invite duplicate check, users_email_unique — meant a user
// created via a mixed-case invite ("Bob@Gmail.com") couldn't log in typing the
// lowercase form of their own address, and the same mailbox could be invited/register
// twice under different casing). Every WRITE to users.email/household_invitations.email
// goes through this so all data stored going forward is consistently lowercase; see
// emailEquals below for how any pre-existing (pre-fix, however unlikely) mixed-case row
// is still found correctly without a data migration.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Case-insensitive email lookup — used at every READ boundary (login, invite duplicate
// checks) instead of drizzle-orm's eq(), so a row stored before normalizeEmail existed
// (or any future bug that slips a mixed-case value past it) is still found correctly,
// with no data migration required. `email` is normalized here too, so callers can pass
// the raw user-submitted value directly. The lower() call on both sides means this
// can't use a plain btree index on the raw column — acceptable at household scale (a
// handful of users/invites per household, not a large table; spec.md's Tier-2 scope).
export function emailEquals(column: AnyPgColumn, email: string): SQL {
  return sql`lower(${column}) = ${normalizeEmail(email)}`;
}
