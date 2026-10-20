import { HttpError } from '../http/errors';
import { EMAIL_RE, str } from '../http/request';
import { PASSWORD_MAX, PASSWORD_MIN } from '../lib/passwords';

/** Request checks of sign-up, login, e-mail verification and password reset. Each throws the 400 the client sees. */

export const invalidPassword = () => new HttpError(400, 'invalid_password', `Use at least ${PASSWORD_MIN} characters.`);
export const validPassword = (p: string) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
export const validEmail = (e: string) => EMAIL_RE.test(e) && e.length <= 320;

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  /** The client wants the session as a Bearer token too (mobile app, WordPress plugin). */
  wantToken: boolean;
}

/** Name, then e-mail, then password: the first wrong field is the one reported. */
export function signupInput(b: Record<string, unknown>): SignupInput {
  const name = str(b.name).trim();
  const email = str(b.email).trim();
  const password = str(b.password);
  if (!name || name.length > 120) throw new HttpError(400, 'invalid_name', 'Enter your name (up to 120 characters).');
  if (!validEmail(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
  if (!validPassword(password)) throw invalidPassword();
  return { name, email, password, wantToken: b.token === true };
}

export interface CredentialsInput {
  /** Lower-cased and trimmed: the account is found by its normalised address. */
  email: string;
  password: string;
}

/** Login and "send the link again": no format checks, a wrong address is simply a wrong login. */
export function credentialsInput(b: Record<string, unknown>): CredentialsInput {
  return { email: str(b.email).trim().toLowerCase(), password: str(b.password) };
}

/** Forgot password: a real-looking address is required before anything else. */
export function forgotInput(b: Record<string, unknown>): { email: string } {
  const email = str(b.email).trim();
  if (!validEmail(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
  return { email };
}

export interface ResetInput {
  token: string;
  password: string;
  /** `token` in this body is the reset token, so a client that wants a Bearer token asks with `session: true`. */
  wantToken: boolean;
}

/** New password from a reset link: the password is checked before the link. */
export function resetInput(b: Record<string, unknown>): ResetInput {
  const token = str(b.token);
  const password = str(b.password);
  if (!validPassword(password)) throw invalidPassword();
  return { token, password, wantToken: b.session === true };
}
