import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository-root .env (never committed) into process.env, without overriding variables
 * that are already set. Works the same on Windows, macOS and Linux.
 */
export const ROOT_ENV = fileURLToPath(new URL('../../.env', import.meta.url));

export function loadRootEnv() {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

export function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Put it in the .env file at the repository root (see .env.example).`);
    process.exit(2);
  }
  return value;
}
