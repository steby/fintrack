import 'dotenv/config';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { required, formatZodIssues } from '../zod-format';
import { households, users, categories, bankAccounts, recurringSchedule } from './schema';
import { normalizeEmail, emailEquals } from '../auth/email';

// Phase 0 proved the seed *mechanism* (env validation, password hashing, DB
// connectivity, safe-to-re-run) before any domain schema existed. Phase 1 seeded the
// household + owner user once lib/db/schema.ts had real tables. Phase 2 adds
// categories/accounts/recurring items, shaped after the reference FinanceTracker app's
// lib/server/db.ts seed data (same category/account/frequency structure, with fictional
// household-budget figures — this file is committed to a public repo, so no real
// personal or financial data belongs here).
//
// ./schema and drizzle-orm are safe to import statically here (unlike ./index/../log
// below) — schema.ts has no dependency on lib/env.ts, so importing it doesn't trigger
// eager env validation.

interface CategoryDef {
  name: string;
  direction: 'income' | 'expense';
  color: string;
  sortOrder: number;
}

const CATEGORY_DEFS: CategoryDef[] = [
  { name: 'Rental Income', direction: 'income', color: '#10B981', sortOrder: 1 },
  { name: 'Salary', direction: 'income', color: '#06B6D4', sortOrder: 2 },
  { name: 'Housing', direction: 'expense', color: '#F59E0B', sortOrder: 3 },
  { name: 'Education', direction: 'expense', color: '#8B5CF6', sortOrder: 4 },
  { name: 'Transport', direction: 'expense', color: '#EF4444', sortOrder: 5 },
  { name: 'Subscriptions', direction: 'expense', color: '#EC4899', sortOrder: 6 },
  { name: 'Utilities', direction: 'expense', color: '#F97316', sortOrder: 7 },
  { name: 'Tax', direction: 'expense', color: '#6366F1', sortOrder: 8 },
  { name: 'Insurance', direction: 'expense', color: '#14B8A6', sortOrder: 9 },
  { name: 'Other', direction: 'expense', color: '#6B7280', sortOrder: 10 },
];

interface AccountDef {
  name: string;
  accountType: 'bank' | 'credit';
  // References another AccountDef.name in THIS list — resolved after that entry has
  // already been inserted, since ACCOUNT_DEFS below is ordered bank accounts first.
  linkedTo: string | null;
  sortOrder: number;
}

const ACCOUNT_DEFS: AccountDef[] = [
  { name: 'Checking', accountType: 'bank', linkedTo: null, sortOrder: 1 },
  { name: 'Savings', accountType: 'bank', linkedTo: null, sortOrder: 2 },
  { name: 'Joint Account', accountType: 'bank', linkedTo: null, sortOrder: 3 },
  { name: 'Online Bank', accountType: 'bank', linkedTo: null, sortOrder: 4 },
  { name: 'Credit Card', accountType: 'credit', linkedTo: 'Checking', sortOrder: 5 },
];

interface RecurringDef {
  item: string;
  categoryName: string | null;
  budgetedAmount: string;
  accountName: string | null;
  frequency: 'Monthly' | 'Quarterly' | 'Yearly';
  scheduleMonths: string | null;
  actualDateDay: number | null;
}

