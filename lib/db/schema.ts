import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';

// Phase 1 lays down the full domain model in one migration (every later phase adds
// business logic on top, not new tables — see spec.md's Phase 2 "no new tables"). All
// domain tables are household-scoped via household_id; every domain query must filter
// by it (see spec.md Threat notes — missing household_id filter is a cross-tenant leak).

export const roleEnum = pgEnum('role', ['owner', 'member', 'viewer']);
export const directionEnum = pgEnum('direction', ['income', 'expense']);
export const accountTypeEnum = pgEnum('account_type', ['bank', 'credit']);
export const frequencyEnum = pgEnum('frequency', ['Monthly', 'Quarterly', 'Yearly']);

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull().default('SGD'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    // household_id is the exact column every household-scoped query filters by (member
    // lists, role-change/removal WHERE clauses) — without this, those queries degrade
    // to a full table scan as users accumulate across every household, not just the
    // one being viewed.
    index('users_household_id_idx').on(table.householdId),
  ],
);

// Session id IS the opaque bearer token (32 random bytes, base64url-encoded) — not a
// separate lookup key. See lib/auth/token.ts.
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const householdInvitations = pgTable(
  'household_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    // Opaque bearer token, like sessions.id — same generation helper, own column (not a
    // primary key here since id already serves that role and callers look invites up by
    // id after decoding the URL param, then re-check the token).
    token: text('token').notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('household_invitations_token_unique').on(table.token),
    // Backs createInviteAction's idempotency check atomically: only one UNACCEPTED
    // invite per (household, email) can exist at a time, enforced by Postgres itself
    // via ON CONFLICT, not by a separate SELECT-then-INSERT (which is a TOCTOU race —
    // two concurrent requests can both pass a SELECT check before either INSERT
    // commits). Accepted invites are excluded from the predicate so history/re-invites
    // after removal aren't constrained.
    uniqueIndex('household_invitations_household_email_pending_unique')
      .on(table.householdId, table.email)
      .where(isNull(table.acceptedAt)),
  ],
);

// Kill-switch flags (spec.md Feature Matrix) live here as rows, read per request with an
// in-memory cache — not env vars, so they're toggleable without a redeploy.
export const householdSettings = pgTable(
  'household_settings',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.key] })],
);

// Not in spec.md's original Data Model list — added while implementing Phase 1's
// "per-IP+username rate limit on login" requirement (a simple DB counter, per the phase
// plan). Tracks every login attempt (success or failure) so the rate-limit check can
// query recent failures for a given email+IP pair. See lib/auth/rate-limit.ts.
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    ip: text('ip').notNull(),
    success: boolean('success').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_email_ip_idx').on(table.email, table.ip, table.attemptedAt)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  direction: directionEnum('direction').notNull(),
  color: text('color').notNull().default('#6B7280'),
  sortOrder: integer('sort_order').notNull().default(0),
  monthlyBudget: numeric('monthly_budget', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  accountType: accountTypeEnum('account_type').notNull().default('bank'),
  linkedBankAccountId: uuid('linked_bank_account_id').references(
    (): AnyPgColumn => bankAccounts.id,
    { onDelete: 'set null' },
  ),
  openingBalance: numeric('opening_balance', { precision: 12, scale: 2 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recurringSchedule = pgTable('recurring_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  item: text('item').notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  budgetedAmount: numeric('budgeted_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
    onDelete: 'set null',
  }),
  frequency: frequencyEnum('frequency').notNull().default('Monthly'),
  // Comma-separated month numbers ("1,4,7,10") for Quarterly/Yearly items; null for Monthly.
  scheduleMonths: text('schedule_months'),
  actualDateDay: integer('actual_date_day'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const monthlyEntries = pgTable(
  'monthly_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    recurringScheduleId: uuid('recurring_schedule_id').references(() => recurringSchedule.id, {
      onDelete: 'set null',
    }),
    item: text('item').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    budgetedAmount: numeric('budgeted_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    actualAmount: numeric('actual_amount', { precision: 12, scale: 2 }),
    actualDate: date('actual_date'),
    bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id, {
      onDelete: 'set null',
    }),
    paidByUserId: uuid('paid_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isOverridden: boolean('is_overridden').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // NULL recurring_schedule_id (ad-hoc entries) never collides under Postgres's
    // standard NULL-not-equal-to-NULL uniqueness semantics — many ad-hoc entries per
    // household/year/month are allowed; only one row per actual recurring item is.
    uniqueIndex('monthly_entries_household_year_month_recurring_unique').on(
      table.householdId,
      table.year,
      table.month,
      table.recurringScheduleId,
    ),
    index('monthly_entries_household_year_month_idx').on(
      table.householdId,
      table.year,
      table.month,
    ),
  ],
);

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetAmount: numeric('target_amount', { precision: 12, scale: 2 }).notNull(),
  savedAmount: numeric('saved_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  targetDate: date('target_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
