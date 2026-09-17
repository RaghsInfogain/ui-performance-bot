import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { WaterfallStep } from '../../utils/reportDesign';
import { WATERFALL_COLORS } from '../../utils/reportDesign';

interface Props {
  steps: WaterfallStep[];
  height?: number;
  estimated?: boolean;
}

export function WaterfallChart({ steps, height = 220, estimated }: Props) {
  const data = steps.map((s) => ({
    name: s.label,
    offset: s.start,
    duration: s.duration,
    formula: s.formula,
    purpose: s.purpose,
  }));

  if (!data.length) {
    return <p style={{ fontSize: 13, color: '#5B5D63' }}>No navigation timing data available for this page.</p>;
  }

  return (
    <>
      {estimated && (
        <p style={{ fontSize: 12, color: '#854F0B', marginBottom: 8 }}>
          Estimated from CSV — re-run tests to capture full Navigation Timing milestones (NavTiming*.json).
        </p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#5B5D63' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}ms`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={96}
            tick={{ fontSize: 11.5, fill: '#1B1C1E' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]?.payload;
              if (!p) return null;
              return (
                <div style={{ background: '#fff', border: '1px solid #E2E0D8', padding: '10px 12px', fontSize: 12, maxWidth: 280 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}: {p.duration}ms</div>
                  {p.formula && <div style={{ fontFamily: 'monospace', color: '#0C447C', marginBottom: 4 }}>{p.formula}</div>}
                  {p.purpose && <div style={{ color: '#5B5D63' }}>{p.purpose}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="offset" stackId="wf" fill="rgba(0,0,0,0)" />
          <Bar dataKey="duration" stackId="wf" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={WATERFALL_COLORS[i % WATERFALL_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
