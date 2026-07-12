'use client';

import { useActionState, useRef, useState } from 'react';
import { previewImportAction, commitImportAction, type PreviewRow } from '../../actions/import';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  parseCsvText,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  type ColumnMapping,
  type MappableField,
} from '../../../lib/domain/csv';
import { formatSGD } from '../../../lib/format';

const WIZARD_STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'preview', label: 'Preview' },
  { key: 'done', label: 'Done' },
] as const;

// A plain, non-interactive step indicator (spec.md Phase 11 task 4: "Tabs OR step
// indicator" — a step indicator, deliberately, not the Tabs primitive: these three
// steps can't be jumped between arbitrarily the way Tabs implies, only advanced by
// actually completing the current one, so rendering them as clickable tabs would be a
// misleading affordance). No flow change — purely a visual marker of ImportForm's own
// existing `step` state.
function ImportSteps({ step }: { step: (typeof WIZARD_STEPS)[number]['key'] }) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2" data-testid="import-steps">
      {WIZARD_STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold',
              i <= currentIndex
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
            aria-hidden
          >
            {i + 1}
          </span>
          <span
            className={cn(
              'text-xs',
              i === currentIndex ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {s.label}
          </span>
          {i < WIZARD_STEPS.length - 1 && <span aria-hidden className="h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

const FIELD_LABELS: Record<MappableField, string> = {
  date: 'Date',
  item: 'Item / Description',
  amount: 'Amount',
  direction: 'Direction (optional)',
  category: 'Category (optional)',
  account: 'Account (optional)',
};

// Column-name substrings to guess a default mapping from — a convenience for the
// common case, never trusted for anything beyond pre-filling the select the user can
// still change; the server only ever acts on whatever mapping is actually submitted.
// Meaningless (and skipped) when the file has no real header row — see guessMapping.
const FIELD_ALIASES: Record<MappableField, string[]> = {
  date: ['date'],
  item: ['item', 'description', 'desc', 'memo', 'payee'],
  amount: ['amount', 'value'],
  direction: ['direction', 'type'],
  category: ['category'],
  account: ['account'],
};

const MAPPING_FIELD_NAMES: Record<MappableField, string> = {
  date: 'mappingDate',
  item: 'mappingItem',
  amount: 'mappingAmount',
  direction: 'mappingDirection',
  category: 'mappingCategory',
  account: 'mappingAccount',
};

const EMPTY_MAPPING: ColumnMapping = {
  date: '',
  item: '',
  amount: '',
  direction: '',
  category: '',
  account: '',
};

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  match: 'Reconcile',
  new: 'New entry',
  'already-applied': 'Already imported',
  'duplicate-in-file': 'Duplicate in file',
  error: 'Error',
};

// mapping values are column POSITIONS ("0", "1", ...), never header text — see
// lib/domain/csv.ts's ColumnMapping doc comment for why (duplicate header names, and
// files with no header row at all, both need a mapping that doesn't depend on header
// text being present or unique).
function guessMapping(headerLabels: string[]): ColumnMapping {
  const mapping = { ...EMPTY_MAPPING };
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    // eslint-disable-next-line security/detect-object-injection
    const aliases = FIELD_ALIASES[field];
    const foundIndex = headerLabels.findIndex((h) =>
      aliases.some((alias) => h.toLowerCase().includes(alias)),
    );
    // eslint-disable-next-line security/detect-object-injection
    if (foundIndex !== -1) mapping[field] = String(foundIndex);
  }
  return mapping;
}

function displayHeader(parsedRows: string[][], hasHeaderRow: boolean): string[] {
  if (parsedRows.length === 0) return [];
  if (hasHeaderRow) return parsedRows[0];
  const columnCount = parsedRows[0].length;
  return Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
}

export function ImportForm() {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [suppressStaleCommitError, setSuppressStaleCommitError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewState, previewAction, previewPending] = useActionState(
    previewImportAction,
    undefined,
  );
  const [commitState, commitAction, commitPending] = useActionState(commitImportAction, undefined);

  // Render-time state sync (not useEffect+setState — see category-row.tsx for why):
  // advance to the preview step the moment a preview successfully comes back, and to
  // the done step once a commit succeeds. Also un-suppresses a previously-dismissed
  // commit error the instant a genuinely NEW commit result arrives, so "Start over"
  // hiding a stale error doesn't also hide a real one from the next attempt.
  const [reactedToPreview, setReactedToPreview] = useState(previewState);
  if (previewState !== reactedToPreview) {
    setReactedToPreview(previewState);
    if (previewState && 'rows' in previewState) setStep('preview');
  }
  const [reactedToCommit, setReactedToCommit] = useState(commitState);
  if (commitState !== reactedToCommit) {
    setReactedToCommit(commitState);
    setSuppressStaleCommitError(false);
    if (commitState && 'success' in commitState) setStep('done');
  }

  const header = displayHeader(parsedRows, hasHeaderRow);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsvText(text);
    setCsvText(text);
    setFileName(file.name);
    setParsedRows(rows);
    setMapping(hasHeaderRow ? guessMapping(displayHeader(rows, true)) : EMPTY_MAPPING);
  }

  function startOver() {
    setStep('upload');
    setCsvText('');
    setFileName('');
    setParsedRows([]);
    setHasHeaderRow(true);
    setMapping(EMPTY_MAPPING);
    setExcluded(new Set());
    setSuppressStaleCommitError(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (step === 'done' && commitState && 'success' in commitState) {
    return (
      <div className="flex flex-col gap-4">
        <ImportSteps step={step} />
        <Card>
          <CardHeader>
            <CardTitle>Import complete</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground" data-testid="import-summary">
              Applied {commitState.applied} row{commitState.applied === 1 ? '' : 's'}.
            </p>
            <Button size="sm" className="self-start" onClick={startOver}>
              Import another file
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'preview' && previewState && 'rows' in previewState) {
    const rows = previewState.rows;
    const actionable = rows.filter((r) => r.status === 'match' || r.status === 'new');

    return (
      <div className="flex flex-col gap-4">
        <ImportSteps step={step} />
        <Card>
          <CardHeader>
            <CardTitle>Preview: {fileName}</CardTitle>
          </CardHeader>
          <CardContent>
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
                              onChange={(e) =>
                                setExcluded((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.delete(row.rowNumber);
                                  else next.add(row.rowNumber);
                                  return next;
                                })
                              }
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
                            <span className="ml-1 text-xs text-muted-foreground">
                              {row.message}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {actionable.length} of {rows.length} row{rows.length === 1 ? '' : 's'} will be
              applied.
            </p>
          </CardContent>
        </Card>

        <form action={commitAction} className="flex flex-col gap-2">
          <input type="hidden" name="csvText" value={previewState.csvText} />
          <input
            type="hidden"
            name="hasHeaderRow"
            value={previewState.hasHeaderRow ? 'true' : 'false'}
          />
          {/* `field` only ranges over the fixed, compile-time MappableField literals —
              same false-positive class as lib/domain/csv.ts's buildMappedRows. */}
          {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => (
            <input
              key={field}
              type="hidden"
              // eslint-disable-next-line security/detect-object-injection
              name={MAPPING_FIELD_NAMES[field]}
              // eslint-disable-next-line security/detect-object-injection
              value={previewState.mapping[field]}
            />
          ))}
          <input type="hidden" name="excludedRows" value={[...excluded].join(',')} />
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={startOver}>
              Start over
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={commitPending || actionable.length === 0}
              data-testid="confirm-import"
            >
              Confirm import
            </Button>
          </div>
          {commitState && 'error' in commitState && !suppressStaleCommitError && (
            <p className="text-xs text-destructive">{commitState.error}</p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ImportSteps step={step} />
      <Card>
        <CardHeader>
          <CardTitle>Import CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={previewAction} className="flex flex-col gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              data-testid="csv-file-input"
              className="text-sm"
            />
            <input type="hidden" name="csvText" value={csvText} />
            <input type="hidden" name="hasHeaderRow" value={hasHeaderRow ? 'true' : 'false'} />

            {parsedRows.length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!hasHeaderRow}
                  onChange={(e) => {
                    const nextHasHeaderRow = !e.target.checked;
                    setHasHeaderRow(nextHasHeaderRow);
                    setMapping(
                      nextHasHeaderRow
                        ? guessMapping(displayHeader(parsedRows, true))
                        : EMPTY_MAPPING,
                    );
                  }}
                  data-testid="no-header-row-checkbox"
                />
                This file has no header row (first row is data)
              </label>
            )}

            {header.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {/* `field` only ranges over the fixed, compile-time MappableField
                  literals — same false-positive class as lib/domain/csv.ts's
                  buildMappedRows. */}
                {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => (
                  <label key={field} className="flex flex-col gap-1 text-xs">
                    {/* eslint-disable-next-line security/detect-object-injection */}
                    {FIELD_LABELS[field]}
                    <select
                      // eslint-disable-next-line security/detect-object-injection
                      name={MAPPING_FIELD_NAMES[field]}
                      // eslint-disable-next-line security/detect-object-injection
                      value={mapping[field]}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                      data-testid={`mapping-${field}`}
                    >
                      <option value="">-- not mapped --</option>
                      {header.map((label, i) => (
                        <option key={i} value={String(i)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}

            {previewState && 'error' in previewState && (
              <p className="text-xs text-destructive">{previewState.error}</p>
            )}

            <Button
              type="submit"
              size="sm"
              className="self-start"
              disabled={previewPending || !csvText || header.length === 0}
            >
              Preview import
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
