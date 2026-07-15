// Pure logic for Phase 5's CSV import/export — spec.md's trust boundary note for this
// phase is blunt: "uploaded file = fully hostile input." Nothing here ever throws on
// malformed input; every function returns a typed result instead, so a hostile or
// merely-malformed file degrades to a per-row/per-file error the UI can show, not a
// 500 or a crash.

import { MIN_YEAR, MAX_YEAR, isValidCalendarDate } from './month-params';
import { parseAmountToCents } from '../money';

// --- CSV text parsing -------------------------------------------------------------

// A minimal, dependency-free RFC4180-ish parser: comma-delimited, double-quote
// quoting (embedded commas/newlines/CRLF inside quotes, "" as an escaped quote).
// Hand-rolled rather than pulled in as a dependency specifically because this is the
// one place in the app that parses fully untrusted file content — a straight
// character-by-character scan (no regex, no backtracking) is both easy to audit and
// impossible to blow up on adversarial input. Never throws: an unterminated quote at
// EOF just closes the field/row with whatever was accumulated, same as most real-world
// CSV tools do, rather than rejecting the whole file over one malformed line.
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    // `i` is bounded by the `while (i < n)` guard, never user-controlled as an index
    // itself — the same false-positive class eslint-plugin-security flags in
    // lib/domain/net-worth.ts's buildNetWorthSeries.
    // eslint-disable-next-line security/detect-object-injection
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    // A quote only OPENS a quoted field when it's the first character of that
    // field — real-world CSV tools (Excel included) treat a `"` appearing mid-field
    // of an otherwise-unquoted field as a literal character, not a quote-start.
    // Without the `field === ''` guard, a single stray `"` anywhere in an unquoted
    // field (e.g. an item description like `12" cable`) would silently swallow every
    // subsequent comma/newline into one field until the next `"`, merging and
    // dropping an arbitrary number of real rows with no error surfaced.
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        // CRLF: the \r itself is just skipped, the \n right after ends the row.
        i += 1;
        continue;
      }
      // Bare CR with no following \n — classic Mac (pre-OS X) line endings, still a
      // real convention some older export tools use. Without ending the row here, the
      // \r would just be silently dropped and every subsequent row would fuse into
      // this one, mangling the whole file with no error surfaced (see the CRLF/LF
      // cases below, which both correctly end a row on their line-ending character).
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Trailing content without a final newline still counts as the last row — but a
  // file that ends cleanly on \n shouldn't produce one extra empty row.
  if (field !== '' || row.length > 0) {
    endRow();
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// --- Size/row caps (spec.md edge cases: >5MB file, >2000 rows) --------------------
// Split into two checks, deliberately — spec.md's task list says caps must be
// "enforced before parse": checkCsvByteSize only needs the raw string, so a caller can
// (and must) reject an oversized file before ever handing it to parseCsvText.
// checkCsvRowCount only makes sense to call after parsing, once a row count exists.

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;

export type CsvSizeCheck = { ok: true } | { ok: false; error: string };

export function checkCsvByteSize(text: string): CsvSizeCheck {
  // .length on a JS string is UTF-16 code units, not bytes — an undercount for
  // non-Latin text, never an overcount, so this stays a conservative (permissive)
  // approximation of the real byte size rather than a source of false rejections.
  if (text.length > MAX_CSV_BYTES) {
    return { ok: false, error: `File is too large (max ${MAX_CSV_BYTES / (1024 * 1024)}MB).` };
  }
  return { ok: true };
}

export function checkCsvRowCount(dataRowCount: number): CsvSizeCheck {
  if (dataRowCount > MAX_CSV_ROWS) {
    return { ok: false, error: `Too many rows (max ${MAX_CSV_ROWS}).` };
  }
  return { ok: true };
}

// spec.md Phase 5 edge case: "wrong encoding." Browsers/Node always decode an
// uploaded file as UTF-8 (File.text()/fs reads have no encoding-detection step) — a
// file actually saved in a different encoding (Windows-1252/Latin-1 is a common
// real-world bank-export encoding) decodes with the invalid byte sequences replaced
// by U+FFFD. Checking for that replacement character is a cheap, reliable signal that
// something upstream of this app mis-decoded the file — there's no way to recover the
// original bytes at this point, so the only honest response is a clear rejection
// rather than silently importing mojibake item names.
export function checkCsvEncoding(text: string): CsvSizeCheck {
  if (text.includes('�')) {
    return {
      ok: false,
      error:
        "This file doesn't look like valid UTF-8 text — re-save it as UTF-8 CSV and try again.",
    };
  }
  return { ok: true };
}

// --- Column mapping ----------------------------------------------------------------

export const REQUIRED_FIELDS = ['date', 'item', 'amount'] as const;
export const OPTIONAL_FIELDS = ['direction', 'category', 'account'] as const;
export type MappableField = (typeof REQUIRED_FIELDS)[number] | (typeof OPTIONAL_FIELDS)[number];

// The column's POSITION in the row (as a string, e.g. "0", "1", ...), or '' if
// unmapped — deliberately not the header NAME. Two reasons: (1) a header name isn't
// guaranteed unique (a CSV with two columns both literally named "Amount" would have
// a name-based mapping silently resolve to whichever the lookup happened to keep),
// and (2) spec.md's "missing headers" edge case means there may be no real header
// text to map by at all (see hasHeaderRow in lib/import-csv.ts) — a position is
// always well-defined either way.
export type ColumnMapping = Record<MappableField, string>;

export function buildMappedRows(
  dataRows: string[][],
  mapping: ColumnMapping,
): Record<MappableField, string>[] {
  return dataRows.map((cells) => {
    const record = {} as Record<MappableField, string>;
    for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
      // `field` only ever ranges over the fixed, compile-time MappableField literals
      // above, never attacker-controlled. Same false-positive class as elsewhere.
      // eslint-disable-next-line security/detect-object-injection
      const idxRaw = mapping[field];
      const idx = idxRaw === '' ? NaN : Number.parseInt(idxRaw, 10);
      // eslint-disable-next-line security/detect-object-injection
      record[field] = Number.isNaN(idx) ? '' : (cells[idx] ?? '');
    }
    return record;
  });
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: '',
  item: '',
  amount: '',
  direction: '',
  category: '',
  account: '',
};

