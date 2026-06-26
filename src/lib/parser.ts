// Project AuraConvert — core transformation engine.
//
// Parses a raw BMO EFT decline report (.txt / .out) and emits the 16-column,
// header-less CSV expected by the downstream CRM ingestion file.
//
// Every hardcoded/business constant lives in DEFAULTS so the mapping can be
// recalibrated in ONE place once a real BMO return file is on hand. The row
// extraction itself is intentionally tolerant (whitespace-delimited, anchored
// on the values it can recognise) rather than hard-coded character offsets,
// so small layout drift in the bank report does not silently corrupt output.

export const COLUMN_COUNT = 16;

export interface ConvertConfig {
  /** Static prefix prepended to the masked account id (Position 1). */
  accountPrefix: string;
  /** Account number is zero-padded to this many digits before prefixing. */
  accountPadLength: number;
  /** Cross reference (Position 0) is left-aligned, space-padded to this width. */
  crossRefWidth: number;
  actionSubCode: string; // Position 3
  authCode: string; // Position 4
  processingTime: string; // Position 5
  statusCode: string; // Position 7
  activeBoolean: string; // Position 8
  transactionType: string; // Position 11
  retryFlag: string; // Position 13
  nullTerminator: string; // Position 15
  /** Trace id template (Position 12); "{n}" is replaced by the running counter. */
  traceTemplate: string;
  /** Starting value for the trace counter. */
  traceStart: number;
}

export const DEFAULTS: ConvertConfig = {
  accountPrefix: '6603849900',
  accountPadLength: 8,
  crossRefWidth: 50,
  actionSubCode: '04',
  authCode: '000000',
  processingTime: '17:07:23',
  statusCode: '00',
  activeBoolean: 'true',
  transactionType: 'V',
  retryFlag: 'false',
  nullTerminator: 'null',
  traceTemplate: '293804-0_{n}',
  traceStart: 649,
};

export interface RowError {
  /** 1-based line number in the source file. */
  line: number;
  content: string;
  reason: string;
}

export interface ConvertResult {
  /** Parsed rows, each an array of exactly COLUMN_COUNT string fields. */
  rows: string[][];
  /** The fully rendered CSV text (no header row). */
  csv: string;
  /** Rows that looked like data but could not be parsed. */
  errors: RowError[];
  /** Settlement date in ISO format (YYYY-MM-DD), or "" if not found. */
  settlementDate: string;
  /** Suggested download filename per Requirement 3.4.3. */
  fileName: string;
  /** Number of successfully converted records. */
  count: number;
}

// ---------------------------------------------------------------------------
// Status message mapping (Position 9) — Section 3.3 of the PRD.
// ---------------------------------------------------------------------------
export function statusMessage(reasonCode: string): string {
  switch (reasonCode) {
    case '901':
      return 'NSF DEBIT * DO NOT RETRY =';
    case '908':
      return 'FUNDS NOT CLEARED * DO NOT RETRY =';
    default:
      return 'DECLINE RECORD * DO NOT RETRY =';
  }
}

// ---------------------------------------------------------------------------
// Settlement date extraction (Position 6) — from the report header.
// ---------------------------------------------------------------------------
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Normalise a free-form date token to ISO (YYYY-MM-DD); returns "" if unrecognised. */
export function toIsoDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';

  // Already ISO: 2026-06-16
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // ISO-ish with slashes: 2026/06/16
  m = s.match(/\b(\d{4})\/(\d{2})\/(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // "JUN 16, 2026" / "JUN 16 2026" / "JUN 16,2026" (BMO header style, no space after comma)
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?[,\s]+(\d{1,2})[,\s]+(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }

  // "16 JUN 2026" or "16-JUN-2026" or "16JUN2026"
  m = s.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s]?(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }

  // Numeric DD/MM/YYYY (Canadian) — assume day-first.
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return '';
}

export function extractSettlementDate(text: string): string {
  const m = text.match(/SETTLEMENT\s*DATE\s*[:.\-]?\s*(.+)/i);
  if (!m) return '';
  // Only consider the remainder of that one line.
  const firstLine = m[1].split(/\r?\n/)[0];
  return toIsoDate(firstLine);
}

// ---------------------------------------------------------------------------
// Data-row detection & field extraction.
// ---------------------------------------------------------------------------

// A real BMO returned-debit item line looks like:
//
//    D   901  JUN 15  0003-00126  5040720   MRS FERNANDO SORRENTI  5O8HA38J2K7JM3H7GT   $79.04
//        ^reason  ^value date     ^dest inst ^account              ^cross reference     ^amount
//
// The "D" record-type token only appears on the FIRST item of each reason-code
// group; continuation items leave it blank. So a row is detected by its
// structure — optional D, a 3-digit reason code, a 3-letter month + day value
// date, and a dest-institution code — rather than by the leading "D". This also
// excludes the TOTALS / metadata lines, which lack the month + dest-inst shape.
const DATA_ROW_RE = /^\s*D?\s*\d{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}-\d{4,7}\b/;

