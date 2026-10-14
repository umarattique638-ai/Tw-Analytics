import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import Select from '../components/ui/Select';
import { muted } from '../components/ui/styles';
import { useAddSite } from '../hooks/useSetup';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

/** Setup step 1: the domain and its timezone. */
export default function AddSitePage() {
  useDocumentTitle('Add your site');
  const navigate = useNavigate();
  const { setSetup } = useSession();
  const form = useAddSite((setup) => {
    setSetup(setup);
    navigate('/install');
  });

  return (
    <>
      <PageHeader compact title="Add your site" description="Enter your domain. Nothing changes on your DNS or hosting, and nothing is saved until your install is verified." />
      <form
        className="grid w-full gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          form.submit();
        }}
      >
        <Field
          label="Domain"
          name="domain"
          placeholder="example.com"
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          value={form.domain}
          onChange={(e) => form.setDomain(e.target.value)}
          required
          autoFocus
        />

        <Select
          label="Timezone"
          name="timezone"
          value={form.timezone}
          onChange={form.setTimezone}
          options={form.zones.list}
          hint="Daily reports split at midnight in this timezone. Type to search, e.g. karachi."
        />

        <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Hosts we'll accept</p>
          <div className="mt-2 flex flex-wrap gap-2" aria-live="polite">
            {form.hosts ? (
              form.hosts.map((h) => (
                <span key={h} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  {h}
                </span>
              ))
            ) : (
              <span className={`text-[13px] ${muted}`}>Your domain and all its subdomains, www included.</span>
            )}
          </div>
        </div>

        <FormError message={form.error} />
        <Button type="submit" className="w-full" loading={form.busy}>
          Add site
        </Button>
      </form>
    </>
  );
}
