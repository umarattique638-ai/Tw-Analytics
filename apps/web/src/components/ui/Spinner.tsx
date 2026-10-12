/** A small spinning ring that inherits the text colour. */
export default function Spinner({ className = 'size-4', label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block flex-none animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
