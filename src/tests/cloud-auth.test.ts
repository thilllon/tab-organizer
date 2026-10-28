import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudUnauthorizedError, me } from '@/lib/cloud-api';
import {
  accountState,
  CLOUD_ACCOUNT_KEY,
  CLOUD_SYNC_KEY,
  deleteCloudData,
  googleAuthUrl,
  idTokenFromRedirect,
  jwtPayload,
  loadCloudAccount,
  loadSyncKey,
  newPassphraseProblem,
  setUpPassphrase,
  signIn,
  signOut,
  unlockWithPassphrase,
  withCloudAccount,
} from '@/lib/cloud-auth';
import { overrideCloudSyncConfig } from '@/lib/cloud-config';
import { createKeySetup } from '@/lib/cloud-crypto';
import { errorMessage } from '@/lib/error-message';
import { t } from '@/lib/i18n';
import type { CloudAccount, CloudKeySetup } from '@/types';

import { getChromeFake } from './chrome-fake';
import { fakeFetch, jsonResponse } from './cloud-fetch';

const ACCOUNT: CloudAccount = { token: 'tok', expiresAt: 2_000_000_000_000, email: 'a@b.c' };
const SETUP: CloudKeySetup = {
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 },
  salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
  check: 'Y2hlY2s=',
  checkIv: 'aXZpdml2aXZpdml2',
};

function base64url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** An unsigned JWT-shaped token: only the payload is ever read on this side. */
function idToken(payload: Record<string, unknown>): string {
  return `${base64url('{"alg":"RS256"}')}.${base64url(JSON.stringify(payload))}.sig`;
}

/** The Google window: answers the auth URL with a redirect carrying an ID token for `nonce`. */
function googleAnswers(nonceOf: (sent: string) => string) {
  getChromeFake().state.authFlowAnswer = (url) => {
    const sent = new URL(url).searchParams.get('nonce') ?? '';
    const token = idToken({ nonce: nonceOf(sent), email: 'a@b.c' });
    return `https://fakeextid.chromiumapp.org/#id_token=${token}&token_type=Bearer`;
  };
}

beforeEach(() => {
  overrideCloudSyncConfig(() => ({ apiBase: 'https://sync.test', googleClientId: 'client.apps' }));
});

afterEach(() => {
  overrideCloudSyncConfig();
  vi.restoreAllMocks();
});

describe('accountState', () => {
  const base = { configured: true, account: ACCOUNT, hasLocalKey: false, now: 1_000 };

  it('is unconfigured without a sync server, whatever else is stored', () => {
    expect(accountState({ ...base, configured: false, hasLocalKey: true, keySetup: SETUP })).toBe(
      'unconfigured',
    );
  });

  it('is signedOut with no account or an expired one', () => {
    expect(accountState({ ...base, account: null, keySetup: undefined })).toBe('signedOut');
    expect(accountState({ ...base, now: ACCOUNT.expiresAt, keySetup: null })).toBe('signedOut');
  });

  it('is needsPassphrase, needsUnlock or ready by the server setup and the local key', () => {
    expect(accountState({ ...base, keySetup: null })).toBe('needsPassphrase');
    expect(accountState({ ...base, keySetup: SETUP })).toBe('needsUnlock');
    expect(accountState({ ...base, hasLocalKey: true, keySetup: undefined })).toBe('ready');
    expect(accountState({ ...base, keySetup: undefined })).toBe('unknown');
  });
});

describe('newPassphraseProblem', () => {
  it('wants 8 characters, counted as characters, and the same text twice', () => {
    expect(newPassphraseProblem('1234567', '1234567')).toBe('tooShort');
    expect(newPassphraseProblem('12345678', '12345679')).toBe('mismatch');
    expect(newPassphraseProblem('12345678', '12345678')).toBeNull();
    // Four emoji are eight UTF-16 units but four characters.
    expect(newPassphraseProblem('🔑🔑🔑🔑', '🔑🔑🔑🔑')).toBe('tooShort');
  });
});

