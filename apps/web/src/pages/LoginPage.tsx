import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';

// "Continue with Google" returns once OAuth exists. "Forgot password?" e-mails a reset link (/forgot-password).
export default function LoginPage() {
  const navigate = useNavigate();
  /** A message from the page that sent us here (account deleted). */
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Welcome back" sub="Log in to see your analytics." />
      {notice && (
        <p role="status" className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
          {notice}
        </p>
      )}

      <form className="grid gap-5" onSubmit={onSubmit}>
        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          labelRight={
            <Link to="/forgot-password" className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400">
              Forgot password?
            </Link>
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <FormError message={error} />
        <Button type="submit" className="mt-1 w-full" loading={busy}>Log in</Button>
      </form>

      <p className={`mt-6 text-center text-sm ${muted}`}>
        Don't have an account?{' '}
        <Link to="/signup" className="font-semibold text-teal-700 hover:underline dark:text-teal-400">Sign up</Link>
      </p>
    </>
  );
}
