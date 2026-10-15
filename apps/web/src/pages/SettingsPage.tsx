import DeleteAccountPanel from '../components/settings/DeleteAccountPanel';
import DomainPanel from '../components/settings/DomainPanel';
import ExportPanel from '../components/settings/ExportPanel';
import RetentionPanel from '../components/settings/RetentionPanel';
import PageHeader from '../components/ui/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const { sites, allSites, role, retention, upsert, user } = useSession();

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description={`Signed in as ${user.email}`} />
      <DomainPanel sites={sites} canEdit={role === 'owner' || role === 'admin'} onSaved={upsert} />
      <RetentionPanel sites={sites} choices={retention.choices} canEdit={role !== 'viewer'} onSaved={upsert} />
      <ExportPanel />
      {role === 'owner' && <DeleteAccountPanel siteCount={allSites.length} />}
    </div>
  );
}
