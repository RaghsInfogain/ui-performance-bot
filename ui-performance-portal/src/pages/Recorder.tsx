import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Circle, Square, Video, Trash2, Save, FileText, Clapperboard, RefreshCw, Pencil, Eye, Play,
  Plus, ArrowUp, ArrowDown, RotateCcw,
} from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api, type CapturedRequest, type RecordingMeta, type ReplayResult } from '../services/api';
import { SCRIPTED_COLUMNS } from '../types';
import type { TestScript } from '../types';
import { isServerTimingStep, sanitizeScriptedRows } from '../utils/scriptedSteps';
import {
  ScriptedRowsTable, StaticRowsTable, type RowRunStatus, type ScriptedRow, type StaticRow,
} from '../components/scripts/ScriptRowsTable';

type ScriptKind = 'scripted' | 'static';

/** Request column value for a captured call — mirrors server/scriptFormat.js formatRequest. */
function formatRequest({ method, url, type }: CapturedRequest): string {
  const m = String(method || 'GET').toLowerCase();
  const verb = m.charAt(0).toUpperCase() + m.slice(1);
  try {
    const u = new URL(url);
    return `${verb}:${u.pathname}${type === 'document' ? u.search : ''}`;
  } catch {
    return `${verb}:${url}`;
  }
}

/** The call that best represents an action: a page load, else a write, else the first call. */
function primaryRequest(requests: CapturedRequest[]): CapturedRequest | null {
  return requests.find((r) => r.type === 'document')
    || requests.find((r) => r.method.toUpperCase() !== 'GET')
    || requests[0]
    || null;
}

/** Scripts generated from a recording use stable ids so saving again updates them in place. */
const linkedScriptId = (recordingId: string, kind: ScriptKind) => `rec_${recordingId}_${kind}`;

/** Keep only the CSV columns when saving a scripted script. */
function toScriptedCsvRow(row: EditableStep): ScriptedRow {
  const out = {} as ScriptedRow;
  for (const c of SCRIPTED_COLUMNS) out[c.key] = String(row[c.key] ?? '');
  return out;
}

function toStaticRow(raw: Record<string, unknown>): StaticRow {
  const str = (a: string, b: string) => String(raw[a] ?? raw[b] ?? '');
  return {
    transactionName: str('transactionName', 'Transaction Name'),
    pageUrl: str('pageUrl', 'Path Page URL'),
    elementIdentifier: str('elementIdentifier', 'Element Identifier') || 'XPath',
    elementSelector: str('elementSelector', 'Element Selector') || '//body',
  };
}

type LiveStep = {
  index: number;
  action: string;
  testStep?: string;
  selector?: string;
  locatorStrategy?: string;
  locatorLabel?: string;
  locatorCandidates?: Array<{ strategy: string; selector: string; label?: string; unique?: boolean; score?: number }>;
  parameter?: string;
  pageUrl?: string;
  objectName?: string;
};

type EditableStep = {
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
  locatorLabel?: string;
  locatorCandidates?: LiveStep['locatorCandidates'];
  [key: string]: unknown;
};

function emptyEditableStep(testCaseName = 'Recorded_Flow'): EditableStep {
  return {
    testCaseName,
    transactionName: '',
    testStep: '',
    objectName: '',
    request: '',
    selector: '',
    locator: 'Xpath',
    action: 'Click',
    parameter: '',
    elementToWait: 'Xpath',
    elementIdentifier: '',
    frameSelector: '',
  };
}

function normalizeEditableStep(raw: Record<string, unknown>, fallbackName = 'Recorded_Flow'): EditableStep {
  const str = (key: string, alt?: string) => String(raw[key] ?? (alt ? raw[alt] : '') ?? '');
  return {
    ...raw,
    testCaseName: str('testCaseName', 'Test_Case_Name') || fallbackName,
    transactionName: str('transactionName', 'Transaction_Name'),
    testStep: str('testStep', 'Test_Steps'),
    objectName: str('objectName', 'Object_Name'),
    request: str('request', 'Request'),
    selector: str('selector', 'Selector'),
    locator: str('locator', 'Locator') || 'Xpath',
    action: str('action', 'Action') || 'Click',
    parameter: str('parameter', 'Parameter'),
    elementToWait: str('elementToWait', 'Element to Wait') || str('locator', 'Locator') || 'Xpath',
    elementIdentifier: str('elementIdentifier', 'Element identifier') || str('selector', 'Selector'),
    frameSelector: str('frameSelector', 'Frame_Selector'),
    locatorLabel: str('locatorLabel') || undefined,
    locatorCandidates: Array.isArray(raw.locatorCandidates)
      ? (raw.locatorCandidates as LiveStep['locatorCandidates'])
      : undefined,
  };
}

type EditorState = {
  recordingId: string | null;
  name: string;
  startUrl: string;
  scripted: EditableStep[];
  staticRows: StaticRow[];
  /** Static rows derived from the recorded steps (for "Regenerate from steps"). */
  derivedStatic: StaticRow[];
  dirty: boolean;
};

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function Recorder() {
  const [url, setUrl] = useState('https://opensource-demo.orangehrmlive.com/');
  const [scriptName, setScriptName] = useState('Recorded_Flow');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [tab, setTab] = useState<ScriptKind>('scripted');
  const [linked, setLinked] = useState<Record<ScriptKind, TestScript | null>>({ scripted: null, static: null });
  const [notice, setNotice] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      setRecordings(await api.listRecordings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recordings');
    }
  }, []);

  useEffect(() => {
    loadRecordings();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRecordings]);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const openEditor = (
    recordingId: string | null,
    name: string,
    startUrl: string,
    scripted: Array<Record<string, unknown>>,
    staticRows: Array<Record<string, unknown>>,
    dirty = false,
  ) => {
    setReplayResult(null);
    setNotice('');
    const normalized = (scripted ?? []).map((row) => normalizeEditableStep(row, name || 'Recorded_Flow'));
    const derived = (staticRows ?? []).map(toStaticRow);
    setEditor({ recordingId, name, startUrl, scripted: normalized, staticRows: derived, derivedStatic: derived, dirty });
    setScriptName(name);
    setLinked({ scripted: null, static: null });
    if (recordingId) loadLinkedScripts(recordingId);
  };

  /** Look up the static / scripted scripts previously saved from this recording. */
  const loadLinkedScripts = async (recordingId: string) => {
    const fetchOne = (kind: ScriptKind) => api.getScript(linkedScriptId(recordingId, kind)).catch(() => null);
    const [scripted, staticScript] = await Promise.all([fetchOne('scripted'), fetchOne('static')]);
    setLinked({ scripted, static: staticScript });
    // A saved static script holds the user's edits — show those rather than the derived rows
    if (staticScript?.rows?.length) {
      const rows = (staticScript.rows as Array<Record<string, unknown>>).map(toStaticRow);
      // Only replace rows the user hasn't edited in this session
      setEditor((prev) => (
        prev && prev.recordingId === recordingId && prev.staticRows === prev.derivedStatic
          ? { ...prev, staticRows: rows }
          : prev
      ));
    }
  };

  const startRecording = async () => {
    setError('');
    setEditor(null);
    try {
      const res = await api.startRecorder(url.trim());
      setSessionId(res.sessionId);
      setRecording(true);
      setLiveSteps([]);
      clearPoll();
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.getRecorderStatus(res.sessionId);
          setLiveSteps(st.steps ?? []);
        } catch {
          /* session may have ended */
        }
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recorder. Ensure Playwright browsers are installed.');
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;
    clearPoll();
    try {
      const res = await api.stopRecorder(sessionId, scriptName || 'Recorded_Flow');
      setRecording(false);
      setSessionId(null);
      setLiveSteps([]);
      if (!res) {
        setError('Nothing was captured');
        return;
      }
      openEditor(
        res.recordingId ?? res.recording?.id ?? null,
        res.testCaseName || scriptName,
        url,
        res.scripted ?? res.steps ?? [],
        res.static ?? [],
        false,
      );
      await loadRecordings();
      if (!res.recordingId && !res.recording?.id) {
        setError('Recording finished but was not saved to the library. Use “Save recording” below.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop recorder');
      setRecording(false);
      setSessionId(null);
    }
  };

  const cancelRecording = async () => {
    if (!sessionId) return;
    clearPoll();
    try {
      await api.cancelRecorder(sessionId);
    } catch {
      /* ignore */
    }
    setRecording(false);
    setSessionId(null);
    setLiveSteps([]);
  };

  const loadSaved = async (id: string) => {
    setError('');
    try {
      const rec = await api.getRecording(id);
      openEditor(
        rec.id,
        rec.name,
        rec.startUrl,
        rec.scripted ?? rec.steps ?? [],
        rec.static ?? [],
        false,
      );
      setUrl(rec.startUrl || url);
      setScriptName(rec.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open recording');
    }
  };

  const updateStepField = (index: number, patch: Partial<EditableStep>) => {
    if (!editor) return;
    setEditor({
      ...editor,
      dirty: true,
      scripted: editor.scripted.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if ('selector' in patch && patch.selector != null && !('elementIdentifier' in patch)) {
          next.elementIdentifier = String(patch.selector);
        }
        if ('locator' in patch && patch.locator != null && !('elementToWait' in patch)) {
          next.elementToWait = String(patch.locator);
        }
        if (!isServerTimingStep(next)) next.transactionName = '';
        return next;
      }),
    });
  };

  const insertStep = (index: number, position: 'before' | 'after') => {
    if (!editor) return;
    setReplayResult(null);
    const at = position === 'before' ? index : index + 1;
    const template = editor.scripted[index] ?? emptyEditableStep(scriptName || editor.name || 'Recorded_Flow');
    const blank = {
      ...emptyEditableStep(template.testCaseName || scriptName || editor.name || 'Recorded_Flow'),
      action: 'Click',
    };
    const next = [...editor.scripted];
    next.splice(at, 0, blank);
    setEditor({ ...editor, dirty: true, scripted: next });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!editor) return;
    setReplayResult(null);
    const target = index + direction;
    if (target < 0 || target >= editor.scripted.length) return;
    const next = [...editor.scripted];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setEditor({ ...editor, dirty: true, scripted: next });
  };

  const removeStep = (index: number) => {
    if (!editor) return;
    setReplayResult(null);
    setEditor({
      ...editor,
      dirty: true,
      scripted: editor.scripted.filter((_, i) => i !== index),
    });
  };

  const appendStep = () => {
    if (!editor) return;
    setReplayResult(null);
    const name = scriptName || editor.name || 'Recorded_Flow';
    const blank = emptyEditableStep(editor.scripted[0]?.testCaseName || name);
    setEditor({ ...editor, dirty: true, scripted: [...editor.scripted, blank] });
  };

  const persistRecording = async (overrideSteps?: EditableStep[]) => {
    if (!editor) return;
    const name = (scriptName || editor.name).trim();
    if (!name) {
      alert('Enter a recording name');
      return;
    }
    setSaving(true);
    setError('');
    const keepStatic = editor.staticRows;
    try {
      const steps = sanitizeScriptedRows(
        (overrideSteps ?? editor.scripted) as Array<{ action?: string; request?: string; transactionName?: string }>,
      );
      if (editor.recordingId) {
        const updated = await api.updateRecording(editor.recordingId, {
          name,
          startUrl: editor.startUrl || url,
          steps,
        });
        openEditor(
          updated.id,
          updated.name,
          updated.startUrl,
          updated.scripted ?? updated.steps,
          updated.static ?? [],
          false,
        );
      } else {
        const saved = await api.saveRecording({
          name,
          startUrl: editor.startUrl || url,
          steps,
        });
        openEditor(
          saved.id,
          saved.name,
          saved.startUrl,
          saved.scripted ?? saved.steps,
          saved.static ?? [],
          false,
        );
      }
      // Saving the recording must not discard edits made in the Static view
      setEditor((prev) => (prev ? { ...prev, staticRows: keepStatic } : prev));
      await loadRecordings();
      setNotice(`Recording "${name}" saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save recording');
    } finally {
      setSaving(false);
    }
  };

  const deleteSaved = async (id: string, name: string) => {
    if (!confirm(`Delete recording "${name}"?`)) return;
    try {
      await api.deleteRecording(id);
      if (editor?.recordingId === id) setEditor(null);
      await loadRecordings();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  /** Save (or update) the recording itself so generated scripts can link to it. */
  const ensureRecordingSaved = async (name: string): Promise<string> => {
    if (!editor) throw new Error('Nothing to save');
    const steps = sanitizeScriptedRows(
      editor.scripted as Array<{ action?: string; request?: string; transactionName?: string }>,
    );
    const startUrl = editor.startUrl || url;
    if (editor.recordingId) {
      const updated = await api.updateRecording(editor.recordingId, { name, startUrl, steps });
      const derived = (updated.static ?? []).map(toStaticRow);
      setEditor((prev) => (prev ? { ...prev, name, derivedStatic: derived, dirty: false } : prev));
      return editor.recordingId;
    }
    const saved = await api.saveRecording({ name, startUrl, steps });
    const derived = (saved.static ?? []).map(toStaticRow);
    setEditor((prev) => (prev ? { ...prev, recordingId: saved.id, name, derivedStatic: derived, dirty: false } : prev));
    await loadRecordings();
    return saved.id;
  };

  const saveLinkedScript = async (kind: ScriptKind) => {
    if (!editor) return;
    const name = (scriptName || editor.name).trim();
    if (!name) {
      alert('Enter a script name');
      return;
    }
    const rows = kind === 'scripted'
      ? sanitizeScriptedRows(editor.scripted).map(toScriptedCsvRow)
      : editor.staticRows;
    if (!rows.length) {
      alert(kind === 'scripted' ? 'No steps to save' : 'No URLs to save');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const recordingId = await ensureRecordingSaved(name);
      const existed = Boolean(linked[kind]);
      const saved = await api.saveScript({
        id: linkedScriptId(recordingId, kind),
        name,
        type: kind,
        description: `Generated from recording ${recordingId}`,
        rows,
        source: 'studio',
      });
      setLinked((prev) => ({ ...prev, [kind]: saved }));
      setNotice(`${kind === 'scripted' ? 'Scripted' : 'Static'} script "${name}" ${existed ? 'updated' : 'saved'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  const deleteLinkedScript = async (kind: ScriptKind) => {
    const script = linked[kind];
    if (!script) return;
    if (!confirm(`Delete ${kind} script "${script.name}"? The recording itself is kept.`)) return;
    try {
      await api.deleteScript(script.id);
      setLinked((prev) => ({ ...prev, [kind]: null }));
      setNotice(`${kind === 'scripted' ? 'Scripted' : 'Static'} script deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete script');
    }
  };

  const replayCurrent = async () => {
    if (!editor?.scripted?.length) {
      alert('No steps to replay');
      return;
    }
    setReplaying(true);
    setError('');
    setReplayResult(null);
    setTab('scripted');
    try {
      const steps = sanitizeScriptedRows(
        editor.scripted as Array<{ action?: string; request?: string; transactionName?: string }>,
      );
      const startUrl = editor.startUrl || url;
      const name = scriptName || editor.name || 'Replay';
      let started: ReplayResult;
      if (editor.recordingId) {
        started = await api.replayRecording(editor.recordingId, { steps, startUrl, headless: false, name });
      } else {
        started = await api.replaySteps({ steps, startUrl, headless: false, name });
      }
      setReplayResult(started);

      if (started.replayId && started.status === 'running') {
        const replayId = started.replayId;
        await new Promise<void>((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const st = await api.getReplayStatus(replayId);
              setReplayResult(st);
              if (st.status === 'completed' || st.status === 'failed') {
                clearInterval(poll);
                if (st.status === 'failed' || !st.ok) {
                  setError(
                    st.error
                      || `Replay finished with ${st.failed} failed step(s). Fix locators and try again.`,
                  );
                }
                resolve();
              }
            } catch (e) {
              clearInterval(poll);
              reject(e);
            }
          }, 600);
        });
      } else if (!started.ok) {
        setError(`Replay finished with ${started.failed} failed step(s). Fix locators and try again.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  };

  const replayByIndex = useMemo(
    () => new Map((replayResult?.results ?? []).map((r) => [r.index, r])),
    [replayResult],
  );

  const rowStatus = (i: number): RowRunStatus | undefined => {
    if (!replayResult) return undefined;
    const r = replayByIndex.get(i);
    if (r) return { status: r.status, error: r.error, durationMs: r.durationMs };
    if (replayResult.status === 'running') {
      return i === replayResult.results.length ? { status: 'RUNNING' } : { status: 'PENDING' };
    }
    return undefined;
  };

  const activeLinked = linked[tab];

  /** Steps that made server calls during replay but aren't mapped to a transaction yet. */
  const requestSuggestions = useMemo(() => {
    if (!editor || !replayResult || replayResult.status === 'running') return [];
    return editor.scripted.flatMap((row, i) => {
      if (row.action === 'Navigate' || String(row.request || '').trim()) return [];
      const reqs = replayByIndex.get(i)?.requests ?? [];
      const primary = primaryRequest(reqs);
      return primary ? [{ index: i, request: formatRequest(primary), calls: reqs }] : [];
    });
  }, [editor, replayResult, replayByIndex]);

  const applyRequestSuggestions = async () => {
    if (!editor || !requestSuggestions.length) return;
    const byIndex = new Map(requestSuggestions.map((sug) => [sug.index, sug]));
    const scripted = editor.scripted.map((row, i) => {
      const sug = byIndex.get(i);
      // Blank transaction: the server names it (TCnn_Action_Target) and renumbers on save
      return sug ? { ...row, request: sug.request, transactionName: '', serverRequests: sug.calls } : row;
    });
    setEditor({ ...editor, scripted, dirty: true });
    await persistRecording(scripted);
    setNotice(`Mapped ${byIndex.size} step${byIndex.size === 1 ? '' : 's'} to server transactions and saved the recording.`);
  };

  return (
    <>
      <PageHeader
        title="Recorder"
        subtitle="Record · edit every step field · insert / delete · replay · generate scripts"
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {/* Compact control row */}
      <div className="mb-4 card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 lg:max-w-xs">
            <label className="label">Recording / Script Name</label>
            <input
              className="input-field"
              value={scriptName}
              onChange={(e) => {
                setScriptName(e.target.value);
                if (editor) setEditor({ ...editor, name: e.target.value, dirty: true });
              }}
              placeholder="Recorded_Flow"
              disabled={recording}
            />
          </div>
          <div className="min-w-0 flex-[2]">
            <label className="label">Start URL</label>
            <input
              className="input-field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/"
              disabled={recording}
            />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 pb-0.5">
            {!recording ? (
              <button type="button" onClick={startRecording} className="btn-primary whitespace-nowrap">
                <Circle className="h-4 w-4 fill-current" /> Start Recording
              </button>
            ) : (
              <>
                <button type="button" onClick={stopRecording} className="btn-danger whitespace-nowrap">
                  <Square className="h-4 w-4" /> Stop & Save ({liveSteps.length})
                </button>
                <button type="button" onClick={cancelRecording} className="btn-secondary">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
        {recording && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <Video className="mr-2 inline h-4 w-4" />
            Recording active — interact with the browser. Stop closes the browser and saves the capture.
          </div>
        )}
      </div>

      {/* Left list / right detail */}
      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="card flex flex-col overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <h3 className="text-sm font-semibold">Saved ({recordings.length})</h3>
            <button type="button" onClick={loadRecordings} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!recordings.length && (
              <p className="px-3 py-8 text-center text-xs text-slate-400">No recordings yet</p>
            )}
            {recordings.map((rec) => {
              const active = editor?.recordingId === rec.id;
              return (
                <div
                  key={rec.id}
                  className={`border-b border-slate-100 ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <button
                    type="button"
                    onClick={() => loadSaved(rec.id)}
                    className="w-full px-3 py-2.5 text-left"
                  >
                    <div className="truncate text-sm font-medium text-slate-800">{rec.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500" title={rec.startUrl}>
                      {rec.startUrl || '—'}
                    </div>
                    <div className="mt-1 flex gap-2 text-[10px] text-slate-400">
                      <span>{rec.stepCount} steps</span>
                      <span>·</span>
                      <span>{rec.urlCount} URLs</span>
                      <span>·</span>
                      <span>{formatDate(rec.updatedAt)}</span>
                    </div>
                  </button>
                  <div className="flex gap-1 px-3 pb-2">
                    <button
                      type="button"
                      onClick={() => loadSaved(rec.id)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white"
                    >
                      <Eye className="h-3 w-3" /> Open
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSaved(rec.id, rec.name)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {recording && (
            <div className="card overflow-hidden p-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold">Live steps ({liveSteps.length})</h3>
                <span className="text-xs text-slate-400"><RefreshCw className="mr-1 inline h-3 w-3 animate-spin" /> polling</span>
              </div>
              <DataTable tableClassName="text-left text-xs" scrollY maxHeight="360px">
                <thead className="bg-slate-50 text-slate-400 uppercase">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Locator</th>
                    <th className="px-3 py-2">Param</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSteps.map((s) => (
                    <tr key={s.index} className="border-t border-slate-50">
                      <td className="px-3 py-2 text-slate-400">{s.index + 1}</td>
                      <td className="px-3 py-2 font-mono">{s.action}</td>
                      <td className="px-3 py-2">{s.testStep}</td>
                      <td className="px-3 py-2 font-mono" title={s.selector}><span className="cell-truncate">{s.selector}</span></td>
                      <td className="px-3 py-2 font-mono">{s.parameter || '—'}</td>
                    </tr>
                  ))}
                  {!liveSteps.length && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Waiting for interactions…</td></tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          )}

          {!recording && !editor && (
            <div className="card flex h-full min-h-[420px] flex-col items-center justify-center text-center text-slate-500">
              <Pencil className="mb-3 h-8 w-8 text-slate-300" />
              <p className="font-medium text-slate-700">Select a recording</p>
              <p className="mt-1 max-w-sm text-sm">
                Choose a saved recording on the left, or start a new recording above.
              </p>
            </div>
          )}

          {editor && !recording && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {editor.recordingId ? 'Edit recording' : 'Review capture'}
                      {editor.dirty ? <span className="ml-2 text-xs font-normal text-amber-700">(unsaved)</span> : null}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {editor.scripted.length} steps · {editor.staticRows.length} URL(s)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={saving || replaying} onClick={replayCurrent} className="btn-primary text-sm">
                      <Play className="h-4 w-4" /> {replaying ? 'Replaying…' : 'Replay'}
                    </button>
                    <button type="button" disabled={saving || replaying} onClick={() => persistRecording()} className="btn-secondary text-sm">
                      <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Recording'}
                    </button>
                    <Link to="/app/scripts" className="btn-secondary text-sm">Scripts</Link>
                  </div>
                </div>
                {notice && (
                  <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
                )}
              </div>

              {replayResult && (
                <div className={`card overflow-hidden p-0 ${
                  replayResult.status === 'running'
                    ? 'ring-1 ring-amber-200'
                    : replayResult.ok
                      ? 'ring-1 ring-emerald-200'
                      : 'ring-1 ring-red-200'
                }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <h3 className="font-semibold">
                      {replayResult.status === 'running'
                        ? `Replay running — step ${Math.min(replayResult.results.length + 1, replayResult.total)}/${replayResult.total}`
                        : replayResult.ok
                          ? 'Replay — all steps passed'
                          : `Replay — ${replayResult.failed} step${replayResult.failed === 1 ? '' : 's'} failed`}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-500">
                        <span className="font-medium text-emerald-700">{replayResult.passed} PASS</span>
                        {' · '}
                        <span className="font-medium text-red-700">{replayResult.failed} FAIL</span>
                        {replayResult.skipped ? ` · ${replayResult.skipped} SKIP` : ''}
                        {' · '}
                        {replayResult.results.length}/{replayResult.total}
                      </span>
                      {replayResult.replayId && (replayResult.status === 'completed' || replayResult.results.length > 0) && (
                        <a className="btn-secondary text-xs" href={api.replayReportUrl(replayResult.replayId)} download>
                          Download CSV report
                        </a>
                      )}
                      {!replaying && (
                        <button type="button" className="btn-secondary text-xs" onClick={() => setReplayResult(null)}>Clear</button>
                      )}
                    </div>
                  </div>
                  {replayResult.status === 'running' && (
                    <div className="h-1.5 bg-slate-100">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{
                          width: `${replayResult.total
                            ? Math.min(100, (replayResult.results.length / replayResult.total) * 100)
                            : 0}%`,
                        }}
                      />
                    </div>
                  )}
                  <p className="border-t px-4 py-2 text-xs text-slate-500">
                    Each step's result is shown in the Status column of the Scripted View. Hover a FAIL for the full error.
                  </p>
                  {requestSuggestions.length > 0 && (
                    <div className="border-t bg-amber-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-amber-900">
                          {requestSuggestions.length} step{requestSuggestions.length === 1 ? '' : 's'} sent requests to the server but {requestSuggestions.length === 1 ? 'has' : 'have'} no transaction
                        </p>
                        <button type="button" disabled={saving} onClick={applyRequestSuggestions} className="btn-primary text-xs">
                          Map to transactions &amp; save
                        </button>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-xs text-amber-900">
                        {requestSuggestions.map((sug) => (
                          <li key={sug.index} title={sug.calls.map((c) => `${c.method} ${c.url}`).join('\n')}>
                            <span className="font-mono">#{sug.index + 1}</span> {editor.scripted[sug.index]?.testStep || editor.scripted[sug.index]?.action}
                            {' → '}<span className="font-mono">{sug.request}</span>
                            {sug.calls.length > 1 ? <span className="text-amber-700"> (+{sug.calls.length - 1} more)</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="card overflow-hidden p-0">
                <div className="flex flex-wrap items-center gap-1 border-b bg-slate-50 px-2 pt-2" role="tablist">
                  {([
                    { key: 'scripted', label: 'Scripted View', count: `${editor.scripted.length} steps`, icon: Clapperboard },
                    { key: 'static', label: 'Static View', count: `${editor.staticRows.length} URLs`, icon: FileText },
                  ] as const).map(({ key, label, count, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`-mb-px inline-flex items-center gap-2 rounded-t-lg border px-4 py-2 text-sm font-semibold ${
                        tab === key
                          ? 'border-slate-200 border-b-white bg-white text-brand-700'
                          : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" /> {label}
                      <span className="text-xs font-normal text-slate-400">{count}</span>
                      {linked[key] && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">saved</span>}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="text-xs text-slate-500">
                    {activeLinked
                      ? <>Saved as {tab} script <span className="font-semibold text-slate-700">“{activeLinked.name}”</span>{activeLinked.scriptNumber != null ? <> · Script ID <span className="font-mono">{activeLinked.scriptNumber}</span></> : null}</>
                      : `Not saved as a ${tab} script yet.`}
                    {tab === 'scripted' && <span className="ml-1">Transaction applies only to server steps.</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={saving || replaying} onClick={() => saveLinkedScript(tab)} className="btn-primary text-xs">
                      <Save className="h-3.5 w-3.5" /> {activeLinked ? 'Update' : 'Save'} {tab === 'scripted' ? 'Scripted' : 'Static'} Script
                    </button>
                    {activeLinked && (
                      <>
                        <Link to={`/app/scripts/${encodeURIComponent(activeLinked.id)}`} className="btn-secondary text-xs">
                          <Eye className="h-3.5 w-3.5" /> View / Edit
                        </Link>
                        <button type="button" onClick={() => deleteLinkedScript(tab)} className="btn-secondary text-xs text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                    {tab === 'scripted' ? (
                      <button type="button" onClick={appendStep} className="btn-secondary text-xs">
                        <Plus className="h-3.5 w-3.5" /> Add Step
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditor({ ...editor, staticRows: editor.derivedStatic, dirty: true })}
                          className="btn-secondary text-xs"
                          title="Rebuild the URL list from the recorded steps"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Regenerate from steps
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditor({
                            ...editor,
                            dirty: true,
                            staticRows: [...editor.staticRows, { transactionName: '', pageUrl: '', elementIdentifier: 'XPath', elementSelector: '//body' }],
                          })}
                          className="btn-secondary text-xs"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add URL
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {tab === 'scripted' ? (
                  editor.scripted.length ? (
                    <ScriptedRowsTable
                      rows={editor.scripted}
                      onChange={(rows) => setEditor({ ...editor, dirty: true, scripted: rows as EditableStep[] })}
                      onRowPatch={(i, patch) => updateStepField(i, patch)}
                      rowStatus={replayResult ? rowStatus : undefined}
                      renderRowActions={(i) => {
                        const candidates = editor.scripted[i]?.locatorCandidates ?? [];
                        return (
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => insertStep(i, 'before')} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Insert step before"><Plus className="h-3.5 w-3.5" /></button>
                            <button type="button" disabled={i === 0} onClick={() => moveStep(i, -1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                            <button type="button" disabled={i === editor.scripted.length - 1} onClick={() => moveStep(i, 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => removeStep(i)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete step"><Trash2 className="h-3.5 w-3.5" /></button>
                            {candidates.length > 0 && (
                              <select
                                className="ml-1 w-24 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                                value=""
                                title="Switch to an alternate locator"
                                onChange={(e) => {
                                  const cand = candidates[Number(e.target.value)];
                                  if (!cand) return;
                                  updateStepField(i, {
                                    selector: cand.selector,
                                    locator: cand.strategy === 'xpath' ? 'Xpath' : 'CSS',
                                    locatorLabel: cand.label || cand.strategy,
                                  });
                                }}
                              >
                                <option value="">Alternates…</option>
                                {candidates.map((c, ci) => (
                                  <option key={ci} value={ci}>
                                    {(c.unique ? '✓ ' : '') + (c.label || c.strategy) + ': ' + c.selector.slice(0, 80)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      }}
                    />
                  ) : (
                    <div className="px-4 py-10 text-center text-sm text-slate-400">
                      No steps yet.
                      <button type="button" onClick={appendStep} className="ml-2 text-brand-600 underline">Add the first step</button>
                    </div>
                  )
                ) : (
                  <StaticRowsTable
                    rows={editor.staticRows}
                    onChange={(rows) => setEditor({ ...editor, dirty: true, staticRows: rows })}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
