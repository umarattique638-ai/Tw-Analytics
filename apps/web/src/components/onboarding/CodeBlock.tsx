import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../../hooks/useClipboard';

/**
 * Code to paste, with its own copy button in the header. The <pre> holds the code and nothing else
 * (tests and screen readers read it as is).
 */
export default function CodeBlock({ code, label = 'HTML', copyLabel = 'Copy', copyTestId }: { code: string; label?: string; copyLabel?: string; copyTestId?: string }) {
  const { copied, copy } = useClipboard();
  return (
    <div className="overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-900 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 py-1.5 pr-1.5 pl-4">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <button
          type="button"
          onClick={() => copy(code)}
          data-testid={copyTestId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
        >
          {copied ? <Check className="size-3.5 text-teal-300" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? 'Copied!' : copyLabel}</span>
        </button>
      </div>
      <pre data-testid="snippet" className="overflow-x-auto p-4 font-mono text-[13.5px] leading-relaxed whitespace-pre-wrap text-teal-100 [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
