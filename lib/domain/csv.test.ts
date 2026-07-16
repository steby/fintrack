import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  parseCsvText,
  checkCsvByteSize,
  checkCsvRowCount,
  checkCsvEncoding,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  buildMappedRows,
  coerceAmountToCents,
  coerceDate,
  normalizeRow,
  itemNameSimilarity,
  FUZZY_MATCH_THRESHOLD,
  classifyRow,
  dedupWithinFile,
  buildCsv,
  guessMapping,
  displayHeader,
  EMPTY_MAPPING,
  type ColumnMapping,
  type NormalizedImportRow,
  type MatchCandidateEntry,
} from './csv';

describe('parseCsvText', () => {
  it('parses a simple header + rows', () => {
    const rows = parseCsvText('Date,Item,Amount\n2026-01-05,Coffee,4.50\n2026-01-06,Rent,-2000\n');
    expect(rows).toEqual([
      ['Date', 'Item', 'Amount'],
      ['2026-01-05', 'Coffee', '4.50'],
      ['2026-01-06', 'Rent', '-2000'],
    ]);
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const rows = parseCsvText('Item,Notes\n"Coffee, large","line1\nline2"\n');
    expect(rows).toEqual([
      ['Item', 'Notes'],
      ['Coffee, large', 'line1\nline2'],
    ]);
  });

  it('handles doubled-quote escaping inside a quoted field', () => {
    const rows = parseCsvText('Item\n"Bob""s Diner"\n');
    expect(rows).toEqual([['Item'], ['Bob"s Diner']]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsvText('A,B\r\n1,2\r\n');
    expect(rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('handles bare-CR line endings (classic Mac, no trailing \\n) instead of merging every row into one', () => {
    const rows = parseCsvText('A,B\r1,2\r3,4\r');
    expect(rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles a mix of CRLF and bare-CR line endings in the same file', () => {
    const rows = parseCsvText('A,B\r\n1,2\r3,4\n');
    expect(rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles a file with no trailing newline', () => {
    const rows = parseCsvText('A,B\n1,2');
    expect(rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseCsvText('')).toEqual([]);
  });

  it('tolerates an unterminated quote at EOF instead of throwing', () => {
    expect(() => parseCsvText('Item\n"unterminated')).not.toThrow();
    expect(parseCsvText('Item\n"unterminated')).toEqual([['Item'], ['unterminated']]);
  });

  it('treats a quote mid-field as a literal character, not the start of a quoted section (regression: a stray quote must never swallow subsequent rows)', () => {
    const rows = parseCsvText(
      'Date,Item,Amount\n2026-01-01,12" cable,5.00\n2026-01-02,Coffee,3.00\n2026-01-03,Tea,2.00\n',
    );
    expect(rows).toEqual([
      ['Date', 'Item', 'Amount'],
      ['2026-01-01', '12" cable', '5.00'],
      ['2026-01-02', 'Coffee', '3.00'],
      ['2026-01-03', 'Tea', '2.00'],
    ]);
  });

  describe('property: never throws on arbitrary input', () => {
    it('holds for any string', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => parseCsvText(input)).not.toThrow();
        }),
      );
    });
  });
});

describe('checkCsvByteSize', () => {
  it('accepts a small file', () => {
    expect(checkCsvByteSize('a,b\n1,2')).toEqual({ ok: true });
  });

  it('rejects a file over the byte cap', () => {
    const result = checkCsvByteSize('x'.repeat(MAX_CSV_BYTES + 1));
    if (result.ok) throw new Error('expected ok: false');
    expect(result.error).toMatch(/too large/i);
  });
});

describe('checkCsvRowCount', () => {
  it('accepts a row count at or under the cap', () => {
    expect(checkCsvRowCount(MAX_CSV_ROWS)).toEqual({ ok: true });
  });

  it('rejects a row count over the cap', () => {
    const result = checkCsvRowCount(MAX_CSV_ROWS + 1);
    if (result.ok) throw new Error('expected ok: false');
    expect(result.error).toMatch(/too many rows/i);
  });
});

describe('checkCsvEncoding', () => {
  it('accepts plain ASCII/UTF-8 text', () => {
    expect(checkCsvEncoding('Date,Item,Amount\n2026-01-05,Coffee,4.50\n')).toEqual({ ok: true });
  });

  it('accepts genuine non-Latin UTF-8 text', () => {
    expect(checkCsvEncoding('Date,Item,Amount\n2026-01-05,咖啡,4.50\n')).toEqual({ ok: true });
  });

  it('rejects text containing the UTF-8 replacement character, the signature of a mis-decoded file', () => {
    // Simulates what File.text() produces for a file actually saved in a different
    // encoding (e.g. Windows-1252) — invalid byte sequences decode to U+FFFD.
    const result = checkCsvEncoding('Date,Item,Amount\n2026-01-05,Caf�,4.50\n');
    if (result.ok) throw new Error('expected ok: false');
    expect(result.error).toMatch(/utf-8/i);
  });
});

describe('buildMappedRows', () => {
  it('maps CSV columns to logical fields by column position', () => {
    const data = [['2026-01-05', 'Coffee', '4.50']];
    const mapping: ColumnMapping = {
      date: '0',
      item: '1',
      amount: '2',
      direction: '',
      category: '',
      account: '',
    };
    expect(buildMappedRows(data, mapping)).toEqual([
      {
        date: '2026-01-05',
        item: 'Coffee',
        amount: '4.50',
        direction: '',
        category: '',
        account: '',
      },
    ]);
  });

  it('leaves a field blank when unmapped or the mapped position is out of range', () => {
    const data = [['2026-01-05', 'Coffee']];
    const mapping: ColumnMapping = {
      date: '0',
      item: '1',
      amount: '5', // no column at this position
      direction: '',
      category: '',
      account: '',
    };
    expect(buildMappedRows(data, mapping)[0].amount).toBe('');
  });

  it('leaves a field blank for a ragged row shorter than the mapped position (mapped position is valid in general, but this row has no cell there)', () => {
    const data = [['2026-01-05', 'Coffee']]; // no third cell
    const mapping: ColumnMapping = {
      date: '0',
      item: '1',
      amount: '2',
      direction: '',
      category: '',
      account: '',
    };
    expect(buildMappedRows(data, mapping)[0].amount).toBe('');
  });

  it('two logical fields can safely map to the SAME column position (e.g. re-deriving both date and something else from one column) without one overwriting the other', () => {
    const data = [['2026-01-05', 'Coffee']];
    const mapping: ColumnMapping = {
      date: '0',
      item: '1',
      amount: '1', // deliberately same position as item, for this test
      direction: '',
      category: '',
      account: '',
    };
    const [row] = buildMappedRows(data, mapping);
    expect(row.item).toBe('Coffee');
    expect(row.amount).toBe('Coffee');
  });
});

describe('coerceAmountToCents', () => {
  it.each([
    ['4.50', 450],
    ['4', 400],
    ['1,234.56', 123456],
    ['$1,234.56', 123456],
    ['-120.00', -12000],
    ['(120.00)', -12000],
    ['+50.00', 5000],
    [' 12.34 ', 1234],
  ])('parses %s -> %i cents', (input, expected) => {
    const result = coerceAmountToCents(input);
    expect(result).toEqual({ ok: true, cents: expected });
  });

  it.each(['', 'abc', '1.2.3', '12345678901', '1.234', 'NaN', 'Infinity'])(
    'rejects %s',
    (input) => {
      expect(coerceAmountToCents(input)).toEqual({ ok: false });
    },
  );

  it('rejects a doubly-signed amount instead of silently cancelling the signs back to positive (regression)', () => {
    // "--500" would previously delegate to parseAmountToCents("-500"), whose own
    // leading '-' canceled out the '-' already stripped here, silently flipping the
    // sign back to positive ($500.00 income) instead of being rejected.
    expect(coerceAmountToCents('--500')).toEqual({ ok: false });
    expect(coerceAmountToCents('++5.00')).toEqual({ ok: false });
  });

  it('a parenthesized value with a redundant inner minus sign is still just negative, not a conflict (both notations agree)', () => {
    expect(coerceAmountToCents('(-500)')).toEqual({ ok: true, cents: -50000 });
  });
});

describe('coerceDate', () => {
  it('accepts ISO dates', () => {
    expect(coerceDate('2026-01-05')).toEqual({ ok: true, iso: '2026-01-05' });
  });

  it('accepts US slash dates, including single-digit month/day', () => {
    expect(coerceDate('1/5/2026')).toEqual({ ok: true, iso: '2026-01-05' });
    expect(coerceDate('12/25/2026')).toEqual({ ok: true, iso: '2026-12-25' });
  });

  it('rejects a calendar-impossible date instead of silently rolling over', () => {
    expect(coerceDate('2026-02-30')).toEqual({ ok: false });
  });

  it('rejects out-of-range years', () => {
    expect(coerceDate('1899-01-01')).toEqual({ ok: false });
  });

  it('rejects unparseable garbage', () => {
    expect(coerceDate('not-a-date')).toEqual({ ok: false });
    expect(coerceDate('')).toEqual({ ok: false });
  });

  it('does not guess at ambiguous DD/MM/YYYY dates', () => {
    // 25 can't be a month, so this is unambiguous as DD/MM — but this app only ever
    // interprets slash dates as MM/DD, so it's correctly rejected rather than guessed.
    expect(coerceDate('25/12/2026')).toEqual({ ok: false });
  });
});

describe('normalizeRow', () => {
  const baseRecord = {
    date: '2026-01-05',
    item: 'Coffee',
    amount: '4.50',
    direction: '',
    category: '',
    account: '',
  };

  it('normalizes a complete valid row, inferring income from a positive amount', () => {
    const result = normalizeRow(baseRecord, 1);
    expect(result).toEqual({
      ok: true,
      row: {
        rowNumber: 1,
        year: 2026,
        month: 1,
        item: 'Coffee',
        direction: 'income',
        amountCents: 450,
        actualDate: '2026-01-05',
        categoryName: null,
        accountName: null,
      },
    });
  });

  it('infers expense from a negative amount', () => {
    const result = normalizeRow({ ...baseRecord, amount: '-4.50' }, 1);
    expect(result.ok && result.row.direction).toBe('expense');
    expect(result.ok && result.row.amountCents).toBe(450); // always stored positive
  });

  it('an explicit direction column overrides sign inference', () => {
    const result = normalizeRow({ ...baseRecord, amount: '4.50', direction: 'Expense' }, 1);
    expect(result.ok && result.row.direction).toBe('expense');
  });

  it('rejects an unrecognized direction value', () => {
    const result = normalizeRow({ ...baseRecord, direction: 'sideways' }, 1);
    expect(result).toEqual({ ok: false, error: { rowNumber: 1, message: expect.any(String) } });
  });

  it('rejects a missing item', () => {
    const result = normalizeRow({ ...baseRecord, item: '  ' }, 3);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.rowNumber).toBe(3);
  });

  it('rejects a missing/unrecognized date', () => {
    expect(normalizeRow({ ...baseRecord, date: '' }, 1).ok).toBe(false);
    expect(normalizeRow({ ...baseRecord, date: 'garbage' }, 1).ok).toBe(false);
  });

  it('rejects a missing/unrecognized amount', () => {
    expect(normalizeRow({ ...baseRecord, amount: '' }, 1).ok).toBe(false);
    expect(normalizeRow({ ...baseRecord, amount: 'free' }, 1).ok).toBe(false);
  });

  it('carries category/account names through when mapped', () => {
    const result = normalizeRow({ ...baseRecord, category: 'Groceries', account: 'Checking' }, 1);
    expect(result.ok && result.row.categoryName).toBe('Groceries');
    expect(result.ok && result.row.accountName).toBe('Checking');
  });
});

