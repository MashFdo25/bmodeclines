import { useCallback, useRef, useState } from 'react';
import { convert, type ConvertResult } from './lib/parser';

const TEAL = '#008080';

export default function App() {
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [appError, setAppError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setAppError('');
    const name = file.name.toLowerCase();
    if (!name.endsWith('.txt') && !name.endsWith('.out')) {
      setAppError('Unsupported file type. Please upload a .txt or .out file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const res = convert(text);
        setResult(res);
        setSourceName(file.name);
      } catch {
        setAppError('Failed to parse the file. Please verify it is a BMO EFT return report.');
      }
    };
    reader.onerror = () => setAppError('Could not read the file.');
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="min-h-full flex flex-col items-center px-4 py-10">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Aura<span style={{ color: TEAL }}>Convert</span>
        </h1>
        <p className="text-sm text-white/50 mt-2">
          BMO EFT decline report → CRM-ready CSV. Processed entirely in your browser.
        </p>
      </header>

      <main className="w-full max-w-2xl">
        {/* Glassmorphism panel */}
        <div
          className="rounded-2xl p-1"
          style={{
            background:
              'linear-gradient(145deg, rgba(0,128,128,0.35), rgba(255,255,255,0.06))',
          }}
        >
          <div className="rounded-2xl bg-[#161616]/90 backdrop-blur p-8">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload BMO EFT text file"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className="cursor-pointer rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center px-6 py-14 transition-colors outline-none"
              style={{
                borderColor: dragging ? TEAL : 'rgba(255,255,255,0.15)',
                backgroundColor: dragging ? 'rgba(0,128,128,0.08)' : 'transparent',
                boxShadow: dragging ? `0 0 32px ${TEAL}55 inset` : 'none',
              }}
            >
              <UploadIcon glow={dragging} />
              <p className="mt-4 text-base font-medium">
                {dragging ? 'Release to parse data' : 'Drop BMO EFT text file here to parse data.'}
              </p>
              <p className="text-xs text-white/40 mt-1">or click to browse — .txt / .out</p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".txt,.out,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {appError && (
          <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {appError}
          </div>
        )}

        {result && (
          <Results result={result} sourceName={sourceName} />
        )}
      </main>

      <footer className="mt-auto pt-10 text-xs text-white/30">
        Files never leave your device — all parsing happens client-side.
      </footer>
    </div>
  );
}

function Results({ result, sourceName }: { result: ConvertResult; sourceName: string }) {
  const download = () => triggerDownload(result.csv, result.fileName);
  return (
    <div className="mt-6 space-y-4">
      {result.count > 0 && (
        <div
          className="rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-4"
          style={{ backgroundColor: 'rgba(0,128,128,0.12)', border: `1px solid ${TEAL}66` }}
        >
          <span>
            <strong style={{ color: TEAL }}>{result.count}</strong> item
            {result.count === 1 ? '' : 's'} successfully converted!
            <span className="text-white/40"> ({sourceName} → {result.fileName})</span>
          </span>
          <button
            onClick={download}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-black"
            style={{ backgroundColor: TEAL }}
          >
            Download CSV
          </button>
        </div>
      )}

      {result.count === 0 && result.errors.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          No transaction (record type "D") rows were found in this file.
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-200 mb-2">
            {result.errors.length} row{result.errors.length === 1 ? '' : 's'} could not be parsed
          </p>
          <ul className="space-y-1 max-h-40 overflow-auto text-xs font-mono text-amber-100/70">
            {result.errors.map((err) => (
              <li key={err.line}>
                <span className="text-amber-400">line {err.line}</span> — {err.reason}: {err.content}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.count > 0 && (
        <details className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <summary className="cursor-pointer text-sm text-white/60">Preview output CSV</summary>
          <pre className="mt-3 max-h-64 overflow-auto text-xs font-mono text-white/70 whitespace-pre">
            {result.csv}
          </pre>
        </details>
      )}
    </div>
  );
}

function UploadIcon({ glow }: { glow: boolean }) {
  return (
    <svg
      className={glow ? 'aura-float' : ''}
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke={glow ? TEAL : 'rgba(255,255,255,0.6)'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter: glow ? `drop-shadow(0 0 10px ${TEAL})` : 'none', transition: 'stroke 0.2s' }}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function triggerDownload(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
