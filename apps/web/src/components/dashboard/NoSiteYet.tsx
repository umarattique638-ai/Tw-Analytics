import { Globe } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import LinkButton from '../ui/LinkButton';

/** For report pages opened before any site exists. */
export default function NoSiteYet() {
  return (
    <div className="my-auto rounded-2xl border border-dashed border-slate-300 bg-white/60 dark:border-slate-700 dark:bg-slate-900/40">
      <EmptyState icon={Globe} title="No site yet" action={<LinkButton to="/sites/new">Add your site</LinkButton>}>
        Add a site and install the script: this page fills in with its first visits.
      </EmptyState>
    </div>
  );
}
