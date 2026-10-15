import { MailCheck } from 'lucide-react';
import Button from '../ui/Button';
import FormError from '../ui/FormError';
import Notice from '../ui/Notice';
import PageHeader from '../ui/PageHeader';
import TextLink from '../ui/TextLink';
import { muted } from '../ui/styles';
import type { PendingVerification } from '../../hooks/useAuthForms';

/** After sign-up (decision 27): the account exists but logs in only after the e-mailed link is opened. */
export default function CheckInbox({
  pending,
  onResend,
  resending,
  resendError,
}: {
  pending: PendingVerification;
  onResend: () => void;
  resending: boolean;
  resendError: string | null;
}) {
  return (
    <div data-testid="verify-sent">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/20">
        <MailCheck className="size-6" aria-hidden="true" />
      </span>
      <PageHeader
        compact
        title="Confirm your e-mail"
        description={
          <>
            We sent a link to <b className="text-slate-700 dark:text-slate-200">{pending.email}</b>. Open it to finish creating your account; it works for {pending.hours}{' '}
            hours. You can log in once it is confirmed.
          </>
        }
      />
      {!pending.sent && (
        <Notice tone="warning" className="mb-4">
          The e-mail could not be sent just now. Use "Send it again" in a minute.
        </Notice>
      )}
      <ul className={`grid list-disc gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-3.5 pr-4 pl-8 text-sm dark:border-slate-800 dark:bg-slate-800/40 ${muted}`}>
        <li>No e-mail after a few minutes? Look in Spam or Promotions.</li>
        <li>Wrong address? Sign up again with the right one.</li>
      </ul>
      <FormError message={resendError} />
      <Button variant="secondary" className="mt-5 w-full" onClick={onResend} loading={resending}>
        Send it again
      </Button>
      <p className={`mt-6 text-center text-sm ${muted}`}>
        Already confirmed? <TextLink to="/login">Log in</TextLink>
      </p>
    </div>
  );
}
