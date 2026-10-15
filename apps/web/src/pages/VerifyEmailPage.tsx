import { CheckCircle2, MailWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import LinkButton from '../components/ui/LinkButton';
import PageHeader from '../components/ui/PageHeader';
import Spinner from '../components/ui/Spinner';
import { useVerifyEmail } from '../hooks/useAuthForms';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** The link from the sign-up e-mail: confirms the address, signs in, then on to adding the first site. */
export default function VerifyEmailPage() {
  useDocumentTitle('Confirm your e-mail');
  const navigate = useNavigate();
  const v = useVerifyEmail(() => navigate('/dashboard', { replace: true }));

  if (v.state === 'checking') {
    return (
      <div className="grid justify-items-center gap-4 py-8 text-center" role="status">
        <Spinner />
        <p className="text-sm text-slate-600 dark:text-slate-400">Confirming your e-mail…</p>
      </div>
    );
  }

  if (v.state === 'done') {
    return (
      <div data-testid="email-verified">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>
        <PageHeader compact title="E-mail confirmed" description="Your account is ready and you are logged in. Taking you to your dashboard…" />
      </div>
    );
  }

  return (
    <div data-testid="email-verify-invalid">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20">
        <MailWarning className="size-6" aria-hidden="true" />
      </span>
      <PageHeader
        compact
        title="This link does not work any more"
        description={v.message ?? 'It has expired or was already used. Log in with your e-mail and password, then use "Send it again" to get a new link.'}
      />
      <LinkButton to="/login" className="w-full">
        Go to log in
      </LinkButton>
    </div>
  );
}
