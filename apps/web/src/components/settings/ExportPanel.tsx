import { CheckCircle2, Download, FileJson } from 'lucide-react';
import Button from '../ui/Button';
import FormError from '../ui/FormError';
import Panel from '../ui/Panel';
import { useAccountExport } from '../../hooks/useAccount';

/** "Download all data": everything stored for the account, as one JSON file. */
export default function ExportPanel() {
  const { download, busy, done, error } = useAccountExport();
  return (
    <Panel title="Download your data" subtitle="Everything we store for your account, in one file">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">
            <FileJson className="size-5" aria-hidden="true" />
          </span>
          <p className="max-w-[75ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Your account, every site and its settings, visitors, sessions and page views for every stored day, all pages and events, blocked traffic, saved reports and the
            activity log. A JSON file that opens in any editor and can be read by other tools.
          </p>
        </div>
        <Button className="flex-none" onClick={() => download()} loading={busy} data-testid="export-account">
          {!busy && <Download className="size-4" aria-hidden="true" />}
          {busy ? 'Preparing…' : 'Download all data'}
        </Button>
      </div>
      {done && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" aria-hidden="true" /> Downloaded. Keep the file somewhere safe.
        </p>
      )}
      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}
    </Panel>
  );
}
