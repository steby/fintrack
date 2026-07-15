import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { eq, and, inArray } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { requireEnv } from './env';
import { recurringSchedule, monthlyEntries, users, categories, fxRates } from '../lib/db/schema';
import { hashPassword } from '../lib/auth/password';

const OWNER_EMAIL = requireEnv('SEED_OWNER_EMAIL');
const OWNER_PASSWORD = requireEnv('SEED_OWNER_PASSWORD');
const VIEWER_EMAIL = 'e2e-monthly-viewer@example.com';
const VIEWER_PASSWORD = 'viewer-password-123';

const { db: testDb, close: closeTestDb } = createTestDb();

// Deliberately LOCAL time (getFullYear/getMonth), not lib/domain/today.ts's
// UTC-based currentYearMonth() — this has to match generate-form.tsx's own default,
// which is intentionally browser-local (a client-side form default correctly reflects
// the user's own calendar, not the server's UTC canonical "today"; see
// lib/domain/today.ts's comment on currentYearMonth for that reasoning). The "generate,
// enter an actual..." test below clicks Generate without overriding the form's default
// from-month, so this must anchor to the SAME local definition that button used, or the
// two could disagree right around a local-midnight-vs-UTC month boundary.
function currentMonthUrl(path = '/monthly') {
  const now = new Date();
  return `${path}?year=${now.getFullYear()}&month=${now.getMonth() + 1}&view=list`;
}

