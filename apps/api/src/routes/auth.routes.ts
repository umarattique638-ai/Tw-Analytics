import type { AuthController } from '../controllers/auth.controller';
import type { Api } from '../http/types';

/** Sign up, confirm the e-mail, log in, forgot / reset password. Public. */
export function authRoutes(app: Api, c: AuthController) {
  app.post('/auth/signup', c.signup);
  app.post('/auth/login', c.login);
  app.post('/auth/verify-email', c.verifyEmail);
  app.post('/auth/resend-verification', c.resendVerification);
  app.post('/auth/forgot', c.forgot);
  app.get('/auth/reset', c.resetValid);
  app.post('/auth/reset', c.reset);
}

/** Log out: registered after the session middleware (signed in). */
export function logoutRoutes(app: Api, c: AuthController) {
  app.post('/auth/logout', c.logout);
}
