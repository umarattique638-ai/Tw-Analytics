import type { DayPoint } from '../../types';

const W = 680, H = 210, L = 44, B = 28, T = 10;
const label = 'fill-slate-500 text-[11px] dark:fill-slate-400';

export default function TrafficChart({ data }: { data: DayPoint[] }) {
  const max = Math.ceil(Math.max(...data.map((p) => p.views)) / 500) * 500;
  const x = (i: number) => L + (i * (W - L - 8)) / (data.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (k: 'views' | 'visitors') => data.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pageviews and visitors over time" className="h-auto w-full">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - 8} y1={y(max * f)} y2={y(max * f)} strokeDasharray="3 4" className="stroke-slate-200 dark:stroke-slate-800" />
          <text x={L - 8} y={y(max * f) + 4} textAnchor="end" className={label}>{(max * f).toLocaleString()}</text>
        </g>
      ))}
      {data.map((p, i) => <text key={p.day} x={x(i)} y={H - 8} textAnchor="middle" className={label}>{p.day.slice(4)}</text>)}
      <path d={`${path('views')}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} className="fill-teal-100 dark:fill-teal-950" />
      <path d={path('views')} className="fill-none stroke-teal-700 stroke-[2.5] dark:stroke-teal-400" />
      <path d={path('visitors')} strokeDasharray="5 4" className="fill-none stroke-slate-500 stroke-2" />
    </svg>
  );
}
