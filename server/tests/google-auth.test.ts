import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createGoogleVerifier, type VerifyGoogleIdToken } from '../src/google-auth.js';

const CLIENT_ID = 'client-1.apps.googleusercontent.com';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verify: VerifyGoogleIdToken;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createGoogleVerifier({
    clientIds: ['other-client', CLIENT_ID],
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

function sign(claims: JWTPayload, options: { key?: CryptoKey; expiresIn?: string } = {}) {
  return new SignJWT({ email: 'a@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(typeof claims.iss === 'string' ? claims.iss : 'https://accounts.google.com')
    .setAudience(claims.aud ?? CLIENT_ID)
    .setSubject(typeof claims.sub === 'string' ? claims.sub : '1234')
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(options.key ?? privateKey);
}

describe('createGoogleVerifier', () => {
  it('accepts a good token from either Google issuer', async () => {
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
      expect(await verify(await sign({ iss }))).toEqual({ sub: '1234', email: 'a@example.com' });
    }
  });

  it('refuses another issuer', async () => {
    expect(await verify(await sign({ iss: 'https://evil.example' }))).toBeNull();
  });

  it('refuses another audience', async () => {
    expect(await verify(await sign({ aud: 'someone-else' }))).toBeNull();
  });

  it('refuses an unverified or missing email', async () => {
    expect(await verify(await sign({ email_verified: false }))).toBeNull();
    expect(await verify(await sign({ email_verified: 'true' }))).toBeNull();
    expect(await verify(await sign({ email: undefined }))).toBeNull();
  });

  it('refuses an expired token, a wrong signature and garbage', async () => {
    expect(await verify(await sign({}, { expiresIn: '-1m' }))).toBeNull();
    expect(await verify(await sign({}, { key: otherKey }))).toBeNull();
    expect(await verify('not.a.jwt')).toBeNull();
  });

  it('refuses everything when no client id is configured', async () => {
    const none = createGoogleVerifier({ clientIds: [], keys: async () => privateKey });
    expect(await none(await sign({}))).toBeNull();
  });

  it('throws, rather than refusing, when the keys cannot be fetched', async () => {
    const offline = createGoogleVerifier({
      clientIds: [CLIENT_ID],
      keys: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(offline(await sign({}))).rejects.toThrow(TypeError);
  });
});
