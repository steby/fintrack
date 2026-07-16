import { revalidatePath } from 'next/cache';

// One place that answers "which pages render this kind of data," so a mutating action
// can't refresh some surfaces and forget others (the class of staleness bug where you
// edit a value and a soft-navigation back to another page still shows the old one).
// Every entry/category/account/goal mutation calls the matching helper instead of
// hand-listing paths — add a new data-showing page here ONCE and every relevant action
// picks it up.

// Pages that render monthly-entry data: Home (safe-to-spend / upcoming / budget-left),
// Money (all three views), Transactions (search results), Insights (year charts).
export function revalidateEntryViews(): void {
  revalidatePath('/');
  revalidatePath('/monthly');
  revalidatePath('/transactions');
  revalidatePath('/insights');
}

// Pages that render category data (names, colors, monthly-budget caps): the entry views
// above all show category info, plus the Settings management page itself.
export function revalidateCategoryViews(): void {
  revalidateEntryViews();
  revalidatePath('/settings/categories');
}

// Pages that render bank-account / net-worth data: the dedicated Net worth page, Home's
// cash lens (FEATURE_NET_WORTH), and the Settings page accounts are managed from.
export function revalidateAccountViews(): void {
  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath('/settings/categories');
}

// Pages that render savings-goal data: the Goals page and Home's goals mini-card
// (FEATURE_SAVINGS_GOALS).
export function revalidateGoalViews(): void {
  revalidatePath('/');
  revalidatePath('/goals');
}
