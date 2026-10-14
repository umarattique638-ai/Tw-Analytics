import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Site, Snippet, Sync } from '../api/client';
import { timezoneOptions } from '../lib/timezones';
import { useAction } from './useAction';
import { useDebouncedValue } from './useDebouncedValue';
import { notify } from '../lib/notify';

/**
 * Step 1, "Add your site": the domain, the timezone, and the hosts the API will accept for that domain
 * (asked from the API while typing: the rule lives there).
 */
export function useAddSite(onAdded: (site: Site, sync: Sync) => void) {
  const zones = useMemo(timezoneOptions, []);
  const [domain, setDomain] = useState('');
  const [timezone, setTimezone] = useState(zones.local);
  const [hosts, setHosts] = useState<string[] | null>(null);
  const typed = useDebouncedValue(domain.trim(), 300);

  useEffect(() => {
    if (!typed) return setHosts(null);
    let live = true;
    api.preview(typed).then(
      (p) => live && setHosts(p.allowedHosts),
      () => live && setHosts(null),
    );
    return () => {
      live = false;
    };
  }, [typed]);

  const { run, busy, error } = useAction(async () => {
    const { site, sync } = await api.addSite(domain, timezone);
    notify.info(`Setting up ${site.domain}`, { description: 'Paste the script on your site, then verify. It joins your dashboard once every check passes.' });
    onAdded(site, sync);
  }, 'Could not add the site.');

  return { zones, domain, setDomain, timezone, setTimezone, hosts, submit: run, busy, error };
}

/** Step 2, "Install": the snippets the API generated for this site's key, and "retry activation". */
export function useSnippets(site: Site | null, initialSync?: Sync) {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<Sync | undefined>(initialSync);
  const siteId = site?.id;

  useEffect(() => {
    if (!siteId) return;
    let live = true;
    setSnippets(null);
    api.site(siteId).then(
      (r) => live && setSnippets(r.snippets),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [siteId]);

  const retryActivation = useCallback(async () => {
    if (!siteId) return;
    try {
      setSync((await api.sync(siteId)).sync);
    } catch (e) {
      setSync({ ok: false, message: e instanceof Error ? e.message : 'Retry failed.' });
    }
  }, [siteId]);

  return {
    tag: snippets?.find((s) => s.group === 'script-tag') ?? null,
    events: snippets?.find((s) => s.group === 'custom-event') ?? null,
    loading: !snippets && !error,
    error,
    sync,
    retryActivation,
  };
}
