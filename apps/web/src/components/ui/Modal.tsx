import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type Props = {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** While true (a request is running) the dialog cannot be dismissed. */
  locked?: boolean;
};

/**
 * Accessible dialog: labelled by its title, focus moves inside on open, Tab stays inside, Escape and a
 * click on the backdrop close it (unless locked), and focus returns to where it was when it closes.
 */
export default function Modal({ title, children, footer, onClose, locked }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (!locked) onClose();
  }, [locked, onClose]);
  useEscapeKey(close);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus], button, input, a[href]');
    first?.focus();
    return () => before?.focus?.();
  }, []);

  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (!items.length) return;
    const [first, last] = [items[0]!, items[items.length - 1]!];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center p-4">
      <div className="absolute inset-0 animate-[tw-fade_150ms_ease-out] bg-slate-950/60 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={trap}
        className="relative w-full max-w-md animate-[tw-pop_160ms_ease-out] rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:ring-1 dark:ring-white/10"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {children}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}