// The form-field name each mapping select posts under — shared by the import wizard's
// selects/hidden inputs AND app/actions/import.ts's readMapping, so the client form
// and the server parser can't silently drift apart.
export const MAPPING_FIELD_NAMES: Record<MappableField, string> = {
  date: 'mappingDate',
  item: 'mappingItem',
  amount: 'mappingAmount',
  direction: 'mappingDirection',
  category: 'mappingCategory',
  account: 'mappingAccount',
};

// Column-name substrings to guess a default mapping from — a convenience for the
// common case, never trusted for anything beyond pre-filling selects the user can
// still change; the server only ever acts on whatever mapping is actually submitted.
// Meaningless (and skipped by the caller) when the file has no real header row.
const FIELD_ALIASES: Record<MappableField, string[]> = {
  date: ['date'],
  item: ['item', 'description', 'desc', 'memo', 'payee'],
  amount: ['amount', 'value'],
  direction: ['direction', 'type'],
  category: ['category'],
  account: ['account'],
};

// Mapping values are column POSITIONS ("0", "1", ...), never header text — see
// ColumnMapping's doc comment above for why. First matching column wins per field.
export function guessMapping(headerLabels: string[]): ColumnMapping {
  const mapping = { ...EMPTY_MAPPING };
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    // `field` ranges over compile-time literals only — same false-positive class as
    // buildMappedRows above.
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

// What the mapping selects should DISPLAY per column: the real header labels when the
// file has them, positional "Column N" placeholders when it doesn't (sized off the
// first row — the parser gives every row whatever cells it actually had, so the first
// row is as good a width sample as any).
export function displayHeader(parsedRows: string[][], hasHeaderRow: boolean): string[] {
  if (parsedRows.length === 0) return [];
  if (hasHeaderRow) return parsedRows[0];
  const columnCount = parsedRows[0].length;
  return Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
}

// --- Amount / date coercion ---------------------------------------------------------

// Strips currency symbols/commas/whitespace and handles parenthesized negatives
// (a common bank-statement convention for "money out", e.g. "($120.00)"), then
// delegates the actual numeric(12,2) validation and cents computation to
// lib/money.ts's parseAmountToCents — the single canonical implementation every
// other money-entry path in the app already goes through, so a future fix to its
// rounding/digit-cap behavior can't silently diverge from what CSV import computes.
export function coerceAmountToCents(raw: string): { ok: true; cents: number } | { ok: false } {
  let s = raw.trim();
  if (s === '') return { ok: false };
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, '');
  // A second sign character surviving the stripping above (e.g. "--500", or a
  // parenthesized value with its own inner "-" like "(-500)") means this cell had
  // redundant/conflicting sign notation. Reject rather than hand it to
  // parseAmountToCents, whose own optional leading "-" would otherwise cancel out the
  // `negative` flag already extracted here and silently flip the sign back —
  // "--500" would import as +$500.00 (income) instead of being rejected as malformed.
  if (s.startsWith('-') || s.startsWith('+')) return { ok: false };
  try {
    const cents = parseAmountToCents(s);
    // `cents !== 0` guards against a literal negative-zero result ("-0.00"/"($0.00)")
    // — `-0 < 0` is false in JS, so without this a $0.00 row explicitly marked
    // negative would still infer as 'income' in normalizeRow's sign-based direction
    // fallback below.
    return { ok: true, cents: negative && cents !== 0 ? -cents : cents };
  } catch {
    return { ok: false };
  }
}

