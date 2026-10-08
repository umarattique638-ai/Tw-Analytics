interface Props { checked: boolean; onChange: (v: boolean) => void; label: string }

export default function Toggle({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/30 ${
        checked ? 'bg-teal-700 dark:bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'
      }`}
    >
      <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}