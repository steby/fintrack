// Internal helper for Phase 5's CSV import — not itself a Server Action (no
// 'use server'), same convention as lib/generate-entries.ts: the transactional DB work
// lives here, called by app/actions/import.ts's thin, auth/flag-gated actions.

import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { monthlyEntries } from './db/schema';
import { centsToAmount } from './money';
import { getMatchCandidates, getNameLookup } from './db/queries';
import {
  parseCsvText,
  checkCsvByteSize,
  checkCsvRowCount,
  checkCsvEncoding,
  buildMappedRows,
  normalizeRow,
  dedupWithinFile,
  classifyRow,
  type ColumnMapping,
  type NormalizedImportRow,
  type RowClassification,
} from './domain/csv';

export interface ImportPipelineResult {
  classifications: RowClassification[];
}

// Parses, maps, normalizes, dedups, and classifies every row of an uploaded CSV
// against the household's live data — shared by both the preview action (read-only)
// and the commit action (which re-runs this exact pipeline rather than trusting
// anything the client cached from the preview step, then applies the result). Never
// throws: every failure mode (empty file, oversized file, too many rows, unmappable
// rows) surfaces as a typed `{ error }` or a per-row 'error' classification instead.
//
// `hasHeaderRow` (spec.md Phase 5 edge case: "missing headers") — when false, every
// parsed row (including what would otherwise be consumed as a header) is treated as
// data; the client synthesizes "Column N" labels for the mapping UI in that case
// (see app/(app)/import/import-form.tsx), and ColumnMapping's values are always
// column POSITIONS, not header text, so this needs no separate mapping shape.
export async function runImportPipeline(
  householdId: string,
  csvText: string,
  mapping: ColumnMapping,
  hasHeaderRow: boolean,
): Promise<ImportPipelineResult | { error: string }> {
  const byteCheck = checkCsvByteSize(csvText);
  if (!byteCheck.ok) return { error: byteCheck.error };

  const encodingCheck = checkCsvEncoding(csvText);
  if (!encodingCheck.ok) return { error: encodingCheck.error };

  const allRows = parseCsvText(csvText);
  if (allRows.length === 0) {
    return { error: 'The file is empty.' };
  }
  const dataRows = hasHeaderRow ? allRows.slice(1) : allRows;
  if (dataRows.length === 0) {
    return { error: 'The file has no data rows.' };
  }

  const rowCheck = checkCsvRowCount(dataRows.length);
  if (!rowCheck.ok) return { error: rowCheck.error };

  const mappedRecords = buildMappedRows(dataRows, mapping);

  const validRows: NormalizedImportRow[] = [];
  const classifications: RowClassification[] = [];
  mappedRecords.forEach((record, i) => {
    const result = normalizeRow(record, i + 1);
    if (result.ok) {
      validRows.push(result.row);
    } else {
      classifications.push({ status: 'error', error: result.error });
    }
  });

  const { unique, duplicates } = dedupWithinFile(validRows);
  for (const row of duplicates) {
    classifications.push({ status: 'duplicate-in-file', row });
  }

  // Match candidates are fetched once per distinct (year, month) the file actually
  // touches, not once per row — a file spanning a handful of months makes a handful
  // of queries, not one per transaction. Fetched in parallel across months (each
  // query is independent, scoped to its own year+month); within one month's rows,
  // classification still runs sequentially against a per-month `claimed` set, so two
  // different rows in the file can never both match the same single existing entry —
  // once a row claims a candidate as its 'match' target, later rows in the same month
  // fall through to 'new' instead of a second UPDATE silently overwriting the first.
  const byMonth = new Map<string, NormalizedImportRow[]>();
  for (const row of unique) {
    const key = `${row.year}-${row.month}`;
    const list = byMonth.get(key);
    if (list) {
      list.push(row);
    } else {
      byMonth.set(key, [row]);
    }
  }
  const perMonthResults = await Promise.all(
    Array.from(byMonth.values()).map(async (rows) => {
      const { year, month } = rows[0];
      const candidates = await getMatchCandidates(householdId, year, month);
      const claimed = new Set<string>();
      const results: RowClassification[] = [];
      for (const row of rows) {
        const classification = classifyRow(row, candidates, claimed);
        if (classification.status === 'match') claimed.add(classification.entryId);
        results.push(classification);
      }
      return results;
    }),
  );
  for (const results of perMonthResults) {
    classifications.push(...results);
  }

  return { classifications };
}

export interface CommitOutcome {
  applied: number;
}

// Applies every 'match'/'new' classification not in excludedRowNumbers, in one
// transaction (spec.md: "commit applies in one transaction"). Deliberately takes
// already-computed classifications (the caller re-ran runImportPipeline immediately
// before this, against live DB state) rather than re-deriving them itself — but every
// DB write below is still independently scoped by householdId, so even a classification
// somehow computed against stale state can't cross a household boundary.
export async function commitImport(
  householdId: string,
  classifications: RowClassification[],
  excludedRowNumbers: Set<number>,
): Promise<CommitOutcome> {
  // A purely-reconciliation import (every row 'match', none 'new') never reads
  // nameLookup — skip the category/account fetch entirely rather than pay for it
  // unconditionally on every commit.
  const hasIncludedNewRows = classifications.some(
    (c) => c.status === 'new' && !excludedRowNumbers.has(c.row.rowNumber),
  );
  const nameLookup = hasIncludedNewRows
    ? await getNameLookup(householdId)
    : { categoryIdByName: new Map<string, string>(), accountIdByName: new Map<string, string>() };

  return db.transaction(async (tx) => {
    let applied = 0;
    for (const classification of classifications) {
      if (classification.status === 'match') {
        if (excludedRowNumbers.has(classification.row.rowNumber)) continue;
        const result = await tx
          .update(monthlyEntries)
          .set({
            actualAmount: centsToAmount(classification.row.amountCents),
            actualDate: classification.row.actualDate,
          })
          .where(
            and(
              eq(monthlyEntries.id, classification.entryId),
              eq(monthlyEntries.householdId, householdId),
            ),
          )
          .returning({ id: monthlyEntries.id });
        if (result[0]) applied += 1;
      } else if (classification.status === 'new') {
        if (excludedRowNumbers.has(classification.row.rowNumber)) continue;
        const { row } = classification;
        const categoryId = row.categoryName
          ? (nameLookup.categoryIdByName.get(row.categoryName.trim().toLowerCase()) ?? null)
          : null;
        const bankAccountId = row.accountName
          ? (nameLookup.accountIdByName.get(row.accountName.trim().toLowerCase()) ?? null)
          : null;
        await tx.insert(monthlyEntries).values({
          householdId,
          year: row.year,
          month: row.month,
          item: row.item,
          categoryId,
          budgetedAmount: centsToAmount(row.amountCents),
          actualAmount: centsToAmount(row.amountCents),
          actualDate: row.actualDate,
          bankAccountId,
        });
        applied += 1;
      }
    }
    return { applied };
  });
}
