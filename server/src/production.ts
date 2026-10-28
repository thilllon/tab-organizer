import { randomBytes } from 'node:crypto';

import { neon } from '@neondatabase/serverless';

import type { Deps } from './app.js';
import { createGoogleVerifier } from './google-auth.js';
import { createSqlStore } from './store.js';

/** A comma-separated environment variable as a list, blanks dropped. */
export function listFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

/** The real dependencies: Neon over HTTP, Google's keys, the clock and the system's random bytes. */
export function createProductionDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  const sql = neon(requireEnv(env, 'DATABASE_URL'));
  return {
    store: createSqlStore((text, params) => sql.query(text, params)),
    verifyGoogleIdToken: createGoogleVerifier({
      clientIds: listFromEnv(requireEnv(env, 'GOOGLE_CLIENT_IDS')),
    }),
    now: () => Date.now(),
    randomBytes: (size) => new Uint8Array(randomBytes(size)),
    allowedOrigins: listFromEnv(env.ALLOWED_ORIGINS),
  };
}
