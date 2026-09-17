import { useEffect, useState } from 'react';
import { Save, CheckCircle, AlertCircle } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { api } from '../services/api';
import type { AppConfig } from '../types';

export default function Configuration() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { api.getConfig().then(setConfig); }, []);

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    if (config) setConfig({ ...config, [key]: value });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const { valid, errors } = await api.validateConfig(config);
    if (!valid) {
      setMessage({ type: 'err', text: errors.join(' ') });
      setSaving(false);
      return;
    }
    await api.saveConfig(config);
    setMessage({ type: 'ok', text: 'Configuration saved successfully.' });
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  };

  if (!config) return <div className="text-slate-400">Loading configuration…</div>;

  return (
    <>
      <PageHeader
        title="Configuration"
        subtitle="Browser settings, execution flags, and paths — maps to config.csv & Properties"
        actions={<button onClick={handleSave} disabled={saving} className="btn-primary"><Save className="h-4 w-4" /> Save Configuration</button>}
      />

      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg p-3 text-sm ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
          {message.type === 'ok' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">Browser & Execution</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Browser Type</label>
              <select className="input-field" value={config.browserType} onChange={(e) => update('browserType', e.target.value as AppConfig['browserType'])}>
                <option value="chrome">Chrome (Chromium)</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div><label className="label mb-0">Headless Mode</label><p className="text-xs text-slate-400">Run browser without UI</p></div>
              <input type="checkbox" checked={config.headlessMode} onChange={(e) => update('headlessMode', e.target.checked)} className="h-5 w-5 rounded" />
            </div>
            <div>
              <label className="label">Test Duration (seconds)</label>
              <input type="number" className="input-field" value={config.testDurationSeconds ?? ''} placeholder="0 or empty = no limit" onChange={(e) => update('testDurationSeconds', e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <label className="label">Multi-Threading</label>
              <input type="number" min={1} className="input-field" value={config.multiThreading} onChange={(e) => update('multiThreading', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Think Time (ms)</label>
              <input type="number" min={0} className="input-field" value={config.thinkTime} onChange={(e) => update('thinkTime', Number(e.target.value))} />
            </div>
            <div className="flex items-center justify-between">
              <div><label className="label mb-0">Take Screenshot</label></div>
              <input type="checkbox" checked={config.takeScreenshot} onChange={(e) => update('takeScreenshot', e.target.checked)} className="h-5 w-5 rounded" />
            </div>
          </div>
        </section>

        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">Test Mode & Crawl</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
              <div><label className="label mb-0">Scripted Flow</label><p className="text-xs text-slate-400">Step-by-step UI scripts</p></div>
              <input type="checkbox" checked={config.scriptedFlow} onChange={(e) => update('scriptedFlow', e.target.checked)} className="h-5 w-5 rounded" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
              <div><label className="label mb-0">User Experience (Lighthouse)</label><p className="text-xs text-slate-400">FCP, LCP, TBT, CLS, Speed Index</p></div>
              <input type="checkbox" checked={config.userExperience} onChange={(e) => update('userExperience', e.target.checked)} className="h-5 w-5 rounded" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
              <div><label className="label mb-0">Auto Crawl</label><p className="text-xs text-slate-400">Crawl before test run</p></div>
              <input type="checkbox" checked={config.autoCrawl} onChange={(e) => update('autoCrawl', e.target.checked)} className="h-5 w-5 rounded" />
            </div>
            <div>
              <label className="label">Crawler Start URL</label>
              <input type="url" className="input-field" value={config.crawlerUrl} onChange={(e) => update('crawlerUrl', e.target.value)} placeholder="https://example.com/" />
            </div>
            <div>
              <label className="label">Result Directory</label>
              <input className="input-field" value={config.resultDirectory} onChange={(e) => update('resultDirectory', e.target.value)} />
            </div>
            <div>
              <label className="label">Screenshot Directory</label>
              <input className="input-field" value={config.screenshotDirectory} onChange={(e) => update('screenshotDirectory', e.target.value)} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
