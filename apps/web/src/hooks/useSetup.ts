import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Setup, Site, Snippet } from '../api/client';
import { timezoneOptions } from '../lib/timezones';
import { useAction } from './useAction';
import { useDebouncedValue } from './useDebouncedValue';
import { notify } from '../lib/notify';

/**
 * Step 1, "Add your site": the domain, the timezone, and the hosts the API will accept for that domain
 * (asked from the API while typing: the rule lives there). Submitting starts a SETUP, not a site: nothing is
 * stored until every install check passed (decision 25). A domain where nothing
 * answers is refused right here.
 */
export function useAddSite(onStarted: (setup: Setup) => void) {
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
    const { setup, resumed } = await api.startSetup(domain, timezone);
    notify.info(resumed ? `Continuing with ${setup.domain}` : `Setting up ${setup.domain}`, {
      description: 'Nothing is saved yet. Paste the script on your site and verify: it is saved once every check passes.',
    });
    onStarted(setup);
  }, 'Could not add the site.');

  return { zones, domain, setDomain, timezone, setTimezone, hosts, submit: run, busy, error };
}

/** The snippets of a saved site (the custom-event code on the Events page). */
export function useSnippets(site: Site | null) {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return {
    tag: snippets?.find((s) => s.group === 'script-tag') ?? null,
    events: snippets?.find((s) => s.group === 'custom-event') ?? null,
    loading: !snippets && !error,
    error,
  };
}
