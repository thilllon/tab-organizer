import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { GoogleIdentity } from './types.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export type VerifyGoogleIdToken = (idToken: string) => Promise<GoogleIdentity | null>;

/**
 * Verifies a Google ID token: signature against Google's keys, issuer, audience (one of our OAuth
 * client ids), expiry, and a verified email. Returns null for a token that fails any of these; a
 * failure to reach Google's keys is thrown, so it becomes a 500 rather than a false "unauthorized".
 */
export function createGoogleVerifier(options: {
  clientIds: readonly string[];
  keys?: JWTVerifyGetKey;
}): VerifyGoogleIdToken {
  const keys = options.keys ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const audience = [...options.clientIds];
  return async (idToken) => {
    if (audience.length === 0) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(idToken, keys, {
        issuer: GOOGLE_ISSUERS,
        audience,
        algorithms: ['RS256'],
      });
      if (
        typeof payload.sub !== 'string' ||
        payload.sub === '' ||
        typeof payload.email !== 'string' ||
        payload.email_verified !== true
      ) {
        return null;
      }
      return { sub: payload.sub, email: payload.email };
    } catch (err) {
      if (err instanceof errors.JOSEError && !(err instanceof errors.JWKSTimeout)) {
        return null;
      }
      throw err;
    }
  };
}
