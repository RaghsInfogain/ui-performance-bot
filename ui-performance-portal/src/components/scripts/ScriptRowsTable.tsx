import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, MinusCircle, Trash2, XCircle } from 'lucide-react';
import { SCRIPTED_ACTIONS, SCRIPTED_COLUMNS, STATIC_COLUMNS } from '../../types';
import { isServerTimingStep } from '../../utils/scriptedSteps';

export type StaticRow = {
  transactionName: string;
  pageUrl: string;
  elementIdentifier: string;
  elementSelector: string;
};

export type ScriptedRow = {
  testCaseName: string;
  transactionName: string;
  testStep: string;
  objectName: string;
  request: string;
  selector: string;
  locator: string;
  action: string;
  parameter: string;
  elementToWait: string;
  elementIdentifier: string;
  frameSelector: string;
};

export const emptyStaticRow = (): StaticRow => ({
  transactionName: '',
  pageUrl: '',
  elementIdentifier: 'XPath',
  elementSelector: '//body',
});

const LOCATOR_CHOICES = ['Xpath', 'CSS', 'NA'];
const IDENTIFIER_CHOICES = ['XPath', 'CSS'];

/** Column widths so long selectors stay readable in the wide scripted table. */
const SCRIPTED_WIDTH: Record<string, string> = {
  testCaseName: 'min-w-[140px]',
  transactionName: 'min-w-[170px]',
  testStep: 'min-w-[200px]',
  objectName: 'min-w-[130px]',
  request: 'min-w-[170px]',
  selector: 'min-w-[240px]',
  locator: 'min-w-[90px]',
  action: 'min-w-[150px]',
  parameter: 'min-w-[200px]',
  elementToWait: 'min-w-[90px]',
  elementIdentifier: 'min-w-[240px]',
  frameSelector: 'min-w-[140px]',
};

const cellInput = 'w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400';

export const emptyScriptedRow = (): ScriptedRow => ({
  testCaseName: 'My_Flow',
  transactionName: '',
  testStep: '',
  objectName: '',
  request: '',
  selector: '',
  locator: 'Xpath',
  action: 'Navigate',
  parameter: '',
  elementToWait: 'Xpath',
  elementIdentifier: '//body',
  frameSelector: '',
});