// Supports the two unambiguous formats this app can reliably round-trip: ISO
// (YYYY-MM-DD, this app's own export format) and US-style slash dates (M/D/YYYY or
// MM/DD/YYYY, the common Excel/bank-export convention). Deliberately does NOT guess
// at DD/MM/YYYY — it's ambiguous with MM/DD/YYYY for any day <=12, and silently
// guessing wrong would misfile a transaction into the wrong month, which is worse
// than rejecting the row with a clear error. Calendar-impossible dates (e.g.
// 2026-02-30) are rejected via month-params.ts's isValidCalendarDate — the same
// shared check app/actions/monthly.ts's dateInputSchema uses, rather than a second
// copy of the same round-trip logic.
export function coerceDate(raw: string): { ok: true; iso: string } | { ok: false } {
  const s = raw.trim();
  if (s === '') return { ok: false };

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);

  let year: number, month: number, day: number;
  if (isoMatch) {
    [, year, month, day] = isoMatch.map(Number) as unknown as [number, number, number, number];
  } else if (usMatch) {
    const [, m, d, y] = usMatch;
    year = Number(y);
    month = Number(m);
    day = Number(d);
  } else {
    return { ok: false };
  }

  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false };
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isValidCalendarDate(iso)) return { ok: false };
  return { ok: true, iso };
}

// --- Row normalization ---------------------------------------------------------------

export interface NormalizedImportRow {
  rowNumber: number; // 1-based, counting only data rows (header excluded) — for display
  year: number;
  month: number;
  item: string;
  direction: 'income' | 'expense';
  amountCents: number;
  actualDate: string; // ISO YYYY-MM-DD
  categoryName: string | null;
  accountName: string | null;
}

export interface RowError {
  rowNumber: number;
  message: string;
}