test.describe('monthly entries', () => {
  test.describe.configure({ mode: 'serial' });

  const itemName = `E2E Monthly Item ${Date.now()}`;
  // The test renames the recurring item mid-run (the propagate step) — cleanup must
  // match both names, or the renamed row leaks on every run (caught by seed.ts's
  // idempotency check unexpectedly counting leftover rows from a prior E2E run).
  const renamedItemName = `${itemName} propagated`;
  const adhocName = `E2E Adhoc ${Date.now()}`;
  const markPaidName = `E2E MarkPaid ${Date.now()}`;
  const fxItemName = `E2E FX ${Date.now()}`;
  const categoryName = `E2E Monthly Category ${Date.now()}`;

  test.beforeAll(async () => {
    const [owner] = await testDb
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.email, OWNER_EMAIL))
      .limit(1);

    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await testDb.insert(users).values({
      householdId: owner.householdId,
      email: VIEWER_EMAIL,
      passwordHash: await hashPassword(VIEWER_PASSWORD),
      name: 'E2E Monthly Viewer',
      role: 'viewer',
    });
    // The difference column (getDifference) needs a category direction to compute
    // anything — an item with no category is a valid but untestable-for-this-purpose
    // edge case (see list-view.tsx's "Uncategorized" section for that path instead).
    await testDb.insert(categories).values({
      householdId: owner.householdId,
      name: categoryName,
      direction: 'expense',
    });
  });

  test.afterAll(async () => {
    const items = await testDb
      .select({ id: recurringSchedule.id })
      .from(recurringSchedule)
      .where(inArray(recurringSchedule.item, [itemName, renamedItemName]));
    if (items.length > 0) {
      await testDb.delete(monthlyEntries).where(
        inArray(
          monthlyEntries.recurringScheduleId,
          items.map((i) => i.id),
        ),
      );
    }
    await testDb
      .delete(recurringSchedule)
      .where(inArray(recurringSchedule.item, [itemName, renamedItemName]));
    // Both the original and the mid-test renamed form — a failure between the edit
    // sheet's rename and the delete step must not leak the renamed row (the phase4
    // debris lesson: clean up every name a test can leave behind).
    await testDb
      .delete(monthlyEntries)
      .where(inArray(monthlyEntries.item, [adhocName, `${adhocName} renamed`]));
    await testDb.delete(monthlyEntries).where(eq(monthlyEntries.item, markPaidName));
    await testDb.delete(monthlyEntries).where(eq(monthlyEntries.item, fxItemName));
    await testDb.delete(categories).where(eq(categories.name, categoryName));
    await testDb.delete(users).where(eq(users.email, VIEWER_EMAIL));
    await closeTestDb();
  });

  test('generate, enter an actual, status advances, override budget survives a later propagate', async ({
    page,
  }) => {
    // This test chains a large number of real server round trips (recurring item
    // create + generate + two DB-polled actual-amount/date edits + budget override +
    // a recurring rename + propagate-skip check) into one flow — deliberately, since
    // it's exercising the full propagate/override interaction end to end, not easily
    // split further without losing that composition guarantee (generate + actual +
    // override + propagate-skip working together, not just each in isolation).
    // Already documented once before as timing-marginal under CI's real network
    // latency (see the DB-poll comment below); the default 30s budget left it exactly
    // at the edge. It failed reproducibly a second time on Dependabot PR #9 (react-dom
    // 19.2.4 -> 19.2.7) with "Test timeout of 30000ms exceeded" on its very last
    // assertion at the time (ad-hoc delete) — not a specific broken interaction, but
    // cumulative time from every earlier step eating into the final assertion's own
    // budget. Fixed two ways: raised this test's own timeout to 45s AND split the
    // ad-hoc add/delete case out into its own standalone test below (it never
    // depended on any state from this test — the same reasoning that already split
    // the calendar/agenda case out once before), so this test no longer needs the
    // full 45s just to have margin, but keeps it anyway rather than re-tuning a
    // number with no real headroom data behind it.
    test.setTimeout(45000);

    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    // Create a Monthly recurring item and generate it for the current month.
    await page.goto('/recurring');
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByPlaceholder('e.g. Spotify Duo').fill(itemName);
    await page.getByPlaceholder('0.00').fill('80.00');
    await page.locator('select[name="categoryId"]').selectOption({ label: `↓ ${categoryName}` });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('recurring-row').filter({ hasText: itemName })).toBeVisible();

    await page.getByRole('button', { name: 'Generate forecast' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/Generated \d+ entr(y|ies)\./)).toBeVisible();

    // Visit the current month in list view — the generated entry should be there,
    // status forecast (nothing actualized yet among at least this entry).
    await page.goto(currentMonthUrl());
    const row = page.getByTestId('entry-row').filter({ hasText: itemName });
    await expect(row).toBeVisible();

    // Enter an actual amount — auto-submits on change (matches the reference app's
    // inline-edit UX), and the entry should now show a computed difference.
    await row.locator('input[name="actualAmount"]').fill('75.00');
    await row.locator('input[name="actualAmount"]').blur();
    await expect(row.getByText('+$5.00')).toBeVisible();

    // Set the actual date too — previously there was no UI control for this at all
    // (updateActualAction always supported it; entry-row.tsx only ever echoed a hidden,
    // unchangeable value). Verified against the real DB via expect.poll, not by re-
    // reading the input's own value: the field is uncontrolled, so it keeps showing
    // whatever was typed regardless of whether the Server Action round trip has landed
    // yet — a toHaveValue check here would pass even if the submission never persisted
    // anything, unlike the amount case above, which waits on a value ('+$5.00') that
    // only appears once the server has actually responded.
    //
    // Scoped by year+month, not just item name: "Generate forecast" defaults to a
    // 12-month-ahead window (lib/domain/recurring.ts's addMonths), so this recurring
    // item has ~12 monthly_entries rows sharing the same item text, only one of which
    // (the current month, matching currentMonthUrl()) is the row the UI just updated.
    // An unscoped query non-deterministically grabbed one of the other 11 (still null)
    // rows here — the exact bug class e2e/recurring.spec.ts's own DB assertion was
    // fixed for during the Phase 2 hardening pass, reproduced this time by running
    // with CI=true locally (production build, workers=1, retries=2) after this test
    // passed twice in a row under the looser local dev-server/parallel config, which
    // never surfaced the ambiguity.
    const now = new Date();
    const currentMonthActualDate = async () => {
      const [persisted] = await testDb
        .select({ actualDate: monthlyEntries.actualDate })
        .from(monthlyEntries)
        .where(
          and(
            eq(monthlyEntries.item, itemName),
            eq(monthlyEntries.year, now.getFullYear()),
            eq(monthlyEntries.month, now.getMonth() + 1),
          ),
        );
      // A code-review pass found that expect.poll doesn't catch a throwing callback the
      // way it catches a failing matcher — if the scoped query ever matched zero rows
      // (e.g. a month boundary crossed between this Date() and currentMonthUrl()'s own),
      // `persisted.actualDate` would throw a raw, confusing TypeError instead of a clear
      // assertion failure. Fail loud and specific instead.
      if (!persisted) {
        throw new Error(
          `No monthly_entries row found for "${itemName}" in ${now.getFullYear()}-${now.getMonth() + 1}`,
        );
      }
      return persisted.actualDate;
    };
    await expect.poll(currentMonthActualDate).toBe(null);
    await row.locator('input[name="actualDate"]').fill('2026-01-15');
    await row.locator('input[name="actualDate"]').blur();
    await expect.poll(currentMonthActualDate).toBe('2026-01-15');

    // Override this month's budgeted amount — a Phase 2 addition beyond the reference
    // app, marking the row is_overridden so a later recurring-item propagate can't
    // silently clobber it.
    await row.getByRole('button', { name: '$80.00' }).click();
    const budgetInput = row.locator('input[name="budgetedAmount"]');
    await budgetInput.fill('90.00');
    await row.getByRole('button', { name: '✓' }).click();
    await expect(row.getByText('OVERRIDDEN')).toBeVisible();

    // Now propagate a name change from the recurring item — the overridden month's item
    // name must NOT change (shouldPropagate skips it), proving the UI round-trip and
    // the underlying propagation logic agree end to end, not just in isolation.
    await page.goto('/recurring');
    const recurringRow = page.getByTestId('recurring-row').filter({ hasText: itemName });
    await recurringRow.getByRole('button', { name: 'Edit' }).click();
    const editingRow = page.getByTestId('recurring-row').filter({ hasText: 'Save' });
    await editingRow.locator('input[name="item"]').fill(renamedItemName);
    await editingRow.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByTestId('recurring-row').filter({ hasText: renamedItemName }),
    ).toBeVisible();

    await page.goto(currentMonthUrl());
    await expect(page.getByTestId('entry-row').filter({ hasText: itemName })).toBeVisible();
    await expect(page.getByTestId('entry-row').filter({ hasText: renamedItemName })).toHaveCount(0);
  });

  // Split out from the mega-test above: add/delete of an ad-hoc entry never depended
  // on that test's recurring item, actual amount, budget override, or propagate-rename
  // state — it only needs a logged-in owner on the current month's page, same as
  // "an invalid amount is rejected" below. Sharing the mega-test's cumulative timeout
  // budget after 7+ prior UI interactions was what made this specific assertion the
  // one that failed when Dependabot PR #9 (react-dom bump) tipped it over 30s.
  // Standalone, it gets its own full budget instead of inheriting timing pressure from
  // everything that ran before it in that test.
  //
  // Phase 10: ad-hoc creation now goes through the GLOBAL quick-add sheet (the "Quick
  // add" header button at this desktop viewport — quick-add.tsx's Fab is the
  // md:hidden counterpart, covered separately by e2e/mobile.spec.ts), not a per-page
  // "Ad-hoc entry" button/form (that component, adhoc-form.tsx, no longer exists).
  test('quick add: add then delete', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByTestId('quick-add-form').getByPlaceholder('e.g. Car Repair').fill(adhocName);
    await page.getByRole('button', { name: 'Add entry' }).click();
    const adhocRow = page.getByTestId('entry-row').filter({ hasText: adhocName });
    await expect(adhocRow).toBeVisible();
    await expect(adhocRow.getByText('AD-HOC')).toBeVisible();

    // No category was picked — the entry must land under the reserved Uncategorized
    // expense category (visible as the row's category label), NOT category-less (which
    // would exclude it from every total — the full-app-review finding), and Home must
    // show the categorize nudge while it exists.
    await expect(adhocRow.getByText('Uncategorized')).toBeVisible();
    await page.goto('/');
    const nudge = page.getByTestId('categorize-nudge');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText(/needs? a category/);

    // The edit-entry sheet is how the nudge gets RESOLVED (not just deleted): assign a
    // real category and rename in one submit, then the nudge must clear.
    await page.goto(currentMonthUrl());
    const rowAgain = page.getByTestId('entry-row').filter({ hasText: adhocName });
    await rowAgain.getByRole('button', { name: `Edit ${adhocName}` }).click();
    const editForm = page.getByTestId('entry-edit-form');
    await expect(editForm).toBeVisible();
    const renamedAdhoc = `${adhocName} renamed`;
    await editForm.locator('input[name="item"]').fill(renamedAdhoc);
    await editForm
      .locator('select[name="categoryId"]')
      .selectOption({ label: `↓ ${categoryName}` });
    await editForm.getByRole('button', { name: 'Save' }).click();

    const renamedRow = page.getByTestId('entry-row').filter({ hasText: renamedAdhoc });
    await expect(renamedRow).toBeVisible();
    await expect(renamedRow.getByText(categoryName)).toBeVisible();
    await page.goto('/');
    await expect(page.getByTestId('categorize-nudge')).toHaveCount(0);

    await page.goto(currentMonthUrl());
    await renamedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('entry-row').filter({ hasText: renamedAdhoc })).toHaveCount(0);
  });

  test('quick add in a foreign currency pre-fills the SGD estimate and stores the annotation', async ({
    page,
  }) => {
    // Seed a fresh cached USD rate so the flow is deterministic and network-free —
    // getRateToSgd serves the cache while it's within TTL, so frankfurter is never hit.
    await testDb
      .insert(fxRates)
      .values({ currency: 'USD', rateToSgd: '1.350000', fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: fxRates.currency,
        set: { rateToSgd: '1.350000', fetchedAt: new Date() },
      });

    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByRole('button', { name: 'New entry' }).click();
    const sheet = page.getByTestId('quick-add-form');
    await sheet.getByPlaceholder('e.g. Car Repair').fill(fxItemName);
    await sheet.getByLabel('Currency').selectOption('USD');
    // Rate arrives async (server action against the seeded cache) — the estimate line
    // renders once it lands.
    await expect(sheet.getByText(/estimated/)).toBeVisible();
    await sheet.getByLabel('Amount in USD').fill('20');
    // 20 USD @ 1.35 = S$27.00, pre-filled but editable.
    await expect(sheet.getByLabel('Amount in SGD')).toHaveValue('27.00');
    await sheet.getByRole('button', { name: 'Add entry' }).click();

    const row = page.getByTestId('entry-row').filter({ hasText: fxItemName });
    await expect(row).toBeVisible();
    // The display-only annotation renders alongside the stored SGD amount.
    await expect(row.getByText(/US\$20\.00 @ 1\.3500/)).toBeVisible();

    await expect
      .poll(async () => {
        const [persisted] = await testDb
          .select({
            actualAmount: monthlyEntries.actualAmount,
            originalAmount: monthlyEntries.originalAmount,
            originalCurrency: monthlyEntries.originalCurrency,
          })
          .from(monthlyEntries)
          .where(eq(monthlyEntries.item, fxItemName));
        return persisted;
      })
      .toMatchObject({ actualAmount: '27.00', originalAmount: '20.00', originalCurrency: 'USD' });

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('entry-row').filter({ hasText: fxItemName })).toHaveCount(0);
  });

  // Phase 10 (mark-paid reachable from list view's compact inline button,
  // entry-row.tsx) + post-redesign bug-fix pass (clicking "Mark paid" now opens a
  // small confirm popup with an editable date field, defaulting to today, instead of
  // instantly marking paid — USER'S EXPLICIT SPEC, since markPaidAction used to
  // hardcode today's date regardless of which month the entry actually belongs to).
  // This test edits the date to a real, non-today value and verifies against the REAL
  // DB that the CUSTOM date was persisted, not today's — not the amount/date inputs'
  // own values, which are deliberately uncontrolled (see the load-bearing onBlur
  // comment in entry-row.tsx), so their `defaultValue` does NOT re-apply after a
  // server round trip that revalidates the SAME component instance; the "generate,
  // enter an actual..." test above already established this exact pattern (DB poll,
  // not toHaveValue) for the same reason. What DOES reliably reflect fresh server
  // state is a conditionally-rendered element like the MarkPaidButton itself
  // (entry-row.tsx only renders it when `entry.actualAmount === null`, re-evaluated
  // fresh on every render) — asserting it disappears is a real, non-uncontrolled-input
  // signal, used alongside the DB poll.
  test('mark-paid popup: editing the date to a custom value persists that exact date, and the button disappears once paid', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    // Quick-add's primary "Amount" field is actualAmount; leaving it blank and setting
    // ONLY the "More options" budgeted amount produces a genuinely unpaid forecast row
    // (actualAmount null) with a real, non-zero budgetedAmount to mark paid against.
    await page.goto(currentMonthUrl());
    await page.getByRole('button', { name: 'New entry' }).click();
    const sheet = page.getByTestId('quick-add-form');
    await sheet.getByPlaceholder('e.g. Car Repair').fill(markPaidName);
    await sheet.getByRole('button', { name: 'More options' }).click();
    await sheet.locator('input[name="budgetedAmount"]').fill('42.00');
    await sheet.getByRole('button', { name: 'Add entry' }).click();

    const row = page.getByTestId('entry-row').filter({ hasText: markPaidName });
    await expect(row).toBeVisible();
    const markPaidButton = row.getByRole('button', { name: 'Mark paid' });
    await expect(markPaidButton).toBeVisible();

    await markPaidButton.click();
    // The trigger and the popup's own submit button share the label "Mark paid" and
    // coexist once the popup is open (same trigger/submit-share-a-label pattern as
    // goal-add-form.tsx) — scoped to data-testid="mark-paid-form" per the plan's own
    // Playwright strict-mode guidance, not disambiguated by renaming either one.
    const markPaidForm = page.getByTestId('mark-paid-form');
    await expect(markPaidForm).toBeVisible();
    // The amount field defaults to the budgeted figure (42.00) but is editable
    // (full-app-review item 8) — record a different real-world amount alongside the
    // custom date and assert BOTH persisted.
    await expect(markPaidForm.locator('input[name="actualAmount"]')).toHaveValue('42.00');
    await markPaidForm.locator('input[name="actualAmount"]').fill('39.75');
    await markPaidForm.locator('input[type="date"]').fill('2026-01-15');
    await markPaidForm.getByRole('button', { name: 'Mark paid' }).click();
    await expect(markPaidButton).toHaveCount(0);

    const persistedRow = async () => {
      const [persisted] = await testDb
        .select({
          actualAmount: monthlyEntries.actualAmount,
          actualDate: monthlyEntries.actualDate,
        })
        .from(monthlyEntries)
        .where(eq(monthlyEntries.item, markPaidName));
      if (!persisted) throw new Error(`No monthly_entries row found for "${markPaidName}"`);
      return persisted;
    };
    await expect.poll(async () => (await persistedRow()).actualAmount).toBe('39.75');
    expect((await persistedRow()).actualDate).toBe('2026-01-15');
  });

  // Phase 10: `‹ July 2026 ›` chevrons crossing a year boundary — Dec's "next" chevron
  // must land on January of the FOLLOWING year, not silently stay in the same year or
  // wrap incorrectly (lib/domain/month-params.ts's monthNav, unit-tested in isolation;
  // this confirms the real link renders and navigates correctly end to end).
  test('month chevrons cross the year boundary (Dec -> Jan)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/monthly?year=2026&month=12&view=list');
    await expect(page.getByTestId('month-header-label')).toHaveText('December 2026');

    await page.getByTestId('month-nav-next').click();
    await expect(page).toHaveURL(/year=2027&month=1&view=list/);
    await expect(page.getByTestId('month-header-label')).toHaveText('January 2027');

    await page.getByTestId('month-nav-prev').click();
    await expect(page).toHaveURL(/year=2026&month=12&view=list/);
  });

  // Phase 10 trust boundary: the fintrack_view cookie is client-writable; the URL
  // param must always win over it, even a stale/valid-but-different cookie value (not
  // just outright garbage — the garbage/adversarial case is covered by
  // lib/domain/month-params.test.ts's unit tests, which is the right layer for pure
  // parsing logic; this confirms the real cookie read in page.tsx honors the same
  // precedence end to end).
  test('the view URL param wins over a stale fintrack_view cookie', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await context.addCookies([
      {
        name: 'fintrack_view',
        value: 'calendar',
        url: new URL(page.url()).origin,
      },
    ]);

    // currentMonthUrl() already pins view=list — the cookie says calendar, the URL says
    // list; list must win. Scope to the view-toggle container (not a bare testid) per
    // the plan's own Playwright strict-mode warning.
    await page.goto(currentMonthUrl());
    await expect(page.getByTestId('view-toggle')).toBeVisible();
    await expect(page.getByTestId('view-toggle').getByTestId('view-toggle-list')).toHaveAttribute(
      'data-active',
      '',
    );
  });

  // Split out from the mega-test above (previously tacked onto its tail) — this is a
  // genuinely independent, read-only check (calendar/agenda views render without
  // crashing) that doesn't need any of the preceding test's mutation state, and
  // sharing that test's cumulative 30s timeout budget after 7+ prior UI interactions
  // made it a recurring source of CI flakiness (calendar-cell/agenda-URL timeouts).
  // Standalone, it gets its own full timeout instead of inheriting timing pressure
  // from everything that ran before it.
  test('calendar and agenda views render without crashing', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByTestId('view-toggle-calendar').click();
    await expect(page.getByTestId('calendar-cell').first()).toBeVisible();
    await page.getByTestId('view-toggle-agenda').click();
    await expect(page).toHaveURL(/view=agenda/);
  });

  test('a viewer sees monthly entries read-only', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VIEWER_EMAIL);
    await page.getByLabel('Password').fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    // Phase 10: the global quick-add trigger ("New entry" at this desktop viewport) is
    // server-gated by canManage in app/(app)/layout.tsx — a viewer never gets it
    // rendered at all, not merely hidden via CSS.
    await expect(page.getByRole('button', { name: 'New entry' })).toHaveCount(0);
    await expect(page.locator('input[name="actualAmount"]')).toHaveCount(0);
    // Nor the one-tap mark-paid button, even on an unpaid entry a prior test may have
    // left behind — mark-paid is a write action same as any other.
    await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
  });

  test('an invalid amount is rejected with a visible error (spec.md Phase 2 failure-path requirement)', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');

    await page.goto(currentMonthUrl());
    await page.getByRole('button', { name: 'New entry' }).click();
    const sheet = page.getByTestId('quick-add-form');
    await sheet.getByPlaceholder('e.g. Car Repair').fill(`E2E Invalid Amount ${Date.now()}`);
    // 11 digits — a syntactically valid HTML5 <input type="number"> value (so the
    // browser's own min/step constraint validation doesn't intercept the submission
    // before it reaches the server), but one that overflows numeric(12,2)'s 10-digit
    // integer-part limit, which addAdhocAction's zod schema now rejects gracefully
    // instead of the Postgres "numeric field overflow" this used to crash with. Fills
    // quick-add's PRIMARY "Amount" field (actualAmount), unlike the old adhoc-form.tsx
    // version of this test, which filled the always-visible "Budgeted" field — the
    // error text differs accordingly (actual, not budgeted).
    await sheet.getByPlaceholder('0.00').fill('99999999999');
    await sheet.getByRole('button', { name: 'Add entry' }).click();

    await expect(sheet.getByText('Enter a valid, non-negative actual amount.')).toBeVisible();
  });
});
