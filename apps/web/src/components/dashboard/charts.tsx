import type { LucideIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Row } from '../../data/dashboardMock';

const tick = { fontSize: 11, fill: '#94a3b8' };
const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.25)',
  fontSize: 12,
  boxShadow: '0 8px 24px -8px rgba(15,23,42,0.2)',
};

/* ---------- Visitors over time ---------- */
export function VisitorsChart({ data }: { data: { date: string; visitors: number; sessions: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="gVisitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSessions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
          <XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="visitors" name="Visitors" stroke="#14b8a6" strokeWidth={2} fill="url(#gVisitors)" />
          <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 3" fill="url(#gSessions)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Traffic sources donut ---------- */
const SOURCE_COLORS = ['#14b8a6', '#8b5cf6', '#f59e0b', '#3b82f6', '#94a3b8'];

export function SourcesDonut({ sources, total }: { sources: { name: string; value: number }[]; total: number }) {
  return (
    <div>
      <div className="relative mx-auto size-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sources} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none">
              {sources.map((_, i) => <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{total.toLocaleString()}</span>
          <span className="text-[10px] text-slate-400">Unique visitors</span>
        </div>
      </div>
      <ul className="mt-5 grid gap-2">
        {sources.map((s, i) => (
          <li key={s.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="size-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
              {s.name}
            </span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{s.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Live sessions ---------- */
export function LiveChart({ data }: { data: { time: string; count: number }[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="gLive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
          <XAxis dataKey="time" tick={{ ...tick, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="count" name="Active sessions" stroke="#10b981" strokeWidth={2} fill="url(#gLive)" animationDuration={300} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Generic bar list (devices, pages, locations, browsers) ---------- */
export function BarList({ rows, icon: Icon, empty = 'No data yet.' }: { rows: Row[]; icon?: LucideIcon; empty?: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="grid gap-3.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200">
              {Icon && <Icon className="size-4 flex-none text-slate-400" />}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="flex-none tabular-nums text-slate-500 dark:text-slate-400">
              {r.value.toLocaleString()} <span className="ml-1 text-xs text-slate-400">{r.pct}%</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400" style={{ width: `${Math.max(r.pct, 3)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}