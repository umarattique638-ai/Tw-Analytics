import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Calls `onOutside` for a pointer press anywhere outside `ref` (menus, popovers). Off while `enabled` is false. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [ref, onOutside, enabled]);
}
