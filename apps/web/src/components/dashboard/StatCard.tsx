import { muted } from '../ui/styles';

interface Props { label: string; value: string; delta: string; up?: boolean }

export default function StatCard({ label, value, delta, up = true }: Props) {
  const tone = up ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`text-[13px] font-semibold ${muted}`}>{label}</span>
      <b className="block text-[26px] font-extrabold">{value}</b>
      <small className={`text-xs font-semibold ${tone}`}>{delta}</small>
    </div>
  );
}
