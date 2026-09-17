import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Save, Circle, Square, Video, FileText, List, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api } from '../services/api';
import type { TestScript } from '../types';
import { SCRIPTED_ACTIONS } from '../types';

type Tab = 'library' | 'static' | 'scripted' | 'recorder';

export default function ScriptStudio() {
  const [tab, setTab] = useState<Tab>('library');
  const [scripts, setScripts] = useState<TestScript[]>([]);
  const [scriptName, setScriptName] = useState('');
  const [scriptDesc, setScriptDesc] = useState('');

  // Static builder
  const [staticRows, setStaticRows] = useState([{ transactionName: '', pageUrl: '', elementIdentifier: 'XPath', elementSelector: '' }]);

  // Scripted builder
  const [scriptedRows, setScriptedRows] = useState([{
    testCaseName: 'My_Flow', transactionName: '', testStep: '', objectName: '',
    request: '', selector: '', locator: 'Xpath', action: 'Navigate', parameter: '',
    elementToWait: 'Xpath', elementIdentifier: '', frameSelector: '',
  }]);

  // Recorder
  const [recorderUrl, setRecorderUrl] = useState('https://opensource-demo.orangehrmlive.com/');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recorderSteps, setRecorderSteps] = useState(0);
  const [recording, setRecording] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadScripts = () => api.listScripts().then(setScripts);

  useEffect(() => { loadScripts(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const saveStaticScript = async () => {
    if (!scriptName.trim()) return alert('Enter a script name');
    await api.saveScript({ name: scriptName, type: 'static', description: scriptDesc, rows: staticRows });
    alert(`Static script "${scriptName}" saved`);
    loadScripts();
  };

  const saveScriptedScript = async () => {
    if (!scriptName.trim()) return alert('Enter a script name');
    await api.saveScript({ name: scriptName, type: 'scripted', description: scriptDesc, rows: scriptedRows });
    alert(`Scripted flow "${scriptName}" saved`);
    loadScripts();
  };

  const startRecording = async () => {
    try {
      const res = await api.startRecorder(recorderUrl);
      setSessionId(res.sessionId);
      setRecording(true);
      setRecorderSteps(0);
      pollRef.current = setInterval(async () => {
        if (!res.sessionId) return;
        const st = await api.getRecorderStatus(res.sessionId);
        setRecorderSteps(st.stepCount);
      }, 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to start recorder. Ensure Playwright is installed.');
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    const result = await api.stopRecorder(sessionId, scriptName || 'Recorded_Flow');
    setRecording(false);
    setSessionId(null);
    if (result?.steps?.length) {
      setScriptedRows(result.steps.map((s) => ({
        testCaseName: s.testCaseName ?? (scriptName || 'Recorded_Flow'),
        transactionName: s.transactionName ?? '',
        testStep: s.testStep ?? '',
        objectName: '',
        request: s.request ?? '',
        selector: s.selector ?? '',
        locator: s.locator ?? 'Xpath',
        action: s.action ?? 'Click',
        parameter: s.parameter ?? '',
        elementToWait: s.elementToWait ?? 'Xpath',
        elementIdentifier: s.elementIdentifier ?? '',
        frameSelector: s.frameSelector ?? '',
      })));
      setTab('scripted');
      setScriptName(scriptName || 'Recorded_Flow');
      alert(`Recorded ${result.steps.length} steps. Review and save the scripted flow.`);
    }
  };

  const deleteScript = async (id: string) => {
    if (!confirm('Delete this script?')) return;
    await api.deleteScript(id);
    loadScripts();
  };

  const startRename = (script: TestScript) => {
    setRenamingId(script.id);
    setRenameValue(script.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const saveRename = async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return alert('Enter a script name');
    try {
      await api.renameScript(id, trimmed);
      cancelRename();
      loadScripts();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to rename script. Restart API server: npm run server');
    }
  };

  const syncLegacy = async () => {
    const res = await api.syncLegacyScripts();
    alert(`Synced ${res.synced} scripts (legacy static, scripted, and all crawled URL files)`);
    loadScripts();
  };

  return (
    <>
      <PageHeader title="Script Studio" subtitle="Create static URL lists, scripted flows, and record UI interactions with Playwright" />

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200">
        {([
          ['library', 'Script Library', List],
          ['static', 'Static Flow', FileText],
          ['scripted', 'Scripted Flow', FileText],
          ['recorder', 'Recorder', Video],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500'}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div><label className="label">Script Name</label><input className="input-field" value={scriptName} onChange={(e) => setScriptName(e.target.value)} placeholder="e.g. VA Homepage Perf" /></div>
        <div><label className="label">Description</label><input className="input-field" value={scriptDesc} onChange={(e) => setScriptDesc(e.target.value)} placeholder="Optional description" /></div>
      </div>

      {tab === 'library' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <span className="font-semibold">Saved Scripts ({scripts.length})</span>
            <button onClick={syncLegacy} className="btn-secondary text-xs"><RefreshCw className="h-3 w-3" /> Sync Legacy & Crawled</button>
          </div>
          <DataTable tableClassName="text-sm">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-3 text-left">Name</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Steps</th>
                <th className="px-3 py-3">Updated</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {scripts.map((s) => (
                <tr key={s.id} className="border-t border-slate-50">
                  <td className="px-3 py-3 font-medium">
                    {renamingId === s.id ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <input
                          className="input-field min-w-0 py-1 text-sm"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(s.id);
                            if (e.key === 'Escape') cancelRename();
                          }}
                          autoFocus
                        />
                        <button onClick={() => saveRename(s.id)} className="shrink-0 text-green-600" title="Save name"><Check className="h-4 w-4" /></button>
                        <button onClick={cancelRename} className="shrink-0 text-slate-400" title="Cancel"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <span className="cell-truncate" title={s.name}>{s.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 capitalize">{s.type}</td>
                  <td className="px-3 py-3 capitalize text-slate-500">{s.source ?? 'studio'}</td>
                  <td className="px-3 py-3 text-center">{s.stepCount}</td>
                  <td className="px-3 py-3 text-xs text-slate-400">{new Date(s.updatedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {renamingId !== s.id && (
                        <button onClick={() => startRename(s)} className="text-slate-500 hover:text-brand-600" title="Rename script">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => deleteScript(s.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!scripts.length && <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No scripts yet. Create one in Static, Scripted, or Recorder tabs — legacy CSVs and crawled URLs sync on API startup.</td></tr>}
            </tbody>
          </DataTable>
        </div>
      )}

      {tab === 'static' && (
        <div className="card">
          <div className="mb-4 flex justify-between">
            <h3 className="font-semibold">Static URL List</h3>
            <div className="flex gap-2">
              <button onClick={() => setStaticRows([...staticRows, { transactionName: '', pageUrl: '', elementIdentifier: 'XPath', elementSelector: '' }])} className="btn-secondary text-xs"><Plus className="h-3 w-3" /> Add URL</button>
              <button onClick={saveStaticScript} className="btn-primary text-xs"><Save className="h-3 w-3" /> Save Script</button>
            </div>
          </div>
          <div className="space-y-2">
            {staticRows.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-4">
                <input className="input-field" placeholder="Transaction Name" value={row.transactionName} onChange={(e) => { const r = [...staticRows]; r[i].transactionName = e.target.value; setStaticRows(r); }} />
                <input className="input-field sm:col-span-2" placeholder="Page URL" value={row.pageUrl} onChange={(e) => { const r = [...staticRows]; r[i].pageUrl = e.target.value; setStaticRows(r); }} />
                <input className="input-field" placeholder="Element Selector (optional)" value={row.elementSelector} onChange={(e) => { const r = [...staticRows]; r[i].elementSelector = e.target.value; setStaticRows(r); }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'scripted' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <h3 className="font-semibold">Scripted Steps</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setScriptedRows([...scriptedRows, { ...scriptedRows[0], testStep: '', action: 'Click', parameter: '', selector: '' }])} className="btn-secondary text-xs"><Plus className="h-3 w-3" /> Add Step</button>
              <button onClick={saveScriptedScript} className="btn-primary text-xs"><Save className="h-3 w-3" /> Save Script</button>
            </div>
          </div>
          <div className="space-y-3 p-4 sm:p-6">
            {scriptedRows.map((row, i) => (
              <div key={i} className="grid min-w-0 gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-12 sm:items-center">
                <input className="input-field sm:col-span-2" placeholder="Step" value={row.testStep} onChange={(e) => { const r = [...scriptedRows]; r[i].testStep = e.target.value; setScriptedRows(r); }} />
                <select className="input-field sm:col-span-2" value={row.action} onChange={(e) => { const r = [...scriptedRows]; r[i].action = e.target.value; setScriptedRows(r); }}>
                  {SCRIPTED_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <input className="input-field sm:col-span-3" placeholder="Selector" value={row.selector} onChange={(e) => { const r = [...scriptedRows]; r[i].selector = e.target.value; setScriptedRows(r); }} />
                <input className="input-field sm:col-span-2" placeholder="Parameter" value={row.parameter} onChange={(e) => { const r = [...scriptedRows]; r[i].parameter = e.target.value; setScriptedRows(r); }} />
                <input className="input-field sm:col-span-2" placeholder="Wait element" value={row.elementIdentifier} onChange={(e) => { const r = [...scriptedRows]; r[i].elementIdentifier = e.target.value; setScriptedRows(r); }} />
                <button onClick={() => setScriptedRows(scriptedRows.filter((_, j) => j !== i))} className="justify-self-end text-red-500 sm:col-span-1"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'recorder' && (
        <div className="card">
          <h3 className="mb-2 font-semibold">Playwright Recorder</h3>
          <p className="mb-4 text-sm text-slate-500">Opens a real browser window. Your clicks and form inputs are captured as scripted steps.</p>
          <div className="flex flex-wrap gap-3">
            <input className="input-field flex-1" value={recorderUrl} onChange={(e) => setRecorderUrl(e.target.value)} placeholder="Start URL" disabled={recording} />
            {!recording ? (
              <button onClick={startRecording} className="btn-primary"><Circle className="h-4 w-4 fill-current" /> Start Recording</button>
            ) : (
              <button onClick={stopRecording} className="btn-danger"><Square className="h-4 w-4" /> Stop & Import ({recorderSteps} steps)</button>
            )}
          </div>
          {recording && (
            <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              Recording active — interact with the browser window. Click <strong>Stop & Import</strong> when done.
            </div>
          )}
        </div>
      )}
    </>
  );
}