/** Editable table of static / navigation rows; column titles match the CSV headers. */
export function StaticRowsTable({ rows, onChange }: { rows: StaticRow[]; onChange: (rows: StaticRow[]) => void }) {
  return (
  <div className="max-h-[640px] overflow-auto">
    <table className="w-full min-w-[760px] text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
        <tr>
          <th className="w-10 px-2 py-2 text-right font-semibold">#</th>
          {STATIC_COLUMNS.map((c) => (
            <th key={c.key} className="px-2 py-2 font-semibold">{c.header}</th>
          ))}
          <th className="w-10 px-2 py-2" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const update = (patch: Partial<StaticRow>) => {
            const next = [...rows];
            next[i] = { ...next[i], ...patch };
            onChange(next);
          };
          return (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="px-2 py-1.5 text-right text-slate-400">{i + 1}</td>
              <td className="w-[20%] px-2 py-1.5">
                <input className={cellInput} aria-label="Transaction Name" value={row.transactionName} onChange={(e) => update({ transactionName: e.target.value })} />
              </td>
              <td className="w-[36%] px-2 py-1.5">
                <input className={`${cellInput} font-mono`} aria-label="Path Page URL" value={row.pageUrl} onChange={(e) => update({ pageUrl: e.target.value })} />
              </td>
              <td className="w-[12%] px-2 py-1.5">
                <select className={cellInput} aria-label="Element Identifier" value={row.elementIdentifier} onChange={(e) => update({ elementIdentifier: e.target.value })}>
                  {(IDENTIFIER_CHOICES.includes(row.elementIdentifier) ? IDENTIFIER_CHOICES : [row.elementIdentifier, ...IDENTIFIER_CHOICES]).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td className="w-[28%] px-2 py-1.5">
                <input className={`${cellInput} font-mono`} aria-label="Element Selector" value={row.elementSelector} onChange={(e) => update({ elementSelector: e.target.value })} />
              </td>
              <td className="px-2 py-1.5 text-center">
                <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-red-500" title="Remove row">
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
}

export type RowRunStatus = {
  status: 'PASS' | 'FAIL' | 'SKIP' | 'RUNNING' | 'PENDING';
  error?: string;
  durationMs?: number;
};

function StatusCell({ result }: { result?: RowRunStatus }) {
  if (!result || result.status === 'PENDING') return <span className="text-slate-300">—</span>;
  const tip = [result.error, result.durationMs != null ? `${result.durationMs} ms` : ''].filter(Boolean).join(' · ') || undefined;
  if (result.status === 'RUNNING') {
    return <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> RUN</span>;
  }
  if (result.status === 'PASS') {
    return <span className="inline-flex items-center gap-1 font-semibold text-emerald-700" title={tip}><CheckCircle2 className="h-3.5 w-3.5" /> PASS</span>;
  }
  if (result.status === 'FAIL') {
    return <span className="inline-flex items-center gap-1 font-semibold text-red-700" title={tip}><XCircle className="h-3.5 w-3.5" /> FAIL</span>;
  }
  return <span className="inline-flex items-center gap-1 font-semibold text-slate-500" title={tip}><MinusCircle className="h-3.5 w-3.5" /> SKIP</span>;
}

/** Editable table of scripted steps; column titles match the CSV headers, in file order. */
export function ScriptedRowsTable({
  rows,
  onChange,
  onRowPatch,
  rowStatus,
  renderRowActions,
  maxHeight = 'max-h-[640px]',
}: {
  rows: ScriptedRow[];
  onChange: (rows: ScriptedRow[]) => void;
  /** Optional per-field hook (e.g. to keep related fields in sync); defaults to a plain patch. */
  onRowPatch?: (index: number, patch: Partial<ScriptedRow>) => void;
  /** When provided, a Status column shows each row's replay result. */
  rowStatus?: (index: number) => RowRunStatus | undefined;
  /** Replaces the default delete button in the last column. */
  renderRowActions?: (index: number) => ReactNode;
  maxHeight?: string;
}) {
  const showStatus = Boolean(rowStatus);
  return (
  <div className={`${maxHeight} overflow-auto`}>
    <table className="text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
        <tr>
          <th className="sticky left-0 z-20 w-10 bg-slate-50 px-2 py-2 text-right font-semibold">#</th>
          {showStatus && <th className="min-w-[80px] whitespace-nowrap px-2 py-2 font-semibold">Status</th>}
          {SCRIPTED_COLUMNS.map((c) => (
            <th key={c.key} className={`whitespace-nowrap px-2 py-2 font-semibold ${SCRIPTED_WIDTH[c.key]}`}>{c.header}</th>
          ))}
          <th className="w-10 px-2 py-2" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const serverStep = isServerTimingStep(row);
          const result = rowStatus?.(i);
          const update = (patch: Partial<ScriptedRow>) => {
            if (onRowPatch) {
              onRowPatch(i, patch);
              return;
            }
            const next = [...rows];
            const updated = { ...next[i], ...patch };
            if (!isServerTimingStep(updated)) updated.transactionName = '';
            next[i] = updated;
            onChange(next);
          };
          return (
            <tr
              key={i}
              className={`border-t border-slate-100 align-top ${
                result?.status === 'FAIL' ? 'bg-red-50/60' : result?.status === 'RUNNING' ? 'bg-amber-50/60' : ''
              }`}
            >
              <td className="sticky left-0 bg-white px-2 py-1.5 text-right text-slate-400">{i + 1}</td>
              {showStatus && (
                <td className="whitespace-nowrap px-2 py-1.5 text-[11px]">
                  <StatusCell result={result} />
                  {result?.status === 'FAIL' && result.error && (
                    <div className="mt-0.5 max-w-[160px] truncate text-[10px] text-red-600" title={result.error}>{result.error}</div>
                  )}
                </td>
              )}
              {SCRIPTED_COLUMNS.map((c) => {
                const value = row[c.key];
                const label = c.header;
                if (c.key === 'action') {
                  const options = (SCRIPTED_ACTIONS as readonly string[]).includes(value) ? SCRIPTED_ACTIONS : [value, ...SCRIPTED_ACTIONS];
                  return (
                    <td key={c.key} className="px-2 py-1.5">
                      <select className={cellInput} aria-label={label} value={value} onChange={(e) => update({ action: e.target.value })}>
                        {options.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                  );
                }
                if (c.key === 'locator' || c.key === 'elementToWait') {
                  const options = LOCATOR_CHOICES.includes(value) ? LOCATOR_CHOICES : [value || 'Xpath', ...LOCATOR_CHOICES];
                  return (
                    <td key={c.key} className="px-2 py-1.5">
                      <select className={cellInput} aria-label={label} value={value} onChange={(e) => update({ [c.key]: e.target.value })}>
                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                  );
                }
                const isTxn = c.key === 'transactionName';
                const mono = ['request', 'selector', 'parameter', 'elementIdentifier', 'frameSelector'].includes(c.key);
                return (
                  <td key={c.key} className="px-2 py-1.5">
                    <input
                      className={`${cellInput} ${mono ? 'font-mono' : ''}`}
                      aria-label={label}
                      title={isTxn && !serverStep ? 'Client-side step — no transaction' : value}
                      placeholder={isTxn && !serverStep ? '— client step' : ''}
                      disabled={isTxn && !serverStep}
                      value={isTxn && !serverStep ? '' : value}
                      onChange={(e) => update({ [c.key]: e.target.value })}
                    />
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center">
                {renderRowActions ? renderRowActions(i) : (
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-red-500" title="Remove step">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
}
