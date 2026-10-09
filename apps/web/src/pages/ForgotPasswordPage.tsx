import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';

/** Step 1 of a password reset: ask for the e-mail, then "check your inbox" (the same answer for every e-mail). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ to: string; minutes: number } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.forgot(email.trim());
      setSent({ to: email.trim(), minutes: r.minutes });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <p className={`mt-6 text-center text-sm ${muted}`}>
      <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-teal-700 hover:underline dark:text-teal-400">
        <ArrowLeft className="size-4" /> Back to log in
      </Link>
    </p>
  );

  if (sent) {
    return (
      <div data-testid="reset-sent">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/20">
          <MailCheck className="size-6" />
        </span>
        <PageHeader
          title="Check your inbox"
          sub={
            <>
              If an account exists for <b className="text-slate-700 dark:text-slate-200">{sent.to}</b>, we have sent a link to choose a new password. It
              works for {sent.minutes} minutes.
            </>
          }
        />
        <ul className={`grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/40 ${muted}`}>
          <li>• No e-mail after a few minutes? Look in Spam or Promotions.</li>
          <li>• Make sure it is the e-mail you signed up with.</li>
        </ul>
        <Button variant="ghost" className="mt-5 w-full" onClick={() => setSent(null)}>
          Use a different e-mail
        </Button>
        {back}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Forgot your password?" sub="Enter the e-mail you signed up with and we will send you a link to choose a new one." />
      <form className="grid gap-5" onSubmit={onSubmit}>
        <Field
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <FormError message={error} />
        <Button type="submit" className="mt-1 w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
      {back}
    </>
  );
}
