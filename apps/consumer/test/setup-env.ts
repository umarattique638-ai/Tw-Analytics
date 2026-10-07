import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The repository-root .env is never committed. Variables already set (for example by CI) win.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
