import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';

export default function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = touched && confirm.length > 0 && password !== confirm;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api.signup(name, email, password);
      navigate('/sites/new');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Create your account" sub="Start measuring real visitors in a few minutes." />

      <form className="grid gap-5" onSubmit={onSubmit}>
        <Field label="Full name" name="name" autoComplete="name" placeholder="John Doe" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} required />

        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="Create a password"
          hint="Use at least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <Field
          label="Confirm password"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={8}
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setTouched(true); }}
          aria-invalid={mismatch}
          required
        />
        {mismatch && (
          <p role="alert" className="-mt-3 text-[13px] font-medium text-red-600 dark:text-red-400">
            Passwords do not match.
          </p>
        )}

        <FormError message={error} />
        <Button type="submit" className="mt-1 w-full" loading={busy}>Create account</Button>
      </form>

      <p className={`mt-5 text-center text-xs leading-relaxed ${muted}`}>
        By continuing you agree to our <a href="#" className="underline hover:text-slate-700 dark:hover:text-slate-200">Terms</a> and{' '}
        <a href="#" className="underline hover:text-slate-700 dark:hover:text-slate-200">Privacy Policy</a>.
      </p>

      <p className={`mt-6 border-t border-slate-200 pt-6 text-center text-sm dark:border-slate-800 ${muted}`}>
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-teal-700 hover:underline dark:text-teal-400">Log in</Link>
      </p>
    </>
  );
}
