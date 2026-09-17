interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'blue' | 'green' | 'amber' | 'red';
}

const accents = {
  blue: 'border-l-brand-500',
  green: 'border-l-emerald-500',
  amber: 'border-l-amber-500',
  red: 'border-l-red-500',
};

export function StatCard({ label, value, sub, accent = 'blue' }: StatCardProps) {
  return (
    <div className={`card border-l-4 ${accents[accent]}`}>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
