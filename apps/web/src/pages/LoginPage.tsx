import { Link, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import TextLink, { textLinkCls } from '../components/ui/TextLink';
import { muted } from '../components/ui/styles';
import { useLoginForm } from '../hooks/useAuthForms';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type From = { from?: string } | null;
/** Only paths inside this app (never "//other.site"). */
const safeFrom = (p?: string) => (p && p.startsWith('/') && !p.startsWith('//') && p !== '/login' ? p : '/dashboard');

export default function LoginPage() {
  useDocumentTitle('Log in');
  const navigate = useNavigate();
  const state = useLocation().state as From;
  const form = useLoginForm(() => navigate(safeFrom(state?.from), { replace: true }));

  return (
    <>
      <PageHeader compact title="Welcome back" description="Log in to see your analytics." />

      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.submit();
        }}
      >
        <Field label="Work email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={form.email} onChange={(e) => form.setEmail(e.target.value)} required />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          labelRight={
            <Link to="/forgot-password" className={`text-sm ${textLinkCls} !font-medium`}>
              Forgot password?
            </Link>
          }
          value={form.password}
          onChange={(e) => form.setPassword(e.target.value)}
          required
        />
        <FormError message={form.error} />
        <Button type="submit" className="mt-1 w-full" loading={form.busy}>
          Log in
        </Button>
      </form>

      <p className={`mt-6 text-center text-sm ${muted}`}>
        Don't have an account? <TextLink to="/signup">Sign up</TextLink>
      </p>
    </>
  );
}
