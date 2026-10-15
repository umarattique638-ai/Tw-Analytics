import { ArrowLeft, MailCheck } from 'lucide-react';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import TextLink from '../components/ui/TextLink';
import { muted } from '../components/ui/styles';
import { useForgotPassword } from '../hooks/useAuthForms';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const BackToLogin = () => (
  <p className="mt-6 text-center text-sm">
    <TextLink to="/login" className="inline-flex items-center gap-1.5">
      <ArrowLeft className="size-4" aria-hidden="true" /> Back to log in
    </TextLink>
  </p>
);

/** Step 1 of a password reset: ask for the e-mail (one without an account is refused), then "check your inbox". */
export default function ForgotPasswordPage() {
  useDocumentTitle('Reset your password');
  const f = useForgotPassword();

  if (f.sent) {
    return (
      <div data-testid="reset-sent">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/20">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <PageHeader
          compact
          title="Check your inbox"
          description={
            <>
              We sent a link to <b className="text-slate-700 dark:text-slate-200">{f.sent.to}</b> to choose a new password. It works for {f.sent.minutes} minutes.
            </>
          }
        />
        <ul className={`grid list-disc gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-3.5 pr-4 pl-8 text-sm dark:border-slate-800 dark:bg-slate-800/40 ${muted}`}>
          <li>No e-mail after a few minutes? Look in Spam or Promotions.</li>
        </ul>
        <Button variant="secondary" className="mt-5 w-full" onClick={f.again}>
          Use a different e-mail
        </Button>
        <BackToLogin />
      </div>
    );
  }

  return (
    <>
      <PageHeader compact title="Forgot your password?" description="Enter the e-mail you signed up with and we will send you a link to choose a new one." />
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          f.submit();
        }}
      >
        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={f.email} onChange={(e) => f.setEmail(e.target.value)} required autoFocus />
        <FormError message={f.error} />
        <Button type="submit" className="mt-1 w-full" loading={f.busy}>
          Send reset link
        </Button>
      </form>
      <BackToLogin />
    </>
  );
}
