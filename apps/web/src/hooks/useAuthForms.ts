import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
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

/**
 * Log in. A right password on an account whose e-mail is not confirmed yet is refused with
 * `email_unverified` (decision 27): then `unverified` is set and `resend()` sends the link again.
 */
export function useLoginForm(onDone: () => void) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<string | null>(null);
  const { run, busy, error } = useAction(async () => {
    setUnverified(false);
    setResent(null);
    try {
      await api.login(email, password);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_unverified') setUnverified(true);
      throw e;
    }
    onDone();
  }, 'Log-in failed.');
  const resend = useAction(async () => {
    const r = await api.resendVerification(email, password);
    if (r.alreadyVerified) {
      setUnverified(false);
      return run();
    }
    setResent(r.email ?? email);
  }, 'The e-mail could not be sent.');
  return {
    email,
    setEmail,
    password,
    setPassword,
    submit: run,
    busy,
    error: unverified ? null : error,
    unverified,
    unverifiedMessage: unverified ? error : null,
    resend: resend.run,
    resending: resend.busy,
    resendError: resend.error,
    resent,
  };
}

/** What a sign-up that still needs the e-mail confirmed returns: show "check your inbox". */
export interface PendingVerification {
  email: string;
  sent: boolean;
  hours: number;
}

export function useSignupForm(onDone: () => void) {
  const min = usePasswordMin();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<PendingVerification | null>(null);
  const mismatch = touched && confirm.length > 0 && password !== confirm;
  const { run, busy, error } = useAction(async () => {
    const r = await api.signup(name, email, password);
    if (r.verificationRequired) return setPending({ email: r.email ?? email, sent: r.sent !== false, hours: r.hours ?? 24 });
    onDone();
  }, 'Sign-up failed.');

  const submit = () => {
    setTouched(true);
    if (password !== confirm) return;
    run();
  };

  /** "Send it again" from the check-your-inbox screen (the password is still in the form). */
  const resend = useAction(async () => {
    const r = await api.resendVerification(email, password);
    if (pending) setPending({ ...pending, sent: true, hours: r.hours ?? pending.hours });
  }, 'The e-mail could not be sent.');

  return {
    min,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirm,
    setConfirm: (v: string) => (setConfirm(v), setTouched(true)),
    mismatch,
    submit,
    busy,
    error,
    pending,
    resend: resend.run,
    resending: resend.busy,
    resendError: resend.error,
  };
}

/**
 * The link from the sign-up e-mail (/verify-email?token=…). The token is read once and removed from the
 * address bar, then sent to the API, which confirms the address and signs this browser in.
 */
export function useVerifyEmail(onDone: () => void) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [state, setState] = useState<'checking' | 'done' | 'invalid'>(token ? 'checking' : 'invalid');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    let live = true;
    api.verifyEmail(token).then(
      () => live && setState('done'),
      (e: unknown) => {
        if (!live) return;
        setMessage(e instanceof Error ? e.message : null);
        setState('invalid');
      },
    );
    return () => {
      live = false;
    };
  }, [token]);

  // Signed in by the link: on to adding a site after a moment.
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return { state, message };
}

/** "Forgot password": an e-mail without an account is refused with a message (owner decision 2026-10-15). */
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
