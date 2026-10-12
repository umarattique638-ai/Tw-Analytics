import DeleteAccountPanel from '../components/settings/DeleteAccountPanel';
import ExportPanel from '../components/settings/ExportPanel';
import RetentionPanel from '../components/settings/RetentionPanel';
import PageHeader from '../components/ui/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const { sites, role, retention, upsert, user } = useSession();

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description={`Signed in as ${user.email}`} />
      <RetentionPanel sites={sites} choices={retention.choices} canEdit={role !== 'viewer'} onSaved={upsert} />
      <ExportPanel />
      {role === 'owner' && <DeleteAccountPanel siteCount={sites.length} />}
    </div>
  );
}