describe('googleAuthUrl / idTokenFromRedirect / jwtPayload', () => {
  it('asks Google for an ID token with every required parameter', () => {
    const url = new URL(googleAuthUrl('client.apps', 'https://x.chromiumapp.org/', 'n0nce'));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client.apps',
      response_type: 'id_token',
      redirect_uri: 'https://x.chromiumapp.org/',
      scope: 'openid email',
      nonce: 'n0nce',
      prompt: 'select_account',
    });
  });

  it('reads the id_token, or the error, from the fragment', () => {
    expect(idTokenFromRedirect('https://x.chromiumapp.org/#id_token=a.b.c&authuser=0')).toEqual({
      idToken: 'a.b.c',
    });
    expect(idTokenFromRedirect('https://x.chromiumapp.org/#error=access_denied')).toEqual({
      error: 'access_denied',
    });
    expect(idTokenFromRedirect('https://x.chromiumapp.org/')).toEqual({ error: 'no_id_token' });
  });

  it('decodes a payload, including non-ASCII, and refuses what is not a JWT', () => {
    expect(jwtPayload(idToken({ nonce: 'n', name: 'Zoë 한글' }))).toEqual({
      nonce: 'n',
      name: 'Zoë 한글',
    });
    expect(jwtPayload('not-a-jwt')).toBeNull();
    expect(jwtPayload(`a.${base64url('[1]')}.c`)).toBeNull();
  });
});

describe('signIn', () => {
  it('opens Google interactively, then stores the account the server answers with', async () => {
    googleAnswers((sent) => sent);
    const server = fakeFetch(
      jsonResponse(200, {
        token: 'tok',
        expiresAt: ACCOUNT.expiresAt,
        email: 'a@b.c',
        keySetup: null,
      }),
    );
    const result = await signIn({ fetch: server.fetch });
    expect(result).toEqual({ outcome: 'signedIn', account: ACCOUNT, keySetup: null });
    expect(await loadCloudAccount()).toEqual(ACCOUNT);
    const fake = getChromeFake();
    const sentUrl = new URL(fake.state.authFlowUrls[0] ?? '');
    expect(sentUrl.searchParams.get('redirect_uri')).toBe('https://fakeextid.chromiumapp.org/');
    expect(sentUrl.searchParams.get('client_id')).toBe('client.apps');
    expect(sentUrl.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(server.requests[0]?.url).toBe('https://sync.test/v1/auth/google');
  });

  it('refuses an ID token minted for another nonce, and stores nothing', async () => {
    googleAnswers(() => 'someone-elses-nonce');
    const server = fakeFetch(jsonResponse(200, {}));
    const err: unknown = await signIn({ fetch: server.fetch }).catch((e: unknown) => e);
    expect(errorMessage(err)).toBe(t('errorCloudSignInFailed'));
    expect(server.requests).toHaveLength(0);
    expect(getChromeFake().state.local.has(CLOUD_ACCOUNT_KEY)).toBe(false);
  });

  it('is cancelled, not failed, when the person closes the window or declines', async () => {
    const server = fakeFetch(jsonResponse(200, {}));
    // The fake's default: Chrome's wording for a closed window.
    expect(await signIn({ fetch: server.fetch })).toEqual({ outcome: 'cancelled' });
    getChromeFake().state.authFlowAnswer = 'https://fakeextid.chromiumapp.org/#error=access_denied';
    expect(await signIn({ fetch: server.fetch })).toEqual({ outcome: 'cancelled' });
    expect(server.requests).toHaveLength(0);
    expect(getChromeFake().state.local.has(CLOUD_ACCOUNT_KEY)).toBe(false);
  });

  it('explains any other failure of the sign-in window', async () => {
    getChromeFake().state.authFlowAnswer = new Error('Authorization page could not be loaded.');
    const err: unknown = await signIn().catch((e: unknown) => e);
    expect(errorMessage(err)).toBe(t('errorCloudSignInFailed'));
  });
});

describe('signOut / deleteCloudData', () => {
  beforeEach(async () => {
    await chrome.storage.local.set({
      [CLOUD_ACCOUNT_KEY]: ACCOUNT,
      [CLOUD_SYNC_KEY]: 'a2V5',
      sessionIndex: { schemaVersion: 1, sessions: [] },
    });
  });

  it('signs out on the server and forgets account and key, leaving sessions alone', async () => {
    const server = fakeFetch(jsonResponse(204));
    await signOut({ fetch: server.fetch });
    expect(server.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://sync.test/v1/auth/logout',
    });
    const local = getChromeFake().state.local;
    expect(local.has(CLOUD_ACCOUNT_KEY)).toBe(false);
    expect(local.has(CLOUD_SYNC_KEY)).toBe(false);
    expect(local.has('sessionIndex')).toBe(true);
  });

  it('still signs out here when the server cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const offline = fakeFetch(new TypeError('Failed to fetch'));
    await signOut({ fetch: offline.fetch });
    expect(await loadCloudAccount()).toBeNull();
    expect(await loadSyncKey()).toBeNull();
  });

  it('deletes the account on the server, then forgets it here', async () => {
    const server = fakeFetch(jsonResponse(204));
    await deleteCloudData({ fetch: server.fetch });
    expect(server.requests[0]).toMatchObject({
      method: 'DELETE',
      url: 'https://sync.test/v1/account',
    });
    expect(await loadCloudAccount()).toBeNull();
    expect(await loadSyncKey()).toBeNull();
    expect(getChromeFake().state.local.has('sessionIndex')).toBe(true);
  });

  it('keeps everything when the deletion fails for another reason than the sign-in', async () => {
    const down = fakeFetch(jsonResponse(500, { error: 'internal' }));
    await expect(deleteCloudData({ fetch: down.fetch })).rejects.toThrow(/HTTP 500/);
    expect(await loadCloudAccount()).toEqual(ACCOUNT);
  });
});

