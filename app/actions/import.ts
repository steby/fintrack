'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole, requireKillSwitch } from '../../lib/auth/guards';
import type { SessionUser } from '../../lib/auth/session';
import { setFlag } from '../../lib/flags';
import { runImportPipeline, commitImport } from '../../lib/import-csv';
import {
  REQUIRED_FIELDS,
  type ColumnMapping,
  type RowClassification,
  type NormalizedImportRow,
} from '../../lib/domain/csv';

// Display-friendly projection of RowClassification for the client — deliberately
// drops `entryId` (never needed client-side: commitImportAction re-derives the target
// entry itself rather than trusting one echoed back from a preview) and flattens the
// union into one shape a table row can render directly.
export interface PreviewRow {
  rowNumber: number;
  status: RowClassification['status'];
  item: string;
  year?: number;
  month?: number;
  amountCents?: number;
  direction?: 'income' | 'expense';
  message?: string;
}

// Every non-error branch shares the same six-field projection of a NormalizedImportRow
// — this builds it once so adding/renaming a displayed field only means editing one
// place, not four near-identical object literals.
function projectRow(
  row: NormalizedImportRow,
  status: PreviewRow['status'],
  message: string,
): PreviewRow {
  return {
    rowNumber: row.rowNumber,
    status,
    item: row.item,
    year: row.year,
    month: row.month,
    amountCents: row.amountCents,
    direction: row.direction,
    message,
  };
}

function toPreviewRow(c: RowClassification): PreviewRow {
  switch (c.status) {
    case 'error':
      return { rowNumber: c.error.rowNumber, status: 'error', item: '', message: c.error.message };
    case 'match':
      return projectRow(c.row, 'match', `Will reconcile with "${c.candidateItem}"`);
    case 'already-applied':
      return projectRow(c.row, 'already-applied', 'Already imported — no changes');
    case 'new':
      return projectRow(c.row, 'new', 'Will create a new entry');
    case 'duplicate-in-file':
      return projectRow(c.row, 'duplicate-in-file', 'Duplicate of an earlier row in this file');
  }
}

export type ImportActionState =
  | { error: string }
  | { csvText: string; mapping: ColumnMapping; hasHeaderRow: boolean; rows: PreviewRow[] }
  | { success: true; applied: number }
  | undefined;

function readMapping(formData: FormData): ColumnMapping {
  return {
    date: String(formData.get('mappingDate') ?? ''),
    item: String(formData.get('mappingItem') ?? ''),
    amount: String(formData.get('mappingAmount') ?? ''),
    direction: String(formData.get('mappingDirection') ?? ''),
    category: String(formData.get('mappingCategory') ?? ''),
    account: String(formData.get('mappingAccount') ?? ''),
  };
}

function readHasHeaderRow(formData: FormData): boolean {
  // Absent/anything other than the literal 'true' means "has a header row" — the
  // safer default or a merely-malformed value both fall back to today's original
  // (and far more common) behavior rather than silently treating a normal file's
  // first row as data.
  return formData.get('hasHeaderRow') !== 'false';
}

function findUnmappedRequiredField(mapping: ColumnMapping): string | null {
  for (const field of REQUIRED_FIELDS) {
    // `field` only ranges over the fixed, compile-time REQUIRED_FIELDS literals —
    // same false-positive class as lib/domain/csv.ts's buildMappedRows.
    // eslint-disable-next-line security/detect-object-injection
    if (!mapping[field]) return field;
  }
  return null;
}

interface PreparedImport {
  actingUser: SessionUser;
  mapping: ColumnMapping;
  hasHeaderRow: boolean;
  classifications: RowClassification[];
}

