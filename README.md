# AuraConvert — BMO EFT → CRM CSV Converter

Project AuraConvert is a **fully client-side** web utility that turns a raw BMO
EFT (Electronic Fund Transfer) decline report (`.txt` / `.out`) into the
16-column, header-less `.csv` file consumed by the internal CRM. Banking files
**never leave the browser** — all parsing happens locally in JavaScript.

## Quick start

```bash
npm install
npm run dev        # local dev server
npm test           # run the parser unit tests
npm run build      # production build into dist/
npm run preview    # preview the production build
```

Then open the app, drag a BMO return file onto the dropzone (or click to
browse), and the converted `BMO_EFT_Ingest_[YYYY-MM-DD].csv` downloads
automatically.

## How it works

1. **Ingestion** — accepts `.txt`/`.out` via click-to-upload or drag-and-drop.
2. **Parsing** — skips metadata/header lines and targets transaction rows
   (record type `D`). The settlement date is read once from the report header.
3. **Transformation** — each row is mapped to the 16 output positions defined
   in the PRD (Section 3.2), including the dynamic status-message mapping for
   reason codes (Section 3.3).
4. **Output** — a header-less CSV is generated and downloaded; unparseable rows
   are surfaced in an inline error panel.

### Status-message mapping (Position 9)

| Reason code | Output message                     |
| ----------- | ---------------------------------- |
| `901`       | `NSF DEBIT * DO NOT RETRY =`        |
| `908`       | `FUNDS NOT CLEARED * DO NOT RETRY =`|
| any other   | `DECLINE RECORD * DO NOT RETRY =`   |

## Calibration note

All hardcoded business constants (account prefix `6603849900`, processing time
`17:07:23`, trace template `293804-0_{n}`, action sub-code, etc.) live in a
single `DEFAULTS` object in [`src/lib/parser.ts`](src/lib/parser.ts) so they can
be adjusted in one place.

Row field extraction is **value-shape based** (whitespace-delimited tokens
classified by pattern) rather than hard-coded character offsets, so minor layout
drift in the bank report won't silently corrupt output. The exact column layout
was inferred from the PRD examples; once a real (sanitized) BMO return file is
available, validate `extractRowFields` against it and adjust if needed. A
synthetic sample lives at [`public/sample_BMO_EFT.txt`](public/sample_BMO_EFT.txt).

## Tech stack

React + TypeScript + Vite + Tailwind CSS v4 (PRD Option A — pure client-side).
