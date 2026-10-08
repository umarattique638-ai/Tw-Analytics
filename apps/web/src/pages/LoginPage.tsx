import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';

// "Continue with Google" and "Forgot password?" return once OAuth and e-mail sending exist (after Stage 5).
export default function LoginPage() {
  const navigate = useNavigate();
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

      <form className="grid gap-5" onSubmit={onSubmit}>
        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
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
