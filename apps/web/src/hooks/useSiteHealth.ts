import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Site, SiteHealth } from '../api/client';
import { notify } from '../lib/notify';
import { useSession } from './useSession';

/** The server re-checks at most hourly; asking every 5 minutes keeps an open tab close to it. */
const HEALTH_EVERY_MS = 5 * 60_000;

/**
 * Is the site still sending data (decision 28)? Loads when the dashboard opens and every few minutes while
 * the tab is visible; "Check again" asks the server to open the site now. The sidebar dot follows along.
 */
export function useSiteHealth(site: Site) {
  const { upsert } = useSession();
  const [health, setHealth] = useState<SiteHealth | null>(null);
  const [checking, setChecking] = useState(false);
  // The latest copy of the site: an answer that arrives later must not write an older copy back.
  const latest = useRef(site);
  latest.current = site;

  const show = useCallback(
    (h: SiteHealth) => {
      setHealth(h);
      const s = latest.current;
      if (s.health !== h.status) upsert({ ...s, health: h.status });
    },
    [upsert],
  );

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setHealth(null);
    const tick = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        try {
          const { health } = await api.health(site.id);
          if (live) show(health);
        } catch {
          // The banner is a hint: a failed load keeps the last state (the dashboard shows its own errors).
        }
      }
      if (live) timer = setTimeout(tick, HEALTH_EVERY_MS);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      const { health } = await api.checkHealth(site.id);
      show(health);
      if (health.status === 'broken') notify.warning('Still not working', { description: health.reason ?? undefined });
      else if (health.status === 'quiet') notify.success('The script is installed correctly', { description: 'Visits are counted as soon as someone opens the site.' });
      else notify.success('Data is arriving');
    } catch (e) {
      notify.error(e, 'Could not check right now. Try again in a minute.');
    } finally {
      setChecking(false);
    }
  }, [site.id, show]);

  /** The site changed under it (a new domain): the old result no longer applies. */
  const clear = useCallback(() => setHealth(null), []);

  return { health, checking, checkAgain, clear };
}
