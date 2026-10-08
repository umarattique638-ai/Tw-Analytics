import type { Row } from '../../types';
import Card from '../ui/Card';
import { muted } from '../ui/styles';

interface Props { title: string; head: string; rows: Row[] }

export default function DataTable({ title, head, rows }: Props) {
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <Card title={title}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={`text-xs ${muted}`}>
            <th className="pb-2 text-left font-semibold">{head}</th>
            <th className="w-20 pb-2 text-right font-semibold">Visitors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="relative h-[34px] p-0">
                <span className="absolute inset-y-1 left-0 rounded bg-teal-100 dark:bg-teal-950" style={{ width: `${(r.value / max) * 100}%` }} />
                <span className="relative pl-2 font-mono text-[13px]">{r.label}</span>
              </td>
              <td className="w-20 p-0 text-right font-semibold">{r.value.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