export function normalizeRow(
  record: Record<MappableField, string>,
  rowNumber: number,
): { ok: true; row: NormalizedImportRow } | { ok: false; error: RowError } {
  const item = record.item.trim();
  if (item === '') {
    return { ok: false, error: { rowNumber, message: 'Missing item/description.' } };
  }

  const date = coerceDate(record.date);
  if (!date.ok) {
    return { ok: false, error: { rowNumber, message: 'Missing or unrecognized date.' } };
  }

  const amount = coerceAmountToCents(record.amount);
  if (!amount.ok) {
    return { ok: false, error: { rowNumber, message: 'Missing or unrecognized amount.' } };
  }

  let direction: 'income' | 'expense';
  const directionRaw = record.direction.trim().toLowerCase();
  if (directionRaw === 'income' || directionRaw === 'expense') {
    direction = directionRaw;
  } else if (directionRaw !== '') {
    return {
      ok: false,
      error: { rowNumber, message: 'Direction must be "income" or "expense".' },
    };
  } else {
    // No explicit direction column mapped — infer from the amount's sign, the common
    // bank-statement convention (negative = money out = expense).
    direction = amount.cents < 0 ? 'expense' : 'income';
  }

  const [year, month] = date.iso.split('-').map(Number);
  return {
    ok: true,
    row: {
      rowNumber,
      year,
      month,
      item,
      direction,
      amountCents: Math.abs(amount.cents),
      actualDate: date.iso,
      categoryName: record.category.trim() || null,
      accountName: record.account.trim() || null,
    },
  };
}

// --- Fuzzy item-name matching --------------------------------------------------------

function normalizeItemName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

// Standard Levenshtein edit distance — iterative, O(n*m), fine at item-name lengths
// (tens of characters, not megabytes).
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const curr = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // i/j are bounded by the enclosing for-loops (1..m, 1..n); prev/curr are sized
      // to match. Same false-positive class as elsewhere in this file.
      // eslint-disable-next-line security/detect-object-injection
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  // eslint-disable-next-line security/detect-object-injection
  return prev[n];
}

// 0 (nothing alike) to 1 (identical, after normalization).
export function itemNameSimilarity(a: string, b: string): number {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  if (na === nb) return 1;
  if (na === '' || nb === '') return 0;
  if (na.includes(nb) || nb.includes(na)) {
    // A short/generic substring (e.g. "Fee" inside "Late Fee") shouldn't earn the
    // same high-confidence bonus as a near-complete substring match (e.g.
    // "Starbucks" inside "Starbucks #4521") — a generic short string would otherwise
    // spuriously match ANY existing entry whose name happens to contain it. Scale the
    // bonus by how much of the longer string the shorter one actually covers; a weak
    // substring falls through to plain Levenshtein scoring instead, which correctly
    // penalizes the length mismatch.
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    if (shorter / longer >= 0.5) return 0.9;
  }
  const distance = levenshteinDistance(na, nb);
  return 1 - distance / Math.max(na.length, nb.length);
}

export const FUZZY_MATCH_THRESHOLD = 0.6;

// --- Row classification against existing household data -----------------------------

export interface MatchCandidateEntry {
  id: string;
  item: string;
  direction: 'income' | 'expense' | null;
  budgetedCents: number;
  actualCents: number | null;
}

export type RowClassification =
  | { status: 'duplicate-in-file'; row: NormalizedImportRow }
  | { status: 'already-applied'; row: NormalizedImportRow; entryId: string }
  | { status: 'match'; row: NormalizedImportRow; entryId: string; candidateItem: string }
  | { status: 'new'; row: NormalizedImportRow }
  | { status: 'error'; error: RowError };

function amountsClose(a: number, b: number): boolean {
  const tolerance = Math.max(50, Math.round(Math.abs(a) * 0.05));
  return Math.abs(a - b) <= tolerance;
}

