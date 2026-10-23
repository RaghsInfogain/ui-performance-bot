import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Pencil, Trash2, Plus, RefreshCw, X, Globe, FileText, Clapperboard, Play } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api } from '../services/api';
import type { TestScript } from '../types';

export type ScriptDisplayType = 'Crawled' | 'Scripted' | 'Static';

export function scriptDisplayType(script: TestScript): ScriptDisplayType {
  if (script.source === 'crawled') return 'Crawled';
  if (script.type === 'scripted') return 'Scripted';
  return 'Static';
}

function typeBadgeClass(type: ScriptDisplayType) {
  if (type === 'Crawled') return 'bg-sky-50 text-sky-800 ring-sky-200';
  if (type === 'Scripted') return 'bg-violet-50 text-violet-800 ring-violet-200';
  return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const NEW_SCRIPT_OPTIONS = [
  {
    id: 'crawler',
    title: 'Website Crawler',
    description: 'Discover same-domain URLs and save them as a crawled script.',
    to: '/app/crawler',
    icon: Globe,
    accent: 'bg-sky-50 text-sky-800',
  },
  {
    id: 'static',
    title: 'Static Flow',
    description: 'Manually build a list of page URLs for static performance tests.',
    to: '/app/scripts/new/static',
    icon: FileText,
    accent: 'bg-emerald-50 text-emerald-800',
  },
  {
    id: 'scripted',
    title: 'Scripted Flow',
    description: 'Create or record step-by-step UI interactions with timings.',
    to: '/app/scripts/new/scripted',
    icon: Clapperboard,
    accent: 'bg-violet-50 text-violet-800',
  },
] as const;

export default function Scripts() {
  const navigate = useNavigate();
  const [scripts, setScripts] = useState<TestScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setScripts(await api.listScripts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scripts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (script: TestScript) => {
    const label = script.scriptNumber != null ? `#${script.scriptNumber} ${script.name}` : script.name;
    if (!confirm(`Delete script ${label}?`)) return;
    try {
      await api.deleteScript(script.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete script');
    }
  };

  const syncLegacy = async () => {
    try {
      const res = await api.syncLegacyScripts();
      alert(`Synced ${res.synced} scripts (legacy static, scripted, and crawled URLs)`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Sync failed');
    }
  };

  const chooseType = (to: string) => {
    setShowNewModal(false);
    navigate(to);
  };

  return (
    <>
      <PageHeader
        title="Scripts"
        subtitle="All static, scripted, and crawled scripts in the library"
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={syncLegacy} className="btn-secondary text-sm">
              <RefreshCw className="h-4 w-4" /> Sync Legacy & Crawled
            </button>
            <button type="button" onClick={() => setShowNewModal(true)} className="btn-primary text-sm">
              <Plus className="h-4 w-4" /> New Script
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="card overflow-hidden p-0">
        <DataTable tableClassName="text-left text-sm">
          <colgroup>
            <col style={{ width: '8%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '28%' }} />
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3">Script ID</th>
              <th className="px-3 py-3">Script Name</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Date Created</th>
              <th className="px-3 py-3">Last Updated</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scripts.map((script) => {
              const displayType = scriptDisplayType(script);
              return (
                <tr key={script.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-3 py-3 font-mono text-xs font-semibold text-brand-600">
                    {script.scriptNumber != null ? script.scriptNumber : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900" title={script.name}>{script.name}</div>
                    {script.description ? (
                      <div className="mt-0.5 truncate text-xs text-slate-400" title={script.description}>
                        {script.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${typeBadgeClass(displayType)}`}>
                      {displayType}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{formatDate(script.createdAt)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">{formatDate(script.updatedAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                      <Link
                        to={`/app/run-test?scriptId=${encodeURIComponent(script.id)}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                        title="Run this script"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Run
                      </Link>
                      <Link
                        to={`/app/scripts/${encodeURIComponent(script.id)}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-brand-700"
                        title="View / Edit"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <Pencil className="h-3.5 w-3.5" />
                        View/Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(script)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && !scripts.length && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                  No scripts yet. Click <button type="button" className="font-semibold text-brand-600 underline" onClick={() => setShowNewModal(true)}>New Script</button> to create one.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-slate-400">Loading scripts…</td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="new-script-title">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="new-script-title" className="font-display text-lg font-semibold text-slate-900">Create a new script</h2>
                <p className="mt-1 text-sm text-slate-500">Choose how you want to build it.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              {NEW_SCRIPT_OPTIONS.map(({ id, title, description, to, icon: Icon, accent }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseType(to)}
                  className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