const RECURRING_DEFS: RecurringDef[] = [
  // Monthly inflows
  {
    item: 'Rent Income',
    categoryName: 'Rental Income',
    budgetedAmount: '2200.00',
    accountName: 'Savings',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 9,
  },
  {
    item: 'Salary',
    categoryName: 'Salary',
    budgetedAmount: '6200.00',
    accountName: 'Checking',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 23,
  },
  {
    item: 'Freelance Income',
    categoryName: 'Salary',
    budgetedAmount: '1800.00',
    accountName: 'Savings',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  // Monthly outflows
  {
    item: 'School Fees',
    categoryName: 'Education',
    budgetedAmount: '850.00',
    accountName: 'Checking',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Mortgage',
    categoryName: 'Housing',
    budgetedAmount: '3200.00',
    accountName: 'Savings',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 2,
  },
  {
    item: 'Car Loan',
    categoryName: 'Transport',
    budgetedAmount: '620.00',
    accountName: 'Checking',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 30,
  },
  {
    item: 'Income Tax',
    categoryName: 'Tax',
    budgetedAmount: '0.00',
    accountName: 'Checking',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 5,
  },
  {
    item: 'Property Tax',
    categoryName: 'Tax',
    budgetedAmount: '0.00',
    accountName: 'Checking',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: 6,
  },
  {
    item: 'Electricity & Water',
    categoryName: 'Utilities',
    budgetedAmount: '320.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Home Broadband',
    categoryName: 'Subscriptions',
    budgetedAmount: '40.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Mobile Plan A',
    categoryName: 'Subscriptions',
    budgetedAmount: '25.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Mobile Plan B',
    categoryName: 'Subscriptions',
    budgetedAmount: '15.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Streaming Service',
    categoryName: 'Subscriptions',
    budgetedAmount: '20.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  {
    item: 'Fuel',
    categoryName: 'Transport',
    budgetedAmount: '60.00',
    accountName: 'Credit Card',
    frequency: 'Monthly',
    scheduleMonths: null,
    actualDateDay: null,
  },
  // Quarterly
  {
    item: 'Condo Maintenance Fees',
    categoryName: 'Housing',
    budgetedAmount: '0.00',
    accountName: null,
    frequency: 'Quarterly',
    scheduleMonths: '1,4,7,10',
    actualDateDay: null,
  },
  // Yearly
  {
    item: 'Life Insurance Premium',
    categoryName: 'Insurance',
    budgetedAmount: '0.00',
    accountName: null,
    frequency: 'Yearly',
    scheduleMonths: '1',
    actualDateDay: null,
  },
  {
    item: 'Car Insurance Premium',
    categoryName: 'Transport',
    budgetedAmount: '0.00',
    accountName: null,
    frequency: 'Yearly',
    scheduleMonths: '6',
    actualDateDay: null,
  },
];

// Idempotent via natural-key checks (household_id + name/item), same pattern as the
// owner upsert below — safe to call on every seed run regardless of whether the
// household was just created or already existed. Runs sequentially (not batched) so
// each step can look up the previous step's inserted/existing id (e.g. Credit Card's
// linkedBankAccountId needs Checking's real id, and recurring items need both category
// and account ids) — household-scale row counts make this negligible.
async function seedHouseholdData(
  db: typeof import('./index').db,
  logger: typeof import('../log').logger,
  householdId: string,
): Promise<void> {
  const categoryIds = new Map<string, string>();
  for (const def of CATEGORY_DEFS) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.name, def.name)))
      .limit(1);
    if (existing) {
      categoryIds.set(def.name, existing.id);
    } else {
      const [inserted] = await db
        .insert(categories)
        .values({
          householdId,
          name: def.name,
          direction: def.direction,
          color: def.color,
          sortOrder: def.sortOrder,
        })
        .returning({ id: categories.id });
      categoryIds.set(def.name, inserted.id);
    }
  }

  const accountIds = new Map<string, string>();
  for (const def of ACCOUNT_DEFS) {
    const [existing] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.householdId, householdId), eq(bankAccounts.name, def.name)))
      .limit(1);
    if (existing) {
      accountIds.set(def.name, existing.id);
    } else {
      const linkedBankAccountId = def.linkedTo ? (accountIds.get(def.linkedTo) ?? null) : null;
      const [inserted] = await db
        .insert(bankAccounts)
        .values({
          householdId,
          name: def.name,
          accountType: def.accountType,
          linkedBankAccountId,
          sortOrder: def.sortOrder,
        })
        .returning({ id: bankAccounts.id });
      accountIds.set(def.name, inserted.id);
    }
  }

  let recurringInserted = 0;
  for (const def of RECURRING_DEFS) {
    const [existing] = await db
      .select({ id: recurringSchedule.id })
      .from(recurringSchedule)
      .where(
        and(eq(recurringSchedule.householdId, householdId), eq(recurringSchedule.item, def.item)),
      )
      .limit(1);
    if (existing) continue;

    await db.insert(recurringSchedule).values({
      householdId,
      item: def.item,
      categoryId: def.categoryName ? (categoryIds.get(def.categoryName) ?? null) : null,
      budgetedAmount: def.budgetedAmount,
      bankAccountId: def.accountName ? (accountIds.get(def.accountName) ?? null) : null,
      frequency: def.frequency,
      scheduleMonths: def.scheduleMonths,
      actualDateDay: def.actualDateDay,
    });
    recurringInserted++;
  }

  logger.info(
    {
      householdId,
      categories: CATEGORY_DEFS.length,
      accounts: ACCOUNT_DEFS.length,
      recurringInserted,
    },
    'Seeded categories, accounts, and recurring items (idempotent — inserted only what was missing).',
  );
}

