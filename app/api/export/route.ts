import { requireUser } from '../../../lib/auth/guards';
import { getExportRows } from '../../../lib/db/queries';
import { buildCsv } from '../../../lib/domain/csv';

const HEADERS = [
  'Year',
  'Month',
  'Scheduled_Day',
  'Actual_Date',
  'Item',
  'Category',
  'Direction',
  'Budgeted_Amount',
  'Actual_Amount',
  'Account',
];

// Mandatory per spec.md's Feature Matrix (not behind csv_import's kill-switch — that
// gates the destructive/bulk-write side, export is read-only). Every household member
// can export, matching the read access every role already has to this same data
// through the rest of the app (requireUser, not requireRole('write')).
export async function GET() {
  const user = await requireUser();
  const rows = await getExportRows(user.householdId);

  const csv = buildCsv(
    HEADERS,
    rows.map((row) => [
      row.year,
      row.month,
      row.scheduledDay,
      row.actualDate,
      row.item,
      row.categoryName,
      row.direction,
      row.budgetedAmount,
      row.actualAmount,
      row.accountName,
    ]),
  );

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fintrack-export.csv"',
    },
  });
}
