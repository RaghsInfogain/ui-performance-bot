import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BackendBanner } from '../common/BackendBanner';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex min-w-0 max-w-full flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="page-content min-w-0 w-full max-w-none px-3 py-4 sm:px-4 lg:px-4">
          <BackendBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
