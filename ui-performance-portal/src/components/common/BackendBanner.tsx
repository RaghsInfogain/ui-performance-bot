import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { checkBackendHealth } from '../../services/api';

export function BackendBanner() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    checkBackendHealth().then(setOk);
    const t = setInterval(() => checkBackendHealth().then(setOk), 10000);
    return () => clearInterval(t);
  }, []);

  if (ok === null) return null;

  if (ok) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> API connected
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <strong>API server not running.</strong> Crawl and test execution will not work.
        <br />
        In a terminal run:{' '}
        <code className="rounded bg-red-100 px-1">cd ui-performance-portal && npm run server</code>
        <br />
        Then keep it running and refresh this page.
      </div>
    </div>
  );
}