describe('itemNameSimilarity', () => {
  it('is 1 for identical strings, case/whitespace-insensitive', () => {
    expect(itemNameSimilarity('Coffee Shop', '  coffee   shop  ')).toBe(1);
  });

  it('is high for a substring relationship', () => {
    expect(itemNameSimilarity('Starbucks', 'Starbucks #4521')).toBeGreaterThanOrEqual(0.6);
  });

  it('is 0 for one empty and one non-empty string', () => {
    expect(itemNameSimilarity('', 'Coffee')).toBe(0);
  });

  it('is low for unrelated strings', () => {
    expect(itemNameSimilarity('Coffee', 'Mortgage Payment')).toBeLessThan(0.6);
  });

  it('does not give a short/generic substring the same high-confidence score as a near-complete one (regression: "Fee" must not spuriously match "Late Fee")', () => {
    expect(itemNameSimilarity('Fee', 'Late Fee')).toBeLessThan(FUZZY_MATCH_THRESHOLD);
  });
});

describe('classifyRow', () => {
  const row: NormalizedImportRow = {
    rowNumber: 1,
    year: 2026,
    month: 1,
    item: 'Groceries',
    direction: 'expense',
    amountCents: 10000,
    actualDate: '2026-01-05',
    categoryName: null,
    accountName: null,
  };

  // A forecast (unactualized) candidate has null actual amount AND null actual date;
  // an already-applied one carries both. Defaults keep each test stating only the
  // fields it actually cares about.
  const makeCandidate = (overrides: Partial<MatchCandidateEntry> = {}): MatchCandidateEntry => ({
    id: 'e1',
    item: 'Groceries',
    direction: 'expense',
    budgetedCents: 10000,
    actualCents: null,
    actualDate: null,
    ...overrides,
  });

  it('classifies as "match" against an unactualized forecast with a close amount and similar name', () => {
    const result = classifyRow(row, [makeCandidate()]);
    expect(result).toEqual({ status: 'match', row, entryId: 'e1', candidateItem: 'Groceries' });
  });

  it('classifies as "already-applied" when an entry already has this exact actual amount AND date', () => {
    const candidates = [makeCandidate({ actualCents: 10000, actualDate: '2026-01-05' })];
    expect(classifyRow(row, candidates)).toEqual({ status: 'already-applied', row, entryId: 'e1' });
  });

  it('does NOT treat a same-amount, same-item entry on a DIFFERENT day as already-applied (regression: two real repeat purchases in one month)', () => {
    // A genuine second $100 Groceries purchase later the same month must import as its
    // own entry, not be swallowed as a re-import no-op of the first. Matching on amount
    // alone (no date) used to drop it silently.
    const candidates = [makeCandidate({ actualCents: 10000, actualDate: '2026-01-17' })];
    expect(classifyRow(row, candidates)).toEqual({ status: 'new', row });
  });

  it('classifies an uncategorized (direction: null) entry as "already-applied" too, when amount and date match', () => {
    // Regression: a row this same import previously created with no category mapped
    // has direction: null (no category to derive it from) — re-importing the
    // identical file must still recognize it as already-applied, or every re-import
    // of an unmapped-category file would insert a fresh duplicate forever.
    const candidates = [
      makeCandidate({ direction: null, actualCents: 10000, actualDate: '2026-01-05' }),
    ];
    expect(classifyRow(row, candidates)).toEqual({ status: 'already-applied', row, entryId: 'e1' });
  });

  it('classifies as "new" when nothing matches', () => {
    expect(classifyRow(row, [])).toEqual({ status: 'new', row });
  });

  it('does not match a forecast whose amount is far off, even with an identical name', () => {
    expect(classifyRow(row, [makeCandidate({ budgetedCents: 50000 })])).toEqual({
      status: 'new',
      row,
    });
  });

  it('does not match a forecast with the wrong direction', () => {
    expect(classifyRow(row, [makeCandidate({ direction: 'income' })])).toEqual({
      status: 'new',
      row,
    });
  });

  it('never matches an already-actualized entry as a "match" target (only as already-applied, or not at all)', () => {
    // Actualized to a DIFFERENT amount than this row — not a re-import no-op, and not
    // a valid "match" target either (that would silently overwrite a real actual).
    const candidates = [makeCandidate({ actualCents: 9999, actualDate: '2026-01-05' })];
    expect(classifyRow(row, candidates)).toEqual({ status: 'new', row });
  });

  it('picks the best-scoring candidate when multiple forecasts qualify', () => {
    const candidates = [
      makeCandidate({ id: 'weak', item: 'Shopping' }),
      makeCandidate({ id: 'strong', item: 'Groceries' }),
    ];
    const result = classifyRow(row, candidates);
    expect(result.status).toBe('match');
    expect(result.status === 'match' && result.entryId).toBe('strong');
  });

  it('keeps the first-found best when a later qualifying candidate scores lower, not just higher', () => {
    // Same scenario as above with the order reversed — proves the "keep existing
    // best" path (a later candidate that still clears the threshold but scores lower)
    // is itself exercised, not just the "replace with a better one" path.
    const candidates = [
      makeCandidate({ id: 'strong', item: 'Groceries' }),
      makeCandidate({ id: 'okay', item: 'Groceries Store' }),
    ];
    const result = classifyRow(row, candidates);
    expect(result.status).toBe('match');
    expect(result.status === 'match' && result.entryId).toBe('strong');
  });

  it('a claimed entry cannot be matched again by a second row (regression: two distinct rows must never both target the same forecast)', () => {
    const candidates = [makeCandidate()];
    const secondRow: NormalizedImportRow = { ...row, rowNumber: 2, item: 'Groceries Store' };

    const claimed = new Set<string>();
    const first = classifyRow(row, candidates, claimed);
    expect(first).toEqual({ status: 'match', row, entryId: 'e1', candidateItem: 'Groceries' });
    if (first.status === 'match') claimed.add(first.entryId);

    // Same candidate pool, but 'e1' is now claimed — the second row must fall
    // through to 'new' rather than also matching 'e1' (which would silently lose
    // one of the two real transactions when both UPDATEs are later applied).
    const second = classifyRow(secondRow, candidates, claimed);
    expect(second).toEqual({ status: 'new', row: secondRow });
  });

  it('an unclaimed entry-id set (the default) allows the historical single-row behavior unchanged', () => {
    expect(classifyRow(row, [makeCandidate()])).toEqual({
      status: 'match',
      row,
      entryId: 'e1',
      candidateItem: 'Groceries',
    });
  });
});

