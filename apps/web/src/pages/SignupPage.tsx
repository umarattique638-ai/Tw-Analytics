import { useNavigate } from 'react-router-dom';
import CheckInbox from '../components/auth/CheckInbox';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import TextLink from '../components/ui/TextLink';
import { muted } from '../components/ui/styles';
import { useSignupForm } from '../hooks/useAuthForms';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function SignupPage() {
  useDocumentTitle('Create your account');
  const navigate = useNavigate();
  const form = useSignupForm(() => navigate('/sites/new'));

  if (form.pending) return <CheckInbox pending={form.pending} onResend={() => form.resend()} resending={form.resending} resendError={form.resendError} />;

  return (
    <>
      <PageHeader compact title="Create your account" description="Start measuring real visitors in a few minutes." />

      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.submit();
        }}
      >
        <Field label="Full name" name="name" autoComplete="name" placeholder="Your name" maxLength={120} value={form.name} onChange={(e) => form.setName(e.target.value)} required />
        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={form.email} onChange={(e) => form.setEmail(e.target.value)} required />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={form.min}
          placeholder="Create a password"
          hint={`Use at least ${form.min} characters.`}
          value={form.password}
          onChange={(e) => form.setPassword(e.target.value)}
          required
        />
        <div className="grid gap-1.5">
          <Field
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={form.min}
            placeholder="Type it again"
            value={form.confirm}
            onChange={(e) => form.setConfirm(e.target.value)}
            aria-invalid={form.mismatch}
            required
          />
          {form.mismatch && (
            <p role="alert" className="text-[13px] font-medium text-red-600 dark:text-red-400">
              The two passwords are not the same.
            </p>
          )}
        </div>

        <FormError message={form.error} />
        <Button type="submit" className="mt-1 w-full" loading={form.busy}>
          Create account
        </Button>
      </form>

      <p className={`mt-6 border-t border-slate-200 pt-6 text-center text-sm dark:border-slate-800 ${muted}`}>
        Already have an account? <TextLink to="/login">Log in</TextLink>
      </p>
    </>
  );
}
