'use client';

import type { PreviewRow } from '../../actions/import';
import { formatSGD } from '../../../lib/format';

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  match: 'Reconcile',
  new: 'New entry',
  'already-applied': 'Already imported',
  'duplicate-in-file': 'Duplicate in file',
  error: 'Error',
};

// Presentational slice of the import wizard's preview step: renders the classified
// rows with include/exclude checkboxes but owns no state — the exclusion set lives in
// ImportForm (which also derives the actionable count for the commit button; the
// filter here is the same one-liner, deliberately recomputed rather than threaded
// through props for a caption).
export function ImportPreviewTable({
  rows,
  excluded,
  onToggle,
}: {
  rows: PreviewRow[];
  excluded: Set<number>;
  onToggle: (rowNumber: number, included: boolean) => void;
}) {
  const actionable = rows.filter((r) => r.status === 'match' || r.status === 'new');
  return (
    <>
      <div className="max-h-[28rem] overflow-y-auto">
        <table className="w-full text-sm" data-testid="import-preview-table">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-8"></th>
              <th className="py-1">Row</th>
              <th>Item</th>
              <th>When</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canToggle = row.status === 'match' || row.status === 'new';
              return (
                <tr
                  key={row.rowNumber}
                  className="border-b last:border-0"
                  data-testid="import-preview-row"
                  data-status={row.status}
                >
                  <td>
                    {canToggle && (
                      <input
                        type="checkbox"
                        checked={!excluded.has(row.rowNumber)}
                        onChange={(e) => onToggle(row.rowNumber, e.target.checked)}
                      />
                    )}
                  </td>
                  <td className="py-1">{row.rowNumber}</td>
                  <td>{row.item || '—'}</td>
                  <td>
                    {row.year && row.month
                      ? `${row.year}-${String(row.month).padStart(2, '0')}`
                      : '—'}
                  </td>
                  <td>{row.amountCents !== undefined ? formatSGD(row.amountCents) : '—'}</td>
                  <td>
                    <span
                      className={
                        row.status === 'error'
                          ? 'text-destructive'
                          : row.status === 'match'
                            ? 'text-income'
                            : 'text-muted-foreground'
                      }
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.message && (
                      <span className="ml-1 text-xs text-muted-foreground">{row.message}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {actionable.length} of {rows.length} row{rows.length === 1 ? '' : 's'} will be applied.
      </p>
    </>
  );
}