describe('dedupWithinFile', () => {
  const makeRow = (overrides: Partial<NormalizedImportRow> = {}): NormalizedImportRow => ({
    rowNumber: 1,
    year: 2026,
    month: 1,
    item: 'Coffee',
    direction: 'expense',
    amountCents: 450,
    actualDate: '2026-01-05',
    categoryName: null,
    accountName: null,
    ...overrides,
  });

  it('keeps the first occurrence and flags identical later rows as duplicates', () => {
    const a = makeRow({ rowNumber: 1 });
    const b = makeRow({ rowNumber: 2 });
    const result = dedupWithinFile([a, b]);
    expect(result.unique).toEqual([a]);
    expect(result.duplicates).toEqual([b]);
  });

  it('does not flag rows that differ in date, amount, direction, or item as duplicates', () => {
    const a = makeRow({ rowNumber: 1 });
    const differentDate = makeRow({ rowNumber: 2, actualDate: '2026-01-19' });
    const differentAmount = makeRow({ rowNumber: 3, amountCents: 500 });
    const differentDirection = makeRow({ rowNumber: 4, direction: 'income' });
    const differentItem = makeRow({ rowNumber: 5, item: 'Rent' });
    const result = dedupWithinFile([
      a,
      differentDate,
      differentAmount,
      differentDirection,
      differentItem,
    ]);
    expect(result.unique).toHaveLength(5);
    expect(result.duplicates).toHaveLength(0);
  });

  it('two genuinely distinct same-amount transactions on different days of the same month are never collapsed (e.g. two Netflix charges)', () => {
    const first = makeRow({ rowNumber: 1, item: 'Netflix', actualDate: '2026-01-05' });
    const second = makeRow({ rowNumber: 2, item: 'Netflix', actualDate: '2026-01-19' });
    const result = dedupWithinFile([first, second]);
    expect(result.unique).toEqual([first, second]);
    expect(result.duplicates).toHaveLength(0);
  });
});

