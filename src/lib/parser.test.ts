import { describe, it, expect } from 'vitest';
import {
  convert,
  toIsoDate,
  statusMessage,
  extractSettlementDate,
  extractRowFields,
  isDataRow,
  buildRow,
  DEFAULTS,
  COLUMN_COUNT,
} from './parser';

// A faithful slice of a real BMO returned-item report. Note the "D" record type
// appears only on the first item of each reason-code group; continuation items
// leave it blank. TOTALS lines must NOT be parsed as data.
const SAMPLE = `DEFR260                                                  BANK OF MONTREAL                                    RUN DATE: JUN 16,2026
                                             DIRECT ELECTRONIC FUNDS TRANSFER SERVICE                            PAGE:           1
   EDUCATIONAL FUNDING COMPANY                          RETURNED ITEM LIST
   BYT800001C

   FILE CREATION NO.  : 4750
                                                   SETTLEMENT DATE: JUN 16,2026
   RETURN TR/ACCT     : 0002-1164362


   RETURNED DEBIT ITEMS
+   ____________________

REC  RSN  VALUE      DEST.    PAYEE/PAYOR
TYP  CDE  DATE       INST.    ACCOUNT NO.         PAYEE/PAYOR NAME        CROSS REFERENCE NO.      AMOUNT

 D   901  JUN 15  0003-00126  5040720      MRS FERNANDO SORRENTI          5O8HA38J2K7JM3H7GT           $79.04
     901  JUN 15  0004-18642  6390603      MRS ROXANA  MNACO              ZUZLTDKK9V7JM3H7JA           $84.69
     901  JUN 15  0004-30262  6030311      MR MAX ABEIRO                  5O8L49ALML7JM3H7H8           $63.55
     901  JUN 15  0010-30800  0086526621   MRMS JASON T                   LQ74BYXQ4A7JM3H7IH           $67.74

                                            TOTALS FOR REASON CODE: 901   #       4                   $295.02

     908  JUN 15  0004-02352  6577047      MR JAYDEN BURGHER              5O8H73SQQ27JM3H7GS           $90.34

                                            TOTALS FOR REASON CODE: 908   #       1                    $90.34

                                            TOTALS FOR RECORD TYPE: D     #       5                   $385.36

                                  *** TOTAL ITEMS FOR FILE ***            #       5
`;

describe('statusMessage mapping (Section 3.3)', () => {
  it('maps 901 to NSF DEBIT', () => {
    expect(statusMessage('901')).toBe('NSF DEBIT =');
  });
  it('maps 908 to FUNDS NOT CLEARED', () => {
    expect(statusMessage('908')).toBe('FUNDS NOT CLEARED =');
  });
  it('maps additional Canadian AFT return reason codes', () => {
    expect(statusMessage('905')).toBe('ACCOUNT CLOSED =');
    expect(statusMessage('903')).toBe('PAYMENT STOPPED / RECALLED =');
    expect(statusMessage('912')).toBe('INVALID / INCORRECT ACCOUNT NO. =');
    expect(statusMessage('922')).toBe('CUSTOMER INITIATED RETURN =');
    expect(statusMessage('990')).toBe('DEFAULT BY A FINANCIAL INSTITUTION =');
  });
  it('falls back to DECLINE RECORD for unknown codes', () => {
    expect(statusMessage('000')).toBe('DECLINE RECORD =');
    expect(statusMessage('999')).toBe('DECLINE RECORD =');
  });
});

describe('toIsoDate', () => {
  it('passes through ISO', () => expect(toIsoDate('2026-06-16')).toBe('2026-06-16'));
  it('handles slashes', () => expect(toIsoDate('2026/06/16')).toBe('2026-06-16'));
  it('handles BMO "JUN 16,2026" (comma, no space)', () =>
    expect(toIsoDate('JUN 16,2026')).toBe('2026-06-16'));
  it('handles "JUN 16, 2026"', () => expect(toIsoDate('JUN 16, 2026')).toBe('2026-06-16'));
  it('handles "16-JUN-2026"', () => expect(toIsoDate('16-JUN-2026')).toBe('2026-06-16'));
  it('handles Canadian DD/MM/YYYY', () => expect(toIsoDate('16/06/2026')).toBe('2026-06-16'));
  it('returns empty on garbage', () => expect(toIsoDate('not a date')).toBe(''));
});

describe('extractSettlementDate', () => {
  it('pulls the settlement date (not the run date) from the header', () => {
    expect(extractSettlementDate(SAMPLE)).toBe('2026-06-16');
  });
});

