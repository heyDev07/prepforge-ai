import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repository's .env (if present) into process.env without overriding set values. */
export function loadEnv(file = resolve(process.cwd(), '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
