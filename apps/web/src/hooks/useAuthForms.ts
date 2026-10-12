import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAction } from './useAction';

const DEFAULT_MIN = 8;

/** The password rule of this server (GET /meta), so the forms never disagree with the API. */
export function usePasswordMin() {
  const [min, setMin] = useState(DEFAULT_MIN);
  useEffect(() => {
    let live = true;
    api.meta().then(
      (m) => live && Number.isInteger(m.passwordMin) && setMin(m.passwordMin),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return min;
}

export function useLoginForm(onDone: () => void) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useAction(async () => {
    await api.login(email, password);
    onDone();
  }, 'Log-in failed.');
  return { email, setEmail, password, setPassword, submit: run, busy, error };
}

export function useSignupForm(onDone: () => void) {
  const min = usePasswordMin();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const mismatch = touched && confirm.length > 0 && password !== confirm;
  const { run, busy, error } = useAction(async () => {
    await api.signup(name, email, password);
    onDone();
  }, 'Sign-up failed.');

  const submit = () => {
    setTouched(true);
    if (password !== confirm) return;
    run();
  };

  return { min, name, setName, email, setEmail, password, setPassword, confirm, setConfirm: (v: string) => (setConfirm(v), setTouched(true)), mismatch, submit, busy, error };
}

/** "Forgot password": always the same answer, whether the e-mail has an account or not. */
export function useForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ to: string; minutes: number } | null>(null);
  const { run, busy, error } = useAction(async () => {
    const r = await api.forgot(email.trim());
    setSent({ to: email.trim(), minutes: r.minutes });
  });
  return { email, setEmail, submit: run, busy, error, sent, again: () => setSent(null) };
}

/**
 * "Choose a new password" from the e-mailed link. The token is read once and then removed from the
 * address bar (it should not stay in the browser history). `valid` is null while the link is checked.
 */
export function useResetPassword(onDone: () => void) {
  const min = usePasswordMin();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.resetValid(token).then(
      (r) => live && setValid(r.valid),
      () => live && setValid(true), // cannot tell: the submit gives the real answer
    );
    return () => {
      live = false;
    };
  }, [token]);

  // Signed in by the reset: on to the dashboard after a moment.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const long = password.length >= min;
  const same = confirm.length > 0 && confirm === password;
  const { run, busy, error, setError } = useAction(async () => {
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'reset_invalid') setValid(false);
      throw e;
    }
  });

  const submit = () => {
    setError(null);
    if (!long) return setError(`Use at least ${min} characters.`);
    if (!same) return setError('The two passwords are not the same.');
    run();
  };

  return { min, valid, password, setPassword, confirm, setConfirm, long, same, submit, busy, error, done };
}
