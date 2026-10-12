import { useEffect } from 'react';

/** Sets the browser tab title to "<title> · TailWatch" while the page is shown. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title ? `${title} · TailWatch` : 'TailWatch';
    return () => {
      document.title = before;
    };
  }, [title]);
}
