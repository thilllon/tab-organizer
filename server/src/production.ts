import { randomBytes } from 'node:crypto';

import { neon } from '@neondatabase/serverless';

import { type Deps, handle } from './app.js';
import { withCors } from './cors.js';
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

// neon() puts the whole connection string, password included, into the message of the error it
// throws for one it cannot parse. Check it here first and name only the variable.
function requireUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = requireEnv(env, name);
  if (!URL.canParse(value)) {
    throw new Error(`Environment variable ${name} is not a valid URL`);
  }
  return value;
}

/** The real dependencies: Neon over HTTP, Google's keys, the clock and the system's random bytes. */
export function createProductionDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  const sql = neon(requireUrl(env, 'DATABASE_URL'));
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

/**
 * The function's handler. It builds the deps on first use, not at import, so a bad environment
 * fails each request with a 500 instead of the cold start, and is tried again on the next one.
 */
export function createServer(
  build: () => Deps = createProductionDeps,
  env: NodeJS.ProcessEnv = process.env,
): (request: Request) => Promise<Response> {
  let deps: Deps | undefined;
  return async (request) => {
    try {
      deps ??= build();
    } catch (err) {
      // The name only, as in handle(): a configuration error can quote a secret it was given.
      console.error(
        'tabinet-server: configuration failed',
        err instanceof Error ? err.name : typeof err,
      );
      const response = new Response(JSON.stringify({ error: 'internal' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
      return withCors(
        response,
        request.headers.get('Origin'),
        listFromEnv(env.ALLOWED_ORIGINS),
        false,
      );
    }
    return handle(request, deps);
  };
}
