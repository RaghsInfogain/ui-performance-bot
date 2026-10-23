export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format a millisecond value in the most readable unit:
 * < 1s → "850 ms", < 1min → "2.35 s", otherwise → "1.5 min".
 */
export function formatMs(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? String(value) : String(value).replace(/[^0-9.\-]/g, '');
  if (!numeric) return '—';
  const ms = Number(numeric);
  if (!Number.isFinite(ms)) return String(value);
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(ms)} ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
  return `${(ms / 60_000).toFixed(2).replace(/\.?0+$/, '')} min`;
}