describe('withCloudAccount', () => {
  it('forgets the stored account on a 401 and throws it on', async () => {
    await chrome.storage.local.set({ [CLOUD_ACCOUNT_KEY]: ACCOUNT, [CLOUD_SYNC_KEY]: 'a2V5' });
    const server = fakeFetch(jsonResponse(401, { error: 'unauthorized' }));
    await expect(
      withCloudAccount((a) => me(a.token, { fetch: server.fetch })),
    ).rejects.toBeInstanceOf(CloudUnauthorizedError);
    expect(await loadCloudAccount()).toBeNull();
    expect(await loadSyncKey()).toBeNull();
  });

  it('throws CloudUnauthorizedError without asking the server when nobody is signed in', async () => {
    const server = fakeFetch(jsonResponse(200, {}));
    await expect(
      withCloudAccount((a) => me(a.token, { fetch: server.fetch })),
    ).rejects.toBeInstanceOf(CloudUnauthorizedError);
    expect(server.requests).toHaveLength(0);
  });

  it('ignores a stored account of the wrong shape', async () => {
    await chrome.storage.local.set({ [CLOUD_ACCOUNT_KEY]: { token: 5 } });
    expect(await loadCloudAccount()).toBeNull();
  });
});

describe('the sync passphrase', () => {
  beforeEach(async () => {
    await chrome.storage.local.set({ [CLOUD_ACCOUNT_KEY]: ACCOUNT });
  });

  it('creates a setup on the server and keeps the key here', async () => {
    const server = fakeFetch(jsonResponse(201));
    expect(await setUpPassphrase('long enough', { fetch: server.fetch, iterations: 1000 })).toBe(
      'ready',
    );
    const sent = server.requests[0]?.body;
    expect(sent).toMatchObject({ kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 } });
    expect(JSON.stringify(sent)).not.toContain('long enough');
    expect(await loadSyncKey()).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('keeps no key when another computer created a passphrase first', async () => {
    const server = fakeFetch(jsonResponse(409, { error: 'key_exists' }));
    expect(await setUpPassphrase('long enough', { fetch: server.fetch, iterations: 1000 })).toBe(
      'exists',
    );
    expect(await loadSyncKey()).toBeNull();
  });

  it('unlocks with the right passphrase only', async () => {
    const { setup, rawKey } = await createKeySetup('the right one', 1000);
    expect(await unlockWithPassphrase(setup, 'the wrong one')).toBe(false);
    expect(await loadSyncKey()).toBeNull();
    expect(await unlockWithPassphrase(setup, 'the right one')).toBe(true);
    expect(await loadSyncKey()).toBe(rawKey);
  });
});