// Validated locally, straight from process.env — deliberately NOT part of lib/env.ts's
// shared, eagerly-validated schema. Keeping these out of the shared schema means a
// malformed value here can never crash `next dev`/`next build`/`drizzle-kit` (which all
// import that shared schema), only this script. `required()`/`formatZodIssues` are safe
// to import here (unlike anything from lib/env.ts itself) because lib/zod-format.ts is
// pure — it never touches process.env, so importing it doesn't trigger lib/env.ts's
// eager `loadEnv()` call.
const seedEnvSchema = z.object({
  // Normalized so a SEED_OWNER_EMAIL typed/pasted with any uppercase doesn't lock the
  // seeded owner out of their own account the same way the confirmed bug did for
  // invited members — see lib/auth/email.ts.
  SEED_OWNER_EMAIL: z
    .string(required('SEED_OWNER_EMAIL is required'))
    .email('SEED_OWNER_EMAIL must be a valid email address')
    .transform(normalizeEmail),
  SEED_OWNER_PASSWORD: z
    .string(required('SEED_OWNER_PASSWORD is required'))
    .min(1, 'SEED_OWNER_PASSWORD is required'),
});

async function main() {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid seed configuration:\n${formatZodIssues(parsed.error)}\n\n` +
        'See .env.example for the full variable contract.',
    );
  }
  const { SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD } = parsed.data;

  // Dynamically imported *after* the seed-specific check above, so a missing/invalid
  // SEED_OWNER_EMAIL/PASSWORD is reported with this script's own clear message
  // independently of whether the rest of the app's env (SESSION_SECRET, etc. — needed
  // for `./index`'s DB pool, not for seeding itself) is configured yet. Run concurrently
  // since neither import depends on the other's result.
  const [{ pool, db }, { logger }] = await Promise.all([import('./index'), import('../log')]);

  try {
    // Idempotent via a natural-key (email) upsert check, not INSERT ... ON CONFLICT —
    // creating the owner also has to create their household in the same transaction,
    // so "does this owner already exist" is checked explicitly rather than relying on
    // a unique-constraint conflict to short-circuit the insert. Case-insensitive
    // (emailEquals, not eq) so a seed owner row created before normalizeEmail existed
    // is still recognized as "already exists" — a case-sensitive check here would
    // otherwise create a SECOND household+owner pair for the same real person, since
    // idempotency depends entirely on this lookup finding the existing row.
    const existing = await db
      .select({ id: users.id, householdId: users.householdId })
      .from(users)
      .where(emailEquals(users.email, SEED_OWNER_EMAIL))
      .limit(1);

    let householdId: string;
    if (existing[0]) {
      logger.info({ ownerEmail: SEED_OWNER_EMAIL }, 'Seed owner already exists — no changes made.');
      householdId = existing[0].householdId;
    } else {
      const passwordHash = await hash(SEED_OWNER_PASSWORD);
      const household = await db.transaction(async (tx) => {
        const [household] = await tx
          .insert(households)
          .values({ name: 'My Household' })
          .returning();
        await tx.insert(users).values({
          householdId: household.id,
          email: SEED_OWNER_EMAIL,
          passwordHash,
          name: 'Owner',
          role: 'owner',
        });
        return household;
      });
      logger.info({ ownerEmail: SEED_OWNER_EMAIL }, 'Seeded household and owner user.');
      householdId = household.id;
    }

    // Runs regardless of whether the owner/household was just created or already
    // existed — each definition's own natural-key check (inside seedHouseholdData)
    // decides what's actually missing, so this is safe to call on every run.
    await seedHouseholdData(db, logger, householdId);

    await pool.end();
  } catch (err) {
    // The real logger is available here (the dynamic import above already succeeded),
    // so failures after that point — DB unreachable, hashing failure, etc. — get proper
    // structured logging with a stack trace, not just a bare message.
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  }
}

main().catch((err) => {
  // Only reachable for failures *before* the dynamic imports above succeed — i.e. the
  // seed-config validation throw — since the real logger isn't available yet at that
  // point. Deliberately console.error, not the pino logger, for that reason.
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
