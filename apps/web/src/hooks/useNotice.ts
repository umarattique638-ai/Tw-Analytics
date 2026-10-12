import { useCallback, useEffect, useState } from 'react';

export type NoticeTone = 'success' | 'error' | 'info' | 'warning';
export interface NoticeState {
  tone: NoticeTone;
  text: string;
}

/** A short message after an action ("Report deleted."). Success and info messages fade after `hideMs`; errors stay. */
export function useNotice(hideMs = 6000) {
  const [notice, setNotice] = useState<NoticeState | null>(null);

  useEffect(() => {
    if (!notice || notice.tone === 'error' || notice.tone === 'warning') return;
    const t = setTimeout(() => setNotice(null), hideMs);
    return () => clearTimeout(t);
  }, [notice, hideMs]);

  const show = useCallback((tone: NoticeTone, text: string) => setNotice({ tone, text }), []);
  const clear = useCallback(() => setNotice(null), []);
  return { notice, show, clear };
}
