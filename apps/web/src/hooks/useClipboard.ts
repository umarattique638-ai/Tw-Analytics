import { useCallback, useEffect, useRef, useState } from 'react';

/** Copy text to the clipboard; `copied` is true for `resetMs` afterwards. A blocked clipboard fails quietly. */
export function useClipboard(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
        return true;
      } catch {
        return false; // the code stays selectable on the page
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
