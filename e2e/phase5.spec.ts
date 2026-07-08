import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, and, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import {
  categories,
  bankAccounts,
  monthlyEntries,
  householdSettings,
  users,
} from '../lib/db/schema';
import { MAX_CSV_BYTES } from '../lib/domain/csv';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');

const { db: testDb, close: closeTestDb } = createTestDb();

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

// Fixed, far-future year/month — deterministic, and won't collide with real seeded
// data or any auto-generated forecast rows tied to the actual current month.
const YEAR = 2077;
const MONTH = 6;

test.describe('Phase 5: CSV import/export', () => {
  test.describe.configure({ mode: 'serial' });

  const categoryName = `E2E Import Category ${Date.now()}`;
  const accountName = `E2E Import Account ${Date.now()}`;
  const reconcileItem = `E2E Import Groceries ${Date.now()}`;
  const newItem = `E2E Import Car Repair ${Date.now()}`;
  const injectionItem = `=E2E Injection ${Date.now()}`;
  let householdId: string;

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);
    householdId = owner.householdId;

    // Start from a known state: csv_import off (the default) regardless of any prior
    // run's leftover state.
    await testDb
      .delete(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, householdId),
          eq(householdSettings.key, 'csv_import'),
        ),
      );
  });

  test.afterAll(async () => {
    // Scoped to exactly the items this spec created — never a blanket
    // household-wide delete, which would destroy the real seeded household's data.
    await testDb
      .delete(monthlyEntries)
      .where(
        and(
          eq(monthlyEntries.householdId, householdId),
          inArray(monthlyEntries.item, [reconcileItem, newItem, injectionItem]),
        ),
      );
    await testDb.delete(categories).where(eq(categories.name, categoryName));
    await testDb.delete(bankAccounts).where(eq(bankAccounts.name, accountName));
    await testDb
      .delete(householdSettings)
      .where(
        and(
          eq(householdSettings.householdId, householdId),
          eq(householdSettings.key, 'csv_import'),
        ),
      );
    await closeTestDb();
  });

  test('csv_import is off by default; an owner can enable it inline on the Import page', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/import');

    await expect(page.getByText('CSV import is not enabled for this household.')).toBeVisible();
    await page.getByTestId('enable-csv-import').click();

    await expect(page.getByTestId('csv-file-input')).toBeVisible();
  });

  test('importing a CSV reconciles a matching forecast and creates a new entry, then re-importing applies nothing', async ({
    page,
  }) => {
    const [category] = await testDb
      .insert(categories)
      .values({ householdId, name: categoryName, direction: 'expense' })
      .returning();
    await testDb.insert(bankAccounts).values({ householdId, name: accountName });
    await testDb.insert(monthlyEntries).values({
      householdId,
      year: YEAR,
      month: MONTH,
      item: reconcileItem,
      categoryId: category.id,
      budgetedAmount: '100.00',
    });

    const csv = [
      'Date,Item,Amount',
      `${YEAR}-${String(MONTH).padStart(2, '0')}-05,${reconcileItem},-100.00`,
      `${YEAR}-${String(MONTH).padStart(2, '0')}-06,${newItem},-75.00`,
    ].join('\n');

    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/import');

    await page
      .getByTestId('csv-file-input')
      .setInputFiles({ name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    await page.getByTestId('mapping-date').selectOption({ label: 'Date' });
    await page.getByTestId('mapping-item').selectOption({ label: 'Item' });
    await page.getByTestId('mapping-amount').selectOption({ label: 'Amount' });
    await page.getByRole('button', { name: 'Preview import' }).click();

    const preview = page.getByTestId('import-preview-table');
    await expect(preview).toBeVisible();
    const matchRow = page.getByTestId('import-preview-row').filter({ hasText: reconcileItem });
    await expect(matchRow).toHaveAttribute('data-status', 'match');
    const newRow = page.getByTestId('import-preview-row').filter({ hasText: newItem });
    await expect(newRow).toHaveAttribute('data-status', 'new');

    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-summary')).toHaveText('Applied 2 rows.');

    // Verify against the real DB, not just the UI summary — the summary count alone
    // wouldn't distinguish "reconciled the right row" from "reconciled the wrong one."
    const [reconciled] = await testDb
      .select()
      .from(monthlyEntries)
      .where(
        and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.item, reconcileItem)),
      );
    expect(reconciled.actualAmount).toBe('100.00');
    const [created] = await testDb
      .select()
      .from(monthlyEntries)
      .where(and(eq(monthlyEntries.householdId, householdId), eq(monthlyEntries.item, newItem)));
    expect(created).toBeDefined();
    expect(created.actualAmount).toBe('75.00');

    // Re-import the identical file: both rows should now classify as already-applied.
    await page.goto('/import');
    await page
      .getByTestId('csv-file-input')
      .setInputFiles({ name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByTestId('mapping-date').selectOption({ label: 'Date' });
    await page.getByTestId('mapping-item').selectOption({ label: 'Item' });
    await page.getByTestId('mapping-amount').selectOption({ label: 'Amount' });
    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(
      page.getByTestId('import-preview-row').filter({ hasText: reconcileItem }),
    ).toHaveAttribute('data-status', 'already-applied');
    await expect(page.getByText('0 of 2 rows will be applied.')).toBeVisible();
  });

  test('an oversized file is rejected with a friendly error and writes nothing', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/import');

    const oversized = 'Date,Item,Amount\n' + 'x'.repeat(MAX_CSV_BYTES + 1024);
    await page
      .getByTestId('csv-file-input')
      .setInputFiles({ name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.from(oversized) });
    // Map every required field for real (not left unmapped) — this test needs to
    // reach runImportPipeline's byte-size check specifically, not the earlier
    // "required field unmapped" check the next test exercises instead.
    await page.getByTestId('mapping-date').selectOption({ label: 'Date' });
    await page.getByTestId('mapping-item').selectOption({ label: 'Item' });
    await page.getByTestId('mapping-amount').selectOption({ label: 'Amount' });

    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.getByText(/too large/i)).toBeVisible();
    // Never reached the preview table — nothing to have written in the first place.
    await expect(page.getByTestId('import-preview-table')).toHaveCount(0);
  });

  test('a garbage file with unmappable columns shows a clear error, not a crash', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto('/import');

    const garbage = 'Foo,Bar,Baz\n1,2,3\n%%%not,really,csv-like$$$\n';
    await page
      .getByTestId('csv-file-input')
      .setInputFiles({ name: 'garbage.csv', mimeType: 'text/csv', buffer: Buffer.from(garbage) });
    // Deliberately leave every mapping field unmapped (none of "Foo/Bar/Baz" is a
    // sensible Date/Item/Amount) and submit anyway — the server must reject this
    // clearly rather than crash or silently import garbage.
    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.getByText(/map the ".*" column/i)).toBeVisible();
  });

  test('export downloads a CSV that round-trips real data and escapes a formula-injection item', async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    // Create a row whose item starts with '=' via the import path itself (proves
    // import doesn't choke on/interpret it), then confirm export escapes it back out.
    const csv = [
      'Date,Item,Amount',
      `${YEAR}-${String(MONTH).padStart(2, '0')}-07,${injectionItem},-10.00`,
    ].join('\n');
    await page.goto('/import');
    await page
      .getByTestId('csv-file-input')
      .setInputFiles({ name: 'injection.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByTestId('mapping-date').selectOption({ label: 'Date' });
    await page.getByTestId('mapping-item').selectOption({ label: 'Item' });
    await page.getByTestId('mapping-amount').selectOption({ label: 'Amount' });
    await page.getByRole('button', { name: 'Preview import' }).click();
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-summary')).toHaveText('Applied 1 row.');

    await page.goto('/settings/data');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-csv-link').click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const csvContent = Buffer.concat(chunks).toString('utf-8');

    expect(csvContent).toContain(reconcileItem);
    expect(csvContent).toContain(newItem);
    // The dangerous leading '=' must be prefixed with a single quote, not appear raw.
    expect(csvContent).not.toContain(`,${injectionItem},`);
    expect(csvContent).toContain(`,'${injectionItem},`);
  });

  test('a viewer sees no import controls, only a read-only explanation', async ({ page }) => {
    // csv_import is already enabled for this household from the first test above.
    // requireRole('write') inside previewImportAction/commitImportAction is exercised
    // directly (with real DB assertions) by app/actions/import.integration.test.ts;
    // this confirms the UI never even offers the controls to a read-only role, rather
    // than relying solely on the server rejecting a submission that shouldn't be
    // reachable in the first place.
    const viewerEmail = `e2e-phase5-viewer-${Date.now()}@example.com`;
    const { hashPassword } = await import('../lib/auth/password');
    await testDb.insert(users).values({
      householdId,
      email: viewerEmail,
      passwordHash: await hashPassword('viewer-password-123'),
      name: 'E2E Phase5 Viewer',
      role: 'viewer',
    });

    await login(page, viewerEmail, 'viewer-password-123');
    await page.goto('/import');

    await expect(page.getByText('You have read-only access.')).toBeVisible();
    await expect(page.getByTestId('csv-file-input')).toHaveCount(0);

    await testDb.delete(users).where(eq(users.email, viewerEmail));
  });
});
