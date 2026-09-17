import { useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Save } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api } from '../services/api';
import type { StaticTestCase, ScriptedStep } from '../types';
import { SCRIPTED_ACTIONS } from '../types';

type Tab = 'static' | 'scripted';

export default function TestCases() {
  const [tab, setTab] = useState<Tab>('static');
  const [staticCases, setStaticCases] = useState<StaticTestCase[]>([]);
  const [scriptedSteps, setScriptedSteps] = useState<ScriptedStep[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>('Orange_HRM');

  useEffect(() => {
    api.getStaticTestCases().then(setStaticCases);
    api.getScriptedSteps().then(setScriptedSteps);
  }, []);

  const caseNames = [...new Set(scriptedSteps.map((s) => s.testCaseName))];
  const filteredSteps = scriptedSteps.filter((s) => s.testCaseName === selectedCase);

  const saveStatic = async () => {
    await api.saveStaticTestCases(staticCases);
    alert('Static test cases saved to StaticTestCases.csv and synced to Script Library as "Legacy Static Test Cases"');
  };

  const addStaticRow = () => {
    setStaticCases([...staticCases, { id: String(Date.now()), transactionName: '', pageUrl: '', elementIdentifier: '', elementSelector: '' }]);
  };

  const deleteStatic = (id: string) => setStaticCases(staticCases.filter((c) => c.id !== id));

  const saveScripted = async () => {
    await api.saveScriptedSteps(scriptedSteps);
    alert('Scripted test cases saved and synced to Script Library as "Legacy Scripted Flow"');
  };

  return (
    <>
      <PageHeader
        title="Test Cases"
        subtitle="Manage static URL lists and scripted UI flow steps"
        actions={
          tab === 'scripted' ? (
            <button onClick={saveScripted} className="btn-primary"><Save className="h-4 w-4" /> Save Scripted Suite</button>
          ) : (
            <>
              <button onClick={saveStatic} className="btn-primary"><Save className="h-4 w-4" /> Save Static Cases</button>
              <label className="btn-secondary cursor-pointer">
              <Upload className="h-4 w-4" /> Import CSV
              <input type="file" accept=".csv" className="hidden" onChange={() => api.importStaticTestCasesCsv(new File([], 'x.csv'))} />
            </label>
            </>
          )
        }
      />

      <div className="mb-6 flex gap-2 border-b border-slate-200">
        {(['static', 'scripted'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold capitalize transition ${
              tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'static' ? 'Static URL List' : 'Scripted Flows'}
          </button>
        ))}
      </div>

      {tab === 'static' && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-4 sm:px-6">
            <h3 className="font-display font-semibold">Static Test Cases</h3>
            <button onClick={addStaticRow} className="btn-secondary text-xs"><Plus className="h-3 w-3" /> Add Row</button>
          </div>
          <div className="space-y-3 p-4 sm:p-6">
            {staticCases.map((tc) => (
              <div key={tc.id} className="grid min-w-0 gap-2 sm:grid-cols-12 sm:items-center">
                <input className="input-field sm:col-span-2" placeholder="Transaction" value={tc.transactionName} onChange={(e) => setStaticCases(staticCases.map((c) => c.id === tc.id ? { ...c, transactionName: e.target.value } : c))} />
                <input className="input-field sm:col-span-4" placeholder="Page URL" value={tc.pageUrl} onChange={(e) => setStaticCases(staticCases.map((c) => c.id === tc.id ? { ...c, pageUrl: e.target.value } : c))} />
                <input className="input-field sm:col-span-2" placeholder="Element ID" value={tc.elementIdentifier} onChange={(e) => setStaticCases(staticCases.map((c) => c.id === tc.id ? { ...c, elementIdentifier: e.target.value } : c))} />
                <input className="input-field sm:col-span-3" placeholder="Selector" value={tc.elementSelector} onChange={(e) => setStaticCases(staticCases.map((c) => c.id === tc.id ? { ...c, elementSelector: e.target.value } : c))} />
                <button onClick={() => deleteStatic(tc.id)} className="justify-self-end text-red-500 hover:text-red-700 sm:col-span-1"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'scripted' && (
        <div className="grid min-w-0 gap-6 lg:grid-cols-4">
          <div className="card min-w-0 lg:col-span-1">
            <h3 className="mb-3 font-display font-semibold">Test Cases</h3>
            <ul className="space-y-1">
              {caseNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setSelectedCase(name)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    selectedCase === name ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </ul>
          </div>
          <div className="card min-w-0 overflow-hidden p-0 lg:col-span-3">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
              <h3 className="font-display font-semibold">Steps: {selectedCase}</h3>
            </div>
            <DataTable tableClassName="text-left text-xs">
              <colgroup>
                <col style={{ width: '6%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '26%' }} />
              </colgroup>
              <thead className="bg-slate-50 uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Step</th>
                  <th className="px-2 py-2">Action</th>
                  <th className="px-2 py-2">Selector</th>
                  <th className="px-2 py-2">Parameter</th>
                  <th className="px-2 py-2">Element</th>
                </tr>
              </thead>
              <tbody>
                {filteredSteps.map((step, i) => (
                  <tr key={step.id} className="border-t border-slate-50">
                    <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2" title={step.testStep}><span className="cell-truncate">{step.testStep}</span></td>
                    <td className="px-2 py-2"><span className="cell-truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono">{step.action}</span></td>
                    <td className="px-2 py-2 font-mono text-slate-500" title={step.selector}><span className="cell-truncate">{step.selector}</span></td>
                    <td className="px-2 py-2" title={step.parameter}><span className="cell-truncate">{step.parameter}</span></td>
                    <td className="px-2 py-2 font-mono text-slate-500" title={step.elementIdentifier}><span className="cell-truncate">{step.elementIdentifier}</span></td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <div className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
              Supported actions: {SCRIPTED_ACTIONS.join(', ')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
