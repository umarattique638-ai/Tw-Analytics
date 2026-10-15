/** One bar of a breakdown: value and its share of the total (0-100). */
export type Row = { label: string; value: number; pct: number; /** The raw value to filter by (decision 30); none = not clickable. */ key?: string };
