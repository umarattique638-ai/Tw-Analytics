import type { Context, Hono } from 'hono';
import type { TenantDoc, UserDoc } from '../store/types';

/** What the session middleware puts on a signed-in request. */
export type Vars = { user: UserDoc; tenant: TenantDoc; token: string };
export type Env = { Variables: Vars };
export type Ctx = Context<Env>;
/** The app every route module adds its routes to. */
export type Api = Hono<Env>;