// Classifies one already-normalized row against the entries already in its
// household/year/month (candidates is expected to be pre-filtered by the caller to
// exactly that year+month — this function doesn't re-filter by date). Idempotent
// re-import falls directly out of this: a row whose target entry ALREADY has this
// exact actual amount recorded (whether that entry came from a recurring forecast or
// a PRIOR run of this same import) is "already-applied", not "match" — so re-running
// the identical file a second time classifies every row as a no-op rather than
// re-writing the same value or creating a duplicate ad-hoc entry. No stored content
// hash needed (a deviation from spec.md's literal "content hash" wording, logged in
// spec.md) — the DB's own current state IS the hash-equivalent check.
//
// `claimedEntryIds` is how the caller (lib/import-csv.ts's runImportPipeline, which
// calls this once per row in a loop over the SAME candidates array) prevents two
// different rows in the same file from both matching the same single existing entry —
// without it, two distinct real transactions that both plausibly resemble one
// forecast would both classify as 'match' against it, and commitImport's two
// sequential UPDATEs to that one row would silently lose whichever applied first.
export function classifyRow(
  row: NormalizedImportRow,
  candidates: MatchCandidateEntry[],
  claimedEntryIds: ReadonlySet<string> = new Set(),
): RowClassification {
  // `c.direction === null` (an uncategorized entry — e.g. one this same import
  // created on a prior run with no category mapped) must count as a candidate here
  // too, same as forecastCandidates below — otherwise an uncategorized row could NEVER
  // be recognized as already-applied (null direction can never === 'income'/'expense'),
  // and re-importing an unmapped-category file would keep inserting duplicates forever.
  // Not filtered by claimedEntryIds: an already-applied entry causes no write, so two
  // rows resolving to the same already-applied entry is harmless (both correctly no-op).
  const alreadyApplied = candidates.find(
    (c) =>
      (c.direction === null || c.direction === row.direction) &&
      c.actualCents === row.amountCents &&
      itemNameSimilarity(c.item, row.item) >= FUZZY_MATCH_THRESHOLD,
  );
  if (alreadyApplied) {
    return { status: 'already-applied', row, entryId: alreadyApplied.id };
  }

  const forecastCandidates = candidates.filter(
    (c) =>
      c.actualCents === null &&
      !claimedEntryIds.has(c.id) &&
      (c.direction === null || c.direction === row.direction) &&
      amountsClose(c.budgetedCents, row.amountCents),
  );
  let best: { candidate: MatchCandidateEntry; score: number } | null = null;
  for (const candidate of forecastCandidates) {
    const score = itemNameSimilarity(candidate.item, row.item);
    if (score >= FUZZY_MATCH_THRESHOLD && (best === null || score > best.score)) {
      best = { candidate, score };
    }
  }
  if (best) {
    return { status: 'match', row, entryId: best.candidate.id, candidateItem: best.candidate.item };
  }

  return { status: 'new', row };
}

// Marks every row after the first occurrence of an identical (actualDate, direction,
// amountCents, normalized item) tuple as a file-internal duplicate — spec.md's "dedup
// within file" edge case. Applied before classifyRow, so duplicates never reach the
// DB-matching step at all. Keyed on the full date, not just year+month — two
// genuinely distinct transactions (e.g. two Netflix charges on different days of the
// same month) must never collapse into one just because they share an item/amount;
// only an exact same-day repeat is a plausible accidental duplicate in the source file.
export function dedupWithinFile(rows: NormalizedImportRow[]): {
  unique: NormalizedImportRow[];
  duplicates: NormalizedImportRow[];
} {
  const seen = new Set<string>();
  const unique: NormalizedImportRow[] = [];
  const duplicates: NormalizedImportRow[] = [];
  for (const row of rows) {
    const key = `${row.actualDate}-${row.direction}-${row.amountCents}-${normalizeItemName(row.item)}`;
    if (seen.has(key)) {
      duplicates.push(row);
    } else {
      seen.add(key);
      unique.push(row);
    }
  }
  return { unique, duplicates };
}

// --- CSV serialization (export) -----------------------------------------------------

// spec.md Phase 5 adversarial case: formula-injection cells. A cell that OPENS a
// spreadsheet formula when the file is later opened in Excel/Sheets (=, +, -, @ as the
// first character — the well-known CSV-injection prefix set) gets a leading `'`
// prepended, which every major spreadsheet program treats as "force this cell to plain
// text" and never renders. Applied to every cell uniformly (not just free-text
// columns like Item/Category/Account) — numbers never start with any of these
// characters in this app's data (amounts are always non-negative), so it's a no-op for
// them, and it means a future column added to the export can't reintroduce this gap by
// accident.
function escapeCsvField(raw: string): string {
  let value = raw;
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }
  if (/["\n\r,]/.test(value)) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvField(cell === null ? '' : String(cell))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
