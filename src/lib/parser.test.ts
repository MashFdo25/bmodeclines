import { describe, it, expect } from 'vitest';
import {
  convert,
  toIsoDate,
  statusMessage,
  extractSettlementDate,
  extractRowFields,
  buildRow,
  DEFAULTS,
  COLUMN_COUNT,
} from './parser';

const SAMPLE = `BMO EFT RETURN REPORT  RPTBYT800001C
RUN DATE: 2026-06-16        SETTLEMENT DATE: 2026-06-16
CLIENT: 6603849900  CANADIAN EFT RETURNS

REC  CROSS REFERENCE NO.   ACCOUNT NO.   RSN CDE   AMOUNT
D    5O8HA38J2K7JM3        5040720       901       $79.04
D    7K2LP91Q8R4ST5        5040721       908       $120.00
D    9M3QW55Z1Y8UV6        5040722       915       $1,250.50

TOTAL RECORDS: 3
`;

describe('statusMessage mapping (Section 3.3)', () => {
  it('maps 901 to NSF DEBIT', () => {
    expect(statusMessage('901')).toBe('NSF DEBIT * DO NOT RETRY =');
  });
  it('maps 908 to FUNDS NOT CLEARED', () => {
    expect(statusMessage('908')).toBe('FUNDS NOT CLEARED * DO NOT RETRY =');
  });
  it('maps anything else to the default DECLINE RECORD', () => {
    expect(statusMessage('915')).toBe('DECLINE RECORD * DO NOT RETRY =');
    expect(statusMessage('000')).toBe('DECLINE RECORD * DO NOT RETRY =');
  });
});

describe('toIsoDate', () => {
  it('passes through ISO', () => expect(toIsoDate('2026-06-16')).toBe('2026-06-16'));
  it('handles slashes', () => expect(toIsoDate('2026/06/16')).toBe('2026-06-16'));
  it('handles "JUN 16, 2026"', () => expect(toIsoDate('JUN 16, 2026')).toBe('2026-06-16'));
  it('handles "16-JUN-2026"', () => expect(toIsoDate('16-JUN-2026')).toBe('2026-06-16'));
  it('handles "16JUN2026"', () => expect(toIsoDate('16JUN2026')).toBe('2026-06-16'));
  it('handles Canadian DD/MM/YYYY', () => expect(toIsoDate('16/06/2026')).toBe('2026-06-16'));
  it('returns empty on garbage', () => expect(toIsoDate('not a date')).toBe(''));
});

describe('extractSettlementDate', () => {
  it('pulls the settlement date from the header', () => {
    expect(extractSettlementDate(SAMPLE)).toBe('2026-06-16');
  });
});

describe('extractRowFields', () => {
  it('extracts all four source fields', () => {
    const { fields } = extractRowFields('D    5O8HA38J2K7JM3        5040720       901       $79.04');
    expect(fields).toEqual({
      crossRef: '5O8HA38J2K7JM3',
      account: '5040720',
      reason: '901',
      amount: '79.04',
    });
  });
  it('strips currency symbols and thousands separators', () => {
    const { fields } = extractRowFields('D  9M3QW55Z1Y8UV6  5040722  915  $1,250.50');
    expect(fields?.amount).toBe('1250.50');
  });
  it('reports an error when a field is missing', () => {
    const { fields, error } = extractRowFields('D    onlytext');
    expect(fields).toBeUndefined();
    expect(error).toMatch(/could not extract/);
  });
});

describe('buildRow (16-column mapping)', () => {
  const row = buildRow(
    { crossRef: '5O8HA38J2K7JM3', account: '5040720', reason: '901', amount: '79.04' },
    '2026-06-16',
    0,
    DEFAULTS,
  );

  it('produces exactly 16 columns', () => expect(row).toHaveLength(COLUMN_COUNT));
  it('left-pads cross reference to 50 chars', () => {
    expect(row[0]).toHaveLength(50);
    expect(row[0]).toBe('5O8HA38J2K7JM3'.padEnd(50, ' '));
  });
  it('prefixes + zero-pads the account to the masked id', () => {
    expect(row[1]).toBe('660384990005040720');
  });
  it('carries the reason code and mapped status message', () => {
    expect(row[2]).toBe('901');
    expect(row[9]).toBe('NSF DEBIT * DO NOT RETRY =');
  });
  it('emits the hardcoded constants', () => {
    expect(row[3]).toBe('04');
    expect(row[4]).toBe('000000');
    expect(row[5]).toBe('17:07:23');
    expect(row[7]).toBe('00');
    expect(row[8]).toBe('true');
    expect(row[11]).toBe('V');
    expect(row[13]).toBe('false');
    expect(row[15]).toBe('null');
  });
  it('settlement date, amount, trace, blank position', () => {
    expect(row[6]).toBe('2026-06-16');
    expect(row[10]).toBe('79.04');
    expect(row[12]).toBe('293804-0_649');
    expect(row[14]).toBe('');
  });
});

describe('convert (end-to-end)', () => {
  const result = convert(SAMPLE);

  it('converts every data row', () => {
    expect(result.count).toBe(3);
    expect(result.errors).toHaveLength(0);
  });
  it('extracts the settlement date once for the whole file', () => {
    expect(result.settlementDate).toBe('2026-06-16');
  });
  it('increments the trace identifier per row', () => {
    expect(result.rows[0][12]).toBe('293804-0_649');
    expect(result.rows[1][12]).toBe('293804-0_650');
    expect(result.rows[2][12]).toBe('293804-0_651');
  });
  it('uses the default status message for the unknown 915 code', () => {
    expect(result.rows[2][9]).toBe('DECLINE RECORD * DO NOT RETRY =');
  });
  it('produces a header-less CSV (Requirement 3.4.2)', () => {
    const firstLine = result.csv.split('\r\n')[0];
    expect(firstLine.startsWith('5O8HA38J2K7JM3')).toBe(true);
  });
  it('names the file per Requirement 3.4.3', () => {
    expect(result.fileName).toBe('BMO_EFT_Ingest_2026-06-16.csv');
  });
  it('ignores metadata/header lines', () => {
    // None of the non-D lines should have become rows.
    expect(result.rows.every((r) => r.length === COLUMN_COUNT)).toBe(true);
  });
});
