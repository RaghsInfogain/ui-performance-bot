import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Settings, Globe, FileText, Play,
  History, BarChart3, Zap, Clapperboard, LogOut,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const STORAGE_KEY = 'uipb.sidebar.collapsed';

const navItems = [
  { to: '/app', icon: LayoutDashboard, label: 'Dashboard', desc: 'Overview & quick actions', end: true },
  { to: '/app/crawler', icon: Globe, label: 'Website Crawler', desc: 'Discover URLs' },
  { to: '/app/configuration', icon: Settings, label: 'Configuration', desc: 'Browser, duration, flags' },
  { to: '/app/test-cases', icon: FileText, label: 'Test Cases', desc: 'Static & scripted suites' },
  { to: '/app/script-studio', icon: Clapperboard, label: 'Script Studio', desc: 'Build & record flows' },
  { to: '/app/run-test', icon: Play, label: 'Run Test', desc: 'Start execution' },
  { to: '/app/runs', icon: History, label: 'Run History', desc: 'Monitor & manage runs' },
  { to: '/app/reports', icon: BarChart3, label: 'Reports & Analytics', desc: 'Results & CSV export' },
];

export function Sidebar() {
  const { user, initials, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-[4.25rem]' : 'w-64'
      }`}
    >
      <div
        className={`flex border-b border-slate-100 ${
          collapsed ? 'flex-col items-center gap-2 px-2 py-3' : 'items-center gap-2 px-3 py-4'
        }`}
      >
        <Link to="/app" className={`flex min-w-0 items-center ${collapsed ? '' : 'gap-3 flex-1'}`} title="UI Perf Bot">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f6e56] text-white">
            <Zap className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="font-display text-base font-bold text-slate-900">UI Perf Bot</h1>
              <p className="text-xs text-slate-500">Performance Testing</p>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className={`flex-1 space-y-1 overflow-y-auto ${collapsed ? 'p-2' : 'p-3'}`}>
        {navItems.map(({ to, icon: Icon, label, desc, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `group flex rounded-lg transition ${
                collapsed
                  ? `items-center justify-center px-2 py-2.5 ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  : `items-start gap-3 px-3 py-2.5 ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
              }`
            }
          >
            <Icon className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mt-0.5'}`} />
            {!collapsed && (
              <div>
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs text-slate-400 group-hover:text-slate-500">{desc}</div>
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={`border-t border-slate-100 ${collapsed ? 'p-2' : 'p-4'}`}>
        {!collapsed && (
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{user?.name}</div>
              <div className="truncate text-xs text-slate-500">{user?.company || user?.email}</div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => logout()}
          title="Sign out"
          className={`flex items-center rounded-lg text-sm text-slate-600 transition hover:bg-slate-50 ${
            collapsed ? 'w-full justify-center px-2 py-2' : 'w-full gap-2 px-2 py-2'
          }`}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
