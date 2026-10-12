import SegmentedControl from '../ui/SegmentedControl';
import type { RangeKey } from '../../api/client';

export const RANGES: { value: RangeKey; label: string; long: string }[] = [
  { value: 'today', label: 'Today', long: 'Today' },
  { value: '7d', label: '7 days', long: 'Last 7 days' },
  { value: '30d', label: '30 days', long: 'Last 30 days' },
];
export const rangeLong = (r: RangeKey) => RANGES.find((x) => x.value === r)?.long ?? r;

/** The period of the report pages (shared by Overview, Events and Suspicious activity). Arrow keys move. */
export default function RangeSelect({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return <SegmentedControl label="Period" value={value} options={RANGES} onChange={onChange} />;
}