/** A line is a transaction record if it matches the returned-debit item structure. */
export function isDataRow(line: string): boolean {
  return DATA_ROW_RE.test(line);
}

interface ExtractedFields {
  crossRef: string;
  account: string;
  reason: string;
  amount: string;
}

const MONEY_RE = /^\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})$|^\$?\d+\.\d{2}$/;
const DEST_INST_RE = /^\d{4}-\d{4,7}$/;

/**
 * Pull the four source values out of a single returned-debit item row.
 *
 * Extraction is positional relative to the columns we can anchor on, which is
 * far more reliable than "longest token" guessing:
 *   - reason  = first standalone 3-digit integer (e.g. 901 / 908)
 *   - account = the token immediately AFTER the dest-institution code
 *               (NNNN-NNNNN), which sits just before the payee name
 *   - amount  = the LAST money-shaped token on the line
 *   - crossRef= the token immediately BEFORE the amount
 *
 * Returns an error (instead of fields) when a required field cannot be located.
 */
export function extractRowFields(line: string): { fields?: ExtractedFields; error?: string } {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] === 'D') tokens.shift();
  if (tokens.length === 0) return { error: 'empty record' };

  const reason = tokens.find((t) => /^\d{3}$/.test(t)) ?? '';

  // Amount is the last money-shaped token; cross reference is the token before it.
  let amountIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (MONEY_RE.test(tokens[i])) {
      amountIdx = i;
      break;
    }
  }
  const amount = amountIdx >= 0 ? tokens[amountIdx].replace(/[$,\s]/g, '') : '';
  const crossRef = amountIdx > 0 ? tokens[amountIdx - 1] : '';

  // Account number sits immediately after the dest-institution code.
  const destIdx = tokens.findIndex((t) => DEST_INST_RE.test(t));
  const account = destIdx >= 0 ? (tokens[destIdx + 1] ?? '') : '';

  const missing: string[] = [];
  if (!crossRef) missing.push('cross reference');
  if (!account) missing.push('account no.');
  if (!reason) missing.push('reason code');
  if (!amount) missing.push('amount');
  if (missing.length) return { error: `could not extract: ${missing.join(', ')}` };

  return { fields: { crossRef, account, reason, amount } };
}

// ---------------------------------------------------------------------------
// Row assembly (the 16-column mapping — Section 3.2).
// ---------------------------------------------------------------------------
export function buildRow(
  fields: ExtractedFields,
  settlementDate: string,
  traceIndex: number,
  cfg: ConvertConfig,
): string[] {
  const row = new Array<string>(COLUMN_COUNT);
  row[0] = fields.crossRef.padEnd(cfg.crossRefWidth, ' ').slice(0, cfg.crossRefWidth);
  row[1] = cfg.accountPrefix + fields.account.padStart(cfg.accountPadLength, '0');
  row[2] = fields.reason;
  row[3] = cfg.actionSubCode;
  row[4] = cfg.authCode;
  row[5] = cfg.processingTime;
  row[6] = settlementDate;
  row[7] = cfg.statusCode;
  row[8] = cfg.activeBoolean;
  row[9] = statusMessage(fields.reason);
  row[10] = fields.amount;
  row[11] = cfg.transactionType;
  row[12] = cfg.traceTemplate.replace('{n}', String(cfg.traceStart + traceIndex));
  row[13] = cfg.retryFlag;
  row[14] = ''; // Position 14: intentionally blank.
  row[15] = cfg.nullTerminator;
  return row;
}

// ---------------------------------------------------------------------------
// CSV rendering — minimal RFC-4180 quoting so the 50-char padding survives
// (a field is only quoted when it contains a comma, quote, or newline).
// ---------------------------------------------------------------------------
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeField).join(',')).join('\r\n');
}

export function buildFileName(settlementDate: string): string {
  const date = settlementDate || isoToday();
  return `BMO_EFT_Ingest_${date}.csv`;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Top-level entry point.
// ---------------------------------------------------------------------------
export function convert(text: string, cfg: ConvertConfig = DEFAULTS): ConvertResult {
  const settlementDate = extractSettlementDate(text);
  const lines = text.split(/\r?\n/);

  const rows: string[][] = [];
  const errors: RowError[] = [];

  lines.forEach((line, idx) => {
    if (!isDataRow(line)) return;
    const { fields, error } = extractRowFields(line);
    if (!fields) {
      errors.push({ line: idx + 1, content: line.trim(), reason: error ?? 'unknown error' });
      return;
    }
    rows.push(buildRow(fields, settlementDate, rows.length, cfg));
  });

  return {
    rows,
    csv: rowsToCsv(rows),
    errors,
    settlementDate,
    fileName: buildFileName(settlementDate),
    count: rows.length,
  };
}
