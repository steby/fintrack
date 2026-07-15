// Barrel for lib/db/queries/* — the ONE import path every consumer keeps using
// (app/actions/*, pages, cron routes all import from '../../lib/db/queries'), so the
// batch-4 split into domain modules changed zero call sites. New queries go in the
// matching lib/db/queries/<domain>.ts module, exported here.
export * from './queries/shared';
export * from './queries/entry-form';
export * from './queries/dashboard';
export * from './queries/net-worth';
export * from './queries/csv';
export * from './queries/forecast';
export * from './queries/transactions';
export * from './queries/email';
// Re-exported so importers can keep pulling the row type from this public surface —
// the type itself lives in lib/domain/dashboard.ts next to buildCategoryBudgetRows.
export type { CategoryBudgetRow } from '../domain/dashboard';
