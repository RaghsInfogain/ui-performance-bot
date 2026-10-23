import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Save, FileText, ArrowLeft, Video } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { api } from '../services/api';
import { sanitizeScriptedRows } from '../utils/scriptedSteps';
import {
  ScriptedRowsTable, StaticRowsTable, emptyScriptedRow, emptyStaticRow,
  type ScriptedRow, type StaticRow,
} from '../components/scripts/ScriptRowsTable';

type CreateMode = 'static' | 'scripted';

function modeFromPath(pathname: string): CreateMode | null {
  if (pathname.includes('/scripts/new/static')) return 'static';
  if (pathname.includes('/scripts/new/scripted')) return 'scripted';
  return null;
}

export default function ScriptStudio() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = modeFromPath(location.pathname);

  const [scriptName, setScriptName] = useState('');
  const [scriptDesc, setScriptDesc] = useState('');

  const [staticRows, setStaticRows] = useState<StaticRow[]>([emptyStaticRow()]);
  const [scriptedRows, setScriptedRows] = useState<ScriptedRow[]>([emptyScriptedRow()]);

  if (!mode) {
    return <Navigate to="/app/scripts" replace />;
  }

  const saveStaticScript = async () => {
    if (!scriptName.trim()) return alert('Enter a script name');
    await api.saveScript({ name: scriptName, type: 'static', description: scriptDesc, rows: staticRows });
    alert(`Static script "${scriptName}" saved`);
    navigate('/app/scripts');
  };

  const saveScriptedScript = async () => {
    if (!scriptName.trim()) return alert('Enter a script name');
    const rows = sanitizeScriptedRows(scriptedRows);
    await api.saveScript({ name: scriptName, type: 'scripted', description: scriptDesc, rows });
    alert(`Scripted flow "${scriptName}" saved`);
    navigate('/app/scripts');
  };

  const backLink = (
    <Link to="/app/scripts" className="btn-secondary text-sm">
      <ArrowLeft className="h-4 w-4" /> Back to Scripts
    </Link>
  );

  return (
    <>
      <PageHeader
        title={mode === 'static' ? 'New Static Flow' : 'New Scripted Flow'}
        subtitle={
          mode === 'static'
            ? 'Build a static URL list for performance testing'
            : 'Build a scripted UI flow — or use Recorder to capture from the browser'
        }
        actions={backLink}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Script Name</label>
          <input className="input-field" value={scriptName} onChange={(e) => setScriptName(e.target.value)} placeholder="e.g. VA Homepage Perf" />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input-field" value={scriptDesc} onChange={(e) => setScriptDesc(e.target.value)} placeholder="Optional description" />
        </div>
      </div>

      {mode === 'scripted' && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          Prefer capturing from a live browser?{' '}
          <Link to="/app/recorder" className="inline-flex items-center gap-1 font-semibold underline">
            <Video className="h-3.5 w-3.5" /> Open Recorder
          </Link>
        </div>
      )}

      {mode === 'static' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <h3 className="font-semibold">Static URL List</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStaticRows([...staticRows, emptyStaticRow()])}
                className="btn-secondary text-xs"
              >
                <Plus className="h-3 w-3" /> Add URL
              </button>
              <button type="button" onClick={saveStaticScript} className="btn-primary text-xs">
                <Save className="h-3 w-3" /> Save Script
              </button>
            </div>
          </div>
          <StaticRowsTable rows={staticRows} onChange={setStaticRows} />
        </div>
      )}

      {mode === 'scripted' && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          Prefer capturing from a live browser?{' '}
          <Link to="/app/recorder" className="inline-flex items-center gap-1 font-semibold underline">
            <Video className="h-3.5 w-3.5" /> Open Recorder
          </Link>
        </div>
      )}

      {mode === 'static' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <h3 className="font-semibold">Static URL List</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStaticRows([...staticRows, emptyStaticRow()])}
                className="btn-secondary text-xs"
              >
                <Plus className="h-3 w-3" /> Add URL
              </button>
              <button type="button" onClick={saveStaticScript} className="btn-primary text-xs">
                <Save className="h-3 w-3" /> Save Script
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {staticRows.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-4">
                <input className="input-field" placeholder="Transaction Name" value={row.transactionName} onChange={(e) => { const r = [...staticRows]; r[i] = { ...r[i], transactionName: e.target.value }; setStaticRows(r); }} />
                <input className="input-field sm:col-span-2" placeholder="Page URL" value={row.pageUrl} onChange={(e) => { const r = [...staticRows]; r[i] = { ...r[i], pageUrl: e.target.value }; setStaticRows(r); }} />
                <input className="input-field" placeholder="Wait selector (load complete)" value={row.elementSelector} onChange={(e) => { const r = [...staticRows]; r[i] = { ...r[i], elementSelector: e.target.value }; setStaticRows(r); }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'scripted' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Scripted Steps</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Transaction is only for server request/response steps. Client-side steps leave it blank.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setScriptedRows([...scriptedRows, { ...emptyScriptedRow(), testCaseName: scriptedRows[0]?.testCaseName || 'My_Flow', action: 'Click' }])}
                className="btn-secondary text-xs"
              >
                <Plus className="h-3 w-3" /> Add Step
              </button>
              <button type="button" onClick={saveScriptedScript} className="btn-primary text-xs">
                <Save className="h-3 w-3" /> Save Script
              </button>
            </div>
          </div>
          <ScriptedRowsTable rows={scriptedRows} onChange={setScriptedRows} />
        </div>
      )}
    </>
  );
}
