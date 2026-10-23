import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { api } from '../services/api';
import type { TestScript } from '../types';
import { scriptDisplayType } from './Scripts';
import { sanitizeScriptedRows } from '../utils/scriptedSteps';
import {
  ScriptedRowsTable, StaticRowsTable, emptyScriptedRow, emptyStaticRow,
  type ScriptedRow, type StaticRow,
} from '../components/scripts/ScriptRowsTable';
import { TestDataPanel } from '../components/scripts/TestDataPanel';

function normalizeStaticRows(rows: unknown[]): StaticRow[] {
  if (!rows?.length) return [emptyStaticRow()];
  return rows.map((raw) => {
    const r = raw as Record<string, string>;
    return {
      transactionName: r.transactionName ?? r['Transaction Name'] ?? '',
      pageUrl: r.pageUrl ?? r['Path Page URL'] ?? '',
      elementIdentifier: r.elementIdentifier ?? r['Element Identifier'] ?? 'XPath',
      elementSelector: r.elementSelector ?? r['Element Selector'] ?? '',
    };
  });
}

function normalizeScriptedRows(rows: unknown[]): ScriptedRow[] {
  if (!rows?.length) return [emptyScriptedRow()];
  return rows.map((raw) => {
    const r = raw as Record<string, string>;
    return {
      testCaseName: r.testCaseName ?? r.Test_Case_Name ?? '',
      transactionName: r.transactionName ?? r.Transaction_Name ?? '',
      testStep: r.testStep ?? r.Test_Steps ?? '',
      objectName: r.objectName ?? r.Object_Name ?? '',
      request: r.request ?? r.Request ?? '',
      selector: r.selector ?? r.Selector ?? '',
      locator: r.locator ?? r.Locator ?? 'Xpath',
      action: r.action ?? r.Action ?? 'Click',
      parameter: r.parameter ?? r.Parameter ?? '',
      elementToWait: r.elementToWait ?? r['Element to Wait'] ?? 'Xpath',
      elementIdentifier: r.elementIdentifier ?? r['Element identifier'] ?? '',
      frameSelector: r.frameSelector ?? r.Frame_Selector ?? '',
    };
  });
}

export default function ScriptEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<TestScript | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [staticRows, setStaticRows] = useState<StaticRow[]>([emptyStaticRow()]);
  const [scriptedRows, setScriptedRows] = useState<ScriptedRow[]>([emptyScriptedRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const script = await api.getScript(decodeURIComponent(id));
        if (cancelled) return;
        setMeta(script);
        setName(script.name);
        setDescription(script.description ?? '');
        if (script.type === 'scripted') {
          setScriptedRows(normalizeScriptedRows(script.rows ?? []));
        } else {
          setStaticRows(normalizeStaticRows(script.rows ?? []));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load script');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleSave = async () => {
    if (!meta) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert('Enter a script name');
      return;
    }
    setSaving(true);
    try {
      const rows = meta.type === 'scripted'
        ? sanitizeScriptedRows(scriptedRows)
        : staticRows;
      await api.saveScript({
        id: meta.id,
        name: trimmed,
        type: meta.type,
        description,
        rows,
        source: meta.source,
        crawlRunId: meta.crawlRunId,
      });
      alert(`Script "${trimmed}" updated`);
      navigate('/app/scripts');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="View / Edit Script" subtitle="Loading…" />
        <div className="card p-8 text-center text-slate-400">Loading script steps…</div>
      </>
    );
  }

  if (error || !meta) {
    return (
      <>
        <PageHeader title="View / Edit Script" subtitle="Script not found" />
        <div className="card p-6">
          <p className="mb-4 text-sm text-red-700">{error || 'Script not found'}</p>
          <Link to="/app/scripts" className="btn-secondary text-sm"><ArrowLeft className="h-4 w-4" /> Back to Scripts</Link>
        </div>
      </>
    );
  }

  const displayType = scriptDisplayType(meta);
  const isStaticLike = meta.type === 'static';

  return (
    <>
      <PageHeader
        title="View / Edit Script"
        subtitle={`${displayType} · Script ID ${meta.scriptNumber ?? '—'} · ${meta.stepCount} step${meta.stepCount === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/app/scripts" className="btn-secondary text-sm"><ArrowLeft className="h-4 w-4" /> Back</Link>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Script Name</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div>
          <label className="label">Type</label>
          <input className="input-field bg-slate-50" value={displayType} readOnly />
        </div>
        <div>
          <label className="label">Script ID</label>
          <input className="input-field bg-slate-50 font-mono" value={meta.scriptNumber ?? '—'} readOnly />
        </div>
      </div>

      {isStaticLike ? (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <div>
              <h3 className="font-semibold">Page / URL Steps ({staticRows.length})</h3>
              <p className="mt-0.5 text-xs text-slate-500">Element Selector is the element whose appearance confirms the page has loaded.</p>
            </div>
            <button
              type="button"
              onClick={() => setStaticRows([...staticRows, emptyStaticRow()])}
              className="btn-secondary text-xs"
            >
              <Plus className="h-3 w-3" /> Add URL
            </button>
          </div>
          <StaticRowsTable rows={staticRows} onChange={setStaticRows} />
        </div>
      ) : (
        <>
        <TestDataPanel scriptId={meta.id} steps={scriptedRows} />
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-6">
            <div>
              <h3 className="font-semibold">Scripted Steps ({scriptedRows.length})</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Transaction applies only to server request/response steps. Client-side steps leave it blank. Scroll sideways to see every column.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScriptedRows([...scriptedRows, { ...emptyScriptedRow(), testCaseName: scriptedRows[0]?.testCaseName || name || 'My_Flow', action: 'Click', transactionName: '' }])}
              className="btn-secondary text-xs"
            >
              <Plus className="h-3 w-3" /> Add Step
            </button>
          </div>
          <ScriptedRowsTable rows={scriptedRows} onChange={setScriptedRows} />
        </div>
        </>
      )}
    </>
  );
}
