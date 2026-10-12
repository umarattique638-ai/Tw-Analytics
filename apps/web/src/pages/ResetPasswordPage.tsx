import { useNavigate } from 'react-router-dom';
import { Check, CircleCheck, CircleX, KeyRound } from 'lucide-react';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import LinkButton from '../components/ui/LinkButton';
import PageHeader from '../components/ui/PageHeader';
import Spinner from '../components/ui/Spinner';
import TextLink from '../components/ui/TextLink';
import { muted } from '../components/ui/styles';
import { useResetPassword } from '../hooks/useAuthForms';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-2 transition-colors ${ok ? 'text-emerald-700 dark:text-emerald-300' : muted}`}>
      <span className={`grid size-4 place-items-center rounded-full ${ok ? 'bg-emerald-600 text-white' : 'border border-slate-300 dark:border-slate-600'}`}>
        {ok && <Check className="size-2.5" strokeWidth={4} aria-hidden="true" />}
      </span>
      {children}
    </li>
  );
}

/** Step 2 of a password reset: the link from the e-mail lands here with ?token=. */
export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const navigate = useNavigate();
  const r = useResetPassword(() => navigate('/dashboard', { replace: true }));

  if (r.valid === null) {
    return (
      <div className="grid place-items-center py-10 text-teal-600">
        <Spinner className="size-6" label="Checking the link" />
      </div>
    );
  }

  if (r.done) {
    return (
      <div className="grid justify-items-center py-4 text-center" data-testid="reset-done">
        <span className="mb-5 grid size-14 animate-[tw-check_400ms_ease-out] place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30">
          <CircleCheck className="size-7" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Password changed</h1>
        <p className={`mt-2 text-[15px] ${muted}`} role="status">
          You are signed in. Every other device was signed out. Taking you to your dashboard…
        </p>
      </div>
    );
  }

  if (!r.valid) {
    return (
      <div data-testid="reset-invalid">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20">
          <CircleX className="size-6" aria-hidden="true" />
        </span>
        <PageHeader compact title="This link no longer works" description="Reset links work once, for a limited time. Ask for a new one and use the newest e-mail." />
        <LinkButton to="/forgot-password" className="w-full">
          Send a new link
        </LinkButton>
        <p className="mt-6 text-center text-sm">
          <TextLink to="/login">Back to log in</TextLink>
        </p>
      </div>
    );
  }

  return (
    <>
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/20">
        <KeyRound className="size-6" aria-hidden="true" />
      </span>
      <PageHeader compact title="Choose a new password" description="After this you are signed in here, and signed out everywhere else." />
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          r.submit();
        }}
      >
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          placeholder={`At least ${r.min} characters`}
          value={r.password}
          onChange={(e) => r.setPassword(e.target.value)}
          required
          autoFocus
        />
        <Field
          label="Repeat new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={r.confirm}
          onChange={(e) => r.setConfirm(e.target.value)}
          aria-invalid={r.confirm.length > 0 && !r.same}
          required
        />
        <ul className="grid gap-1.5 text-[13px]">
          <Rule ok={r.long}>{`At least ${r.min} characters`}</Rule>
          <Rule ok={r.same}>Both passwords match</Rule>
        </ul>
        <FormError message={r.error} />
        <Button type="submit" className="mt-1 w-full" loading={r.busy}>
          Save new password
        </Button>
      </form>
    </>
  );
}