describe('buildCsv', () => {
  it('produces a header row and data rows separated by CRLF', () => {
    const csv = buildCsv(['A', 'B'], [['1', '2']]);
    expect(csv).toBe('A,B\r\n1,2\r\n');
  });

  it('quotes fields containing commas, quotes, or newlines, doubling internal quotes', () => {
    const csv = buildCsv(['Item'], [['Bob, "the" Diner\nSecond line']]);
    expect(csv).toBe('Item\r\n"Bob, ""the"" Diner\nSecond line"\r\n');
  });

  it('escapes formula-injection prefixes with a leading single quote', () => {
    for (const dangerous of ['=SUM(A1:A10)', '+1+1', '-1+1', '@SUM(1)']) {
      const csv = buildCsv(['Item'], [[dangerous]]);
      expect(csv).toBe(`Item\r\n'${dangerous}\r\n`);
    }
  });

  it('does not escape a normal value that merely contains one of the dangerous characters mid-string', () => {
    const csv = buildCsv(['Item'], [['Coffee - Morning']]);
    expect(csv).toBe('Item\r\nCoffee - Morning\r\n');
  });

  it('renders null as an empty cell', () => {
    const csv = buildCsv(['A'], [[null]]);
    expect(csv).toBe('A\r\n\r\n');
  });

  it('renders numbers as plain digits', () => {
    const csv = buildCsv(['Year'], [[2026]]);
    expect(csv).toBe('Year\r\n2026\r\n');
  });
});