describe('isDataRow', () => {
  it('matches the first item of a group (with the D record type)', () => {
    expect(isDataRow(' D   901  JUN 15  0003-00126  5040720  X  5O8HA38J2K7JM3H7GT  $79.04')).toBe(true);
  });
  it('matches continuation items (blank record type)', () => {
    expect(isDataRow('     901  JUN 15  0004-18642  6390603  X  ZUZLTDKK9V7JM3H7JA  $84.69')).toBe(true);
  });
  it('rejects TOTALS lines', () => {
    expect(isDataRow('   TOTALS FOR REASON CODE: 901   #       4   $295.02')).toBe(false);
  });
  it('rejects metadata lines that contain a dest-inst-like code', () => {
    expect(isDataRow('   RETURN TR/ACCT     : 0002-1164362')).toBe(false);
  });
  it('rejects header lines', () => {
    expect(isDataRow('TYP  CDE  DATE       INST.    ACCOUNT NO.')).toBe(false);
  });
});

describe('extractRowFields', () => {
  it('extracts all four source fields from a leading-D row', () => {
    const { fields } = extractRowFields(
      ' D   901  JUN 15  0003-00126  5040720      MRS FERNANDO SORRENTI          5O8HA38J2K7JM3H7GT           $79.04',
    );
    expect(fields).toEqual({
      crossRef: '5O8HA38J2K7JM3H7GT',
      account: '5040720',
      reason: '901',
      amount: '79.04',
    });
  });
  it('extracts from a continuation row and handles a long account', () => {
    const { fields } = extractRowFields(
      '     901  JUN 15  0010-30800  0086526621   MRMS JASON T                   LQ74BYXQ4A7JM3H7IH           $67.74',
    );
    expect(fields).toEqual({
      crossRef: 'LQ74BYXQ4A7JM3H7IH',
      account: '0086526621',
      reason: '901',
      amount: '67.74',
    });
  });
  it('handles multi-word names without picking up a name token', () => {
    const { fields } = extractRowFields(
      '     901  JUN 15  0004-18642  6390603      MRS ROXANA  MNACO              ZUZLTDKK9V7JM3H7JA           $84.69',
    );
    expect(fields?.crossRef).toBe('ZUZLTDKK9V7JM3H7JA');
    expect(fields?.account).toBe('6390603');
  });
});

describe('buildRow (16-column mapping)', () => {
  const row = buildRow(
    { crossRef: '5O8HA38J2K7JM3H7GT', account: '5040720', reason: '901', amount: '79.04' },
    '2026-06-16',
    0,
    DEFAULTS,
  );

  it('produces exactly 16 columns', () => expect(row).toHaveLength(COLUMN_COUNT));
  it('left-pads cross reference to 50 chars', () => {
    expect(row[0]).toHaveLength(50);
    expect(row[0]).toBe('5O8HA38J2K7JM3H7GT'.padEnd(50, ' '));
  });
  it('prefixes + zero-pads the account to the masked id', () => {
    expect(row[1]).toBe('660384990005040720');
  });
  it('carries the reason code and mapped status message', () => {
    expect(row[2]).toBe('901');
    expect(row[9]).toBe('NSF DEBIT =');
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

describe('convert (end-to-end against the real BMO layout)', () => {
  const result = convert(SAMPLE);

  it('converts all 5 items across both reason-code groups', () => {
    expect(result.count).toBe(5);
    expect(result.errors).toHaveLength(0);
  });
  it('does NOT parse the TOTALS lines as data', () => {
    // 4x 901 + 1x 908 = 5; a leaked TOTALS row would push this higher.
    expect(result.rows).toHaveLength(5);
  });
  it('extracts the settlement date once for the whole file', () => {
    expect(result.settlementDate).toBe('2026-06-16');
  });
  it('increments the trace identifier per row', () => {
    expect(result.rows.map((r) => r[12])).toEqual([
      '293804-0_649',
      '293804-0_650',
      '293804-0_651',
      '293804-0_652',
      '293804-0_653',
    ]);
  });
  it('maps the 908 group to the FUNDS NOT CLEARED message', () => {
    const last = result.rows[4];
    expect(last[2]).toBe('908');
    expect(last[9]).toBe('FUNDS NOT CLEARED =');
  });
  it('builds the masked account id for the first item', () => {
    expect(result.rows[0][1]).toBe('660384990005040720');
  });
  it('produces a header-less CSV (Requirement 3.4.2)', () => {
    const firstLine = result.csv.split('\r\n')[0];
    expect(firstLine.startsWith('5O8HA38J2K7JM3H7GT')).toBe(true);
  });
  it('names the file per Requirement 3.4.3', () => {
    expect(result.fileName).toBe('BMO_EFT_Ingest_2026-06-16.csv');
  });
});
