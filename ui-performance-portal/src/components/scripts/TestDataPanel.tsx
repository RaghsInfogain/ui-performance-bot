import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Database, Download, FileUp, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import type { ScriptTestData, TestDataMode } from '../../types';
import type { ScriptedRow } from './ScriptRowsTable';

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
const PREVIEW_ROWS = 20;

const MODE_OPTIONS: { value: TestDataMode; label: string; hint: string }[] = [
  { value: 'sequential', label: 'Sequential', hint: 'Rows in order, shared across threads; wraps around at the end' },
  { value: 'random', label: 'Random', hint: 'Any row for each iteration' },
  { value: 'unique', label: 'Unique', hint: 'Each row used once; the test stops when rows run out' },
];

/** ${column} names referenced anywhere in the steps. */
function placeholdersIn(rows: ScriptedRow[]): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      for (const m of String(value ?? '').matchAll(PLACEHOLDER)) found.add(m[1]);
    }
  }
  return [...found];
}

function csvField(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(fileName: string, headers: string[], rows: string[][]) {
  const text = [headers, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Attach a CSV of test data to a scripted script. Steps reference columns as ${column};
 * the engine substitutes one data row per flow iteration.
 */
export function TestDataPanel({ scriptId, steps }: { scriptId: string; steps: ScriptedRow[] }) {
  const [data, setData] = useState<ScriptTestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.getScriptData(scriptId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load test data'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scriptId]);

  const used = useMemo(() => placeholdersIn(steps), [steps]);
  const headers = data?.headers ?? [];
  const missing = used.filter((p) => !headers.includes(p));
  const unused = headers.filter((h) => !used.includes(h));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setData(await api.uploadScriptData(scriptId, await file.text(), file.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const changeMode = async (mode: TestDataMode) => {
    setBusy(true);
    setError('');
    try {
      setData(await api.setScriptDataMode(scriptId, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change mode');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!data || !confirm(`Remove test data "${data.fileName}" from this script?`)) return;
    setBusy(true);
    try {
      await api.deleteScriptData(scriptId);
      setData(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove test data');
    } finally {
      setBusy(false);
    }
  };

  const copyPlaceholder = async (col: string) => {
    try {
      await navigator.clipboard.writeText(`\${${col}}`);
      setCopied(col);
      setTimeout(() => setCopied(''), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const templateColumns = used.length ? used : ['username', 'password'];

  return (
    <div className="card mb-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-4 sm:px-6">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Database className="h-4 w-4" /> Test Data (CSV)</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Use <code className="rounded bg-slate-100 px-1">{'${column}'}</code> in any step field (e.g. Parameter <code className="rounded bg-slate-100 px-1">{'${username}'}</code>).
            Each run iteration takes one row from the CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-primary text-xs">
            <FileUp className="h-3.5 w-3.5" /> {data ? 'Replace CSV' : 'Upload CSV'}
          </button>
          {data ? (
            <>
              <button type="button" onClick={() => downloadCsv(data.fileName || 'test-data.csv', data.headers, data.rows)} className="btn-secondary text-xs">
                <Download className="h-3.5 w-3.5" /> Download
              </button>
              <button type="button" disabled={busy} onClick={remove} className="btn-secondary text-xs text-red-600">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => downloadCsv('test-data-template.csv', templateColumns, [templateColumns.map(() => '')])}
              className="btn-secondary text-xs"
              title="CSV with a column for each placeholder used in the steps"
            >
              <Download className="h-3.5 w-3.5" /> Template
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-6">
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        {loading ? (
          <p className="text-sm text-slate-400">Loading test data…</p>
        ) : !data ? (
          <p className="text-sm text-slate-500">
            No test data attached — the script runs with the values typed in its steps.
            {used.length > 0 && (
              <span className="mt-2 flex items-start gap-1.5 text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Steps use {used.map((p) => `\${${p}}`).join(', ')} but no CSV is attached, so those placeholders would be sent as literal text.
              </span>
            )}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="text-sm">
                <div className="font-medium text-slate-800">{data.fileName || 'test-data.csv'}</div>
                <div className="text-xs text-slate-500">{data.rowCount} row{data.rowCount === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}</div>
              </div>
              <div>
                <label className="label" htmlFor="data-mode">Row selection</label>
                <select
                  id="data-mode"
                  className="input-field py-1.5 text-sm"
                  value={data.mode}
                  disabled={busy}
                  onChange={(e) => changeMode(e.target.value as TestDataMode)}
                >
                  {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <p className="max-w-md text-xs text-slate-500">
                {MODE_OPTIONS.find((m) => m.value === data.mode)?.hint}. With no Test Duration, the flow runs once per row
                ({data.rowCount} iteration{data.rowCount === 1 ? '' : 's'}).
              </p>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Columns — click to copy the placeholder</div>
              <div className="flex flex-wrap gap-1.5">
                {headers.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => copyPlaceholder(h)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs ring-1 ${
                      used.includes(h) ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
                    }`}
                    title={used.includes(h) ? 'Used in the steps' : 'Not used in any step yet'}
                  >
                    {copied === h ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {`\${${h}}`}
                  </button>
                ))}
              </div>
            </div>

            {missing.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Steps use {missing.map((p) => `\${${p}}`).join(', ')}, which {missing.length === 1 ? 'is' : 'are'} not a column in the CSV — {missing.length === 1 ? 'it' : 'they'} will be sent as literal text.
              </div>
            )}
            {unused.length > 0 && used.length > 0 && (
              <p className="text-xs text-slate-500">Not used by any step: {unused.join(', ')}</p>
            )}

            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="w-10 px-2 py-1.5 text-right font-semibold">#</th>
                    {headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-right text-slate-400">{i + 1}</td>
                      {headers.map((h, j) => (
                        <td key={h} className="max-w-[220px] truncate px-2 py-1 font-mono" title={r[j]}>{r[j]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.rowCount > PREVIEW_ROWS && (
                <p className="border-t px-2 py-1.5 text-xs text-slate-400">Showing first {PREVIEW_ROWS} of {data.rowCount} rows</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