// Shared by previewImportAction and commitImportAction — both need exactly "auth +
// kill-switch gate, read the column mapping, reject an unmapped required field, run
// the pipeline against live DB state" before doing their own distinct thing with the
// result (project to PreviewRow vs. actually apply it). `context` only changes the
// unmapped-field message's wording ("previewing" vs "committing") — the underlying
// advice (fix the mapping and resubmit) is identical either way; commitImportAction
// re-runs this same pipeline rather than trusting anything the client cached from the
// preview step, so a request that reaches it with a bad mapping is either a tampered
// POST or a UI regression, and deserves a message that matches the step it's actually
// failing at, not a copy-pasted "before previewing."
async function prepareImportPipeline(
  csvText: string,
  formData: FormData,
  context: 'preview' | 'commit',
): Promise<{ ok: true; value: PreparedImport } | { ok: false; error: string }> {
  const actingUser = await requireRole('write');

  const disabledError = await requireKillSwitch(
    actingUser.householdId,
    'csv_import',
    'CSV import is not enabled for this household.',
  );
  if (disabledError) return { ok: false, error: disabledError };

  const mapping = readMapping(formData);
  const hasHeaderRow = readHasHeaderRow(formData);
  const unmapped = findUnmappedRequiredField(mapping);
  if (unmapped) {
    const gerund = context === 'preview' ? 'previewing' : 'committing';
    return { ok: false, error: `Map the "${unmapped}" column before ${gerund}.` };
  }

  const result = await runImportPipeline(actingUser.householdId, csvText, mapping, hasHeaderRow);
  if ('error' in result) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    value: { actingUser, mapping, hasHeaderRow, classifications: result.classifications },
  };
}

const previewInputSchema = z.object({ csvText: z.string().min(1, 'Choose a file to import.') });

export async function previewImportAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const parsed = previewInputSchema.safeParse({ csvText: formData.get('csvText') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose a file to import.' };
  }

  const prepared = await prepareImportPipeline(parsed.data.csvText, formData, 'preview');
  if (!prepared.ok) return { error: prepared.error };

  return {
    csvText: parsed.data.csvText,
    mapping: prepared.value.mapping,
    hasHeaderRow: prepared.value.hasHeaderRow,
    rows: prepared.value.classifications.map(toPreviewRow),
  };
}

const commitInputSchema = z.object({
  csvText: z.string().min(1),
  excludedRows: z.string().optional(),
});

// Re-runs runImportPipeline against the SAME csvText/mapping the client just previewed
// (resubmitted, not cached server-side between steps — see app/(app)/import/import-
// form.tsx) and live DB state, then applies it — never trusts a classification or
// entry-id list supplied directly by the client. `excludedRows` is the one client
// input that genuinely is a user decision (which previewed rows to skip), not a claim
// about what the server should find; it's just a set of row numbers, meaningless
// without the server's own fresh classification to apply it against.
export async function commitImportAction(
  _prevState: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const parsed = commitInputSchema.safeParse({
    csvText: formData.get('csvText'),
    excludedRows: formData.get('excludedRows') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  // A request reaching this action with an unmapped required field (a tampered/forged
  // POST, or a future UI regression that fails to forward the preview's mapping) must
  // surface a clear error via prepareImportPipeline's own check, not silently classify
  // every row as 'error' and report {success:true, applied:0} as if nothing were wrong.
  const prepared = await prepareImportPipeline(parsed.data.csvText, formData, 'commit');
  if (!prepared.ok) return { error: prepared.error };

  const excludedRowNumbers = new Set(
    (parsed.data.excludedRows ?? '')
      .split(',')
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isInteger(n)),
  );

  const outcome = await commitImport(
    prepared.value.actingUser.householdId,
    prepared.value.classifications,
    excludedRowNumbers,
  );

  revalidatePath('/monthly');
  revalidatePath('/');
  return { success: true, applied: outcome.applied };
}

export type ToggleFlagActionState = { error?: string; success?: boolean } | undefined;

const toggleSchema = z.object({ enabled: z.enum(['true', 'false']) });

// Owner-only (manage_settings — the same action lib/auth/rbac.ts already uses for
// "kill-switch settings," per its own comment) — the only way to flip csv_import on,
// since it's a kill-switch (default off), not a config flag, and Phase 5's task list
// has no separate settings page for it; exposed inline on the Import page instead
// (see app/(app)/import/page.tsx), which is also the one place a household discovers
// the feature exists to ask an owner to enable it.
export async function toggleCsvImportAction(
  _prevState: ToggleFlagActionState,
  formData: FormData,
): Promise<ToggleFlagActionState> {
  const actingUser = await requireRole('manage_settings');

  const parsed = toggleSchema.safeParse({ enabled: formData.get('enabled') });
  if (!parsed.success) {
    return { error: 'Invalid request.' };
  }

  await setFlag(actingUser.householdId, 'csv_import', parsed.data.enabled === 'true');
  revalidatePath('/import');
  return { success: true };
}
