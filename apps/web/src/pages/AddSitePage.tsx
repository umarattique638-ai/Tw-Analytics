import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import Select from '../components/ui/Select';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';
import { useSession } from '../api/session';
import { timezoneOptions } from '../lib/timezones';

export default function AddSitePage() {
  const navigate = useNavigate();
  const { upsert, select } = useSession();
  const zones = useMemo(timezoneOptions, []);
  const [domain, setDomain] = useState('');
  const [timezone, setTimezone] = useState(zones.local);
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The accepted hosts come from the API (the rule lives there), shown as the user types.
  useEffect(() => {
    if (!domain.trim()) return setHosts(null);
    const t = setTimeout(() => {
      api.preview(domain).then((p) => setHosts(p.allowedHosts), () => setHosts(null));
    }, 300);
    return () => clearTimeout(t);
  }, [domain]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { site, sync } = await api.addSite(domain, timezone);
      upsert(site);
      select(site.id);
      navigate('/install', { state: { sync } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the site.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Add your site" sub="Enter your domain. We don't touch DNS." />
      <form className="grid w-full gap-5" onSubmit={onSubmit}>
        <Field label="Domain" name="domain" placeholder="example.com" spellCheck={false} autoCapitalize="none" value={domain} onChange={(e) => setDomain(e.target.value)} required />

        <Select
          label="Timezone"
          name="timezone"
          value={timezone}
          onChange={setTimezone}
          options={zones.list}
          hint="Daily reports split at midnight in this timezone. Type to search, e.g. karachi."
        />

        <div>
          <b className="text-sm">Hosts we'll accept</b>
          <div className="mt-2 flex flex-wrap gap-2">
            {hosts ? (
              hosts.map((h) => (
                <span key={h} className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[13px] dark:border-slate-700 dark:bg-slate-950">{h}</span>
              ))
            ) : (
              <span className={`text-[13px] ${muted}`}>Your domain and all its subdomains, www included.</span>
            )}
          </div>
        </div>

        <FormError message={error} />
        <Button type="submit" className="w-full" loading={busy}>Add site</Button>
      </form>
    </>
  );
}
