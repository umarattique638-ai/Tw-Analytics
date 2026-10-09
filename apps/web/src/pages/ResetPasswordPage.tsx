import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleCheck, CircleX, KeyRound } from 'lucide-react';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';

const MIN = 8;

/** Step 2 of a password reset: the link from the e-mail lands here with ?token=. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api
      .resetValid(token)
      .then((r) => live && setValid(r.valid))
      .catch(() => live && setValid(true)); // cannot tell: let the submit give the real answer
    return () => {
      live = false;
    };
  }, [token]);

  // After a successful reset the browser is already signed in: on to the dashboard.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate('/dashboard', { replace: true }), 1800);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const long = password.length >= MIN;
  const same = confirm.length > 0 && confirm === password;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!long) return setError(`Use at least ${MIN} characters.`);
    if (!same) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      if (err instanceof Error && /expired|already used/i.test(err.message)) setValid(false);
    } finally {
      setBusy(false);
    }
  };

  if (valid === null) {
    return (
      <div className="grid place-items-center py-10">
        <span className="size-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" aria-label="Checking the link" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid justify-items-center py-4 text-center" data-testid="reset-done">
        <span className="mb-5 grid size-14 animate-[tw-check_400ms_ease-out] place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30">
          <CircleCheck className="size-7" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Password changed</h1>
        <p className={`mt-2 text-[15px] ${muted}`}>You are signed in. Every other device was signed out. Taking you to your dashboard…</p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div data-testid="reset-invalid">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20">
          <CircleX className="size-6" />
        </span>
        <PageHeader title="This link no longer works" sub="Reset links work once, for 60 minutes. Ask for a new one and use the newest e-mail." />
        <Link
          to="/forgot-password"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-700 px-5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
        >
          Send a new link
        </Link>
        <p className={`mt-6 text-center text-sm ${muted}`}>
          <Link to="/login" className="font-semibold text-teal-700 hover:underline dark:text-teal-400">Back to log in</Link>
        </p>
      </div>
    );
  }

  const rule = (ok: boolean, text: string) => (
    <li className={`flex items-center gap-2 transition-colors ${ok ? 'text-emerald-700 dark:text-emerald-300' : muted}`}>
      <span className={`grid size-4 place-items-center rounded-full text-[10px] ${ok ? 'bg-emerald-600 text-white' : 'border border-slate-300 dark:border-slate-600'}`}>{ok ? '✓' : ''}</span>
      {text}
    </li>
  );

  return (
    <>
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/20">
        <KeyRound className="size-6" />
      </span>
      <PageHeader title="Choose a new password" sub="After this you are signed in here, and signed out everywhere else." />
      <form className="grid gap-5" onSubmit={onSubmit}>
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          placeholder={`At least ${MIN} characters`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
        <Field
          label="Repeat new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={confirm.length > 0 && !same}
          required
        />
        <ul className="grid gap-1.5 text-[13px]">
          {rule(long, `At least ${MIN} characters`)}
          {rule(same, 'Both passwords match')}
        </ul>
        <FormError message={error} />
        <Button type="submit" className="mt-1 w-full" loading={busy}>
          Save new password
        </Button>
      </form>
    </>
  );
}