describe('guessMapping', () => {
  it('maps every field from exact header names, positionally', () => {
    expect(guessMapping(['Date', 'Item', 'Amount', 'Direction', 'Category', 'Account'])).toEqual({
      date: '0',
      item: '1',
      amount: '2',
      direction: '3',
      category: '4',
      account: '5',
    });
  });

  it('matches case-insensitively and on substrings of real bank headers', () => {
    expect(guessMapping(['TRANSACTION DATE', 'Payee Name', 'Value (SGD)'])).toEqual({
      ...EMPTY_MAPPING,
      date: '0',
      item: '1',
      amount: '2',
    });
  });

  it('covers every item alias a bank statement is likely to use', () => {
    for (const header of ['Description', 'desc', 'Memo', 'PAYEE', 'item']) {
      expect(guessMapping([header]).item).toBe('0');
    }
  });

  it('first matching column wins when several match one field', () => {
    // Both headers contain "amount"; the guess must be deterministic, not last-wins.
    expect(guessMapping(['Amount', 'Amount (foreign)']).amount).toBe('0');
  });

  it('one header can satisfy multiple fields', () => {
    // "value date" contains both a date alias and the "value" amount alias — each
    // field guesses independently, so both point at the same column and the user
    // resolves it in the selects.
    expect(guessMapping(['value date'])).toEqual({
      ...EMPTY_MAPPING,
      date: '0',
      amount: '0',
    });
  });

  it('leaves unmatched fields unmapped and handles an empty header row', () => {
    expect(guessMapping(['foo', 'bar'])).toEqual(EMPTY_MAPPING);
    expect(guessMapping([])).toEqual(EMPTY_MAPPING);
  });

  it('never throws and always returns position strings or empty, for arbitrary headers', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (headers) => {
        const mapping = guessMapping(headers);
        for (const value of Object.values(mapping)) {
          expect(value === '' || /^\d+$/.test(value)).toBe(true);
          if (value !== '') expect(Number(value)).toBeLessThan(headers.length);
        }
      }),
    );
  });
});

describe('displayHeader', () => {
  it('returns the first row verbatim when the file has a header row', () => {
    expect(
      displayHeader(
        [
          ['Date', 'Item'],
          ['2026-01-01', 'Rent'],
        ],
        true,
      ),
    ).toEqual(['Date', 'Item']);
  });

  it('returns positional labels sized off the first row when there is no header row', () => {
    expect(displayHeader([['2026-01-01', 'Rent', '100']], false)).toEqual([
      'Column 1',
      'Column 2',
      'Column 3',
    ]);
  });

  it('returns empty for an empty file either way', () => {
    expect(displayHeader([], true)).toEqual([]);
    expect(displayHeader([], false)).toEqual([]);
  });
});
