/**
 * The cloud sync account on this device: Google sign-in through `chrome.identity`, the stored
 * account (`cloudAccount`) and sync key (`cloudSyncKey`) in `chrome.storage.local`, the sync
 * passphrase, and the state Settings shows. Page only: sign-in needs a click, and nothing here is
 * loaded by the service worker. Neither key is session data, so they are written here rather
 * than through `sessionRepo`; signing out or deleting the cloud data never touches a session.
 */
import {
  type CloudApiOptions,
  CloudUnauthorizedError,
  authGoogle,
  deleteAccount,
  logout,
  putKeys,
} from '@/lib/cloud-api';
import { cloudSyncConfig } from '@/lib/cloud-config';
import { createKeySetup, keyMatchesSetup, toBase64, unlockKeySetup } from '@/lib/cloud-crypto';
import { ExplainedError } from '@/lib/error-message';
import { isRecord } from '@/lib/import-guards';
import type { CloudAccount, CloudKeySetup } from '@/types';

/** `chrome.storage.local` key of the signed-in account. */
export const CLOUD_ACCOUNT_KEY = 'cloudAccount';
/** `chrome.storage.local` key of the raw sync key (base64). Never sent anywhere. */
export const CLOUD_SYNC_KEY = 'cloudSyncKey';

/** The shortest sync passphrase Settings accepts. */
export const PASSPHRASE_MIN_LENGTH = 8;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** What Settings > Account shows. */
export type AccountState =
  | 'unconfigured'
  | 'signedOut'
  | 'needsPassphrase'
  | 'needsUnlock'
  | 'ready';

export function isCloudAccount(value: unknown): value is CloudAccount {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token !== '' &&
    typeof value.expiresAt === 'number' &&
    typeof value.email === 'string'
  );
}

/**
 * The state for what is known: whether sync is configured, the stored account, whether this device
 * holds a key for the server's setup, and that setup (`undefined` while it is not known yet).
 * 'ready' needs both halves: a setup on the server and its key here, so a key is never trusted
 * before the server's setup is known (`keepSyncKeyFor()` drops one that does not open it). Pure.
 */
export function accountState(input: {
  configured: boolean;
  account: CloudAccount | null;
  hasLocalKey: boolean;
  keySetup: CloudKeySetup | null | undefined;
  now: number;
}): AccountState | 'unknown' {
  if (!input.configured) {
    return 'unconfigured';
  }
  if (input.account === null || input.account.expiresAt <= input.now) {
    return 'signedOut';
  }
  if (input.keySetup === undefined) {
    return 'unknown';
  }
  if (input.keySetup === null) {
    return 'needsPassphrase';
  }
  return input.hasLocalKey ? 'ready' : 'needsUnlock';
}

/** Why a new passphrase is refused, or `null` when it is fine. Pure. */
export function newPassphraseProblem(
  passphrase: string,
  repeated: string,
): 'tooShort' | 'mismatch' | null {
  if ([...passphrase].length < PASSPHRASE_MIN_LENGTH) {
    return 'tooShort';
  }
  return passphrase === repeated ? null : 'mismatch';
}

/** Google's OAuth URL asking for an ID token for `openid email`. Pure. */
export function googleAuthUrl(clientId: string, redirectUri: string, nonce: string): string {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'id_token',
    redirect_uri: redirectUri,
    scope: 'openid email',
    nonce,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${query.toString()}`;
}

/** The `id_token` (or Google's `error`) in the fragment of the redirect URL. Pure. */
export function idTokenFromRedirect(redirectUrl: string): { idToken: string } | { error: string } {
  const hash = redirectUrl.includes('#') ? redirectUrl.slice(redirectUrl.indexOf('#') + 1) : '';
  const params = new URLSearchParams(hash);
  const idToken = params.get('id_token');
  if (idToken !== null && idToken !== '') {
    return { idToken };
  }
  return { error: params.get('error') ?? 'no_id_token' };
}

/**
 * The payload of a JWT, decoded only: the server checks the signature, this side only reads the
 * nonce back. `null` when it is not a JWT with a JSON object payload. Pure.
 */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (part === undefined || part === '') {
    return null;
  }
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Chrome's wording when the person closes the sign-in window or turns the request down. */
function isCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('did not approve') || message.includes('cancel');
}

// ---------------------------------------------------------------------------
// Stored account and key
// ---------------------------------------------------------------------------

export async function loadCloudAccount(): Promise<CloudAccount | null> {
  const stored = await chrome.storage.local.get(CLOUD_ACCOUNT_KEY);
  const value: unknown = stored[CLOUD_ACCOUNT_KEY];
  return isCloudAccount(value) ? value : null;
}

export async function loadSyncKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get(CLOUD_SYNC_KEY);
  const value: unknown = stored[CLOUD_SYNC_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Forgets the account and the key on this device. Local sessions are untouched. */
export async function forgetCloudAccount(): Promise<void> {
  await chrome.storage.local.remove([CLOUD_ACCOUNT_KEY, CLOUD_SYNC_KEY]);
}

/**
 * The stored account while its token is still good. An expired one is forgotten, together with
 * the key, so no key outlives the account it was entered for.
 */
export async function loadLiveCloudAccount(now: number): Promise<CloudAccount | null> {
  const account = await loadCloudAccount();
  if (account !== null && account.expiresAt <= now) {
    await forgetCloudAccount();
    return null;
  }
  return account;
}

/**
 * Keeps the key on this device only when it opens `setup`, the account's setup on the server:
 * with no setup there, or one made with another passphrase (another account, or a passphrase
 * created again after the cloud data was deleted), the key is removed. Whether a key is kept.
 */
export async function keepSyncKeyFor(setup: CloudKeySetup | null): Promise<boolean> {
  const rawKey = await loadSyncKey();
  if (rawKey === null) {
    return false;
  }
  if (setup !== null && (await keyMatchesSetup(rawKey, setup))) {
    return true;
  }
  await chrome.storage.local.remove(CLOUD_SYNC_KEY);
  return false;
}

/**
 * Stores the key for the account whose `token` it was made under, unless that account was
 * signed out (or replaced) meanwhile, in another tab say; then nothing is stored and the
 * request reads as signed out.
 */
async function storeSyncKeyFor(token: string, rawKey: string): Promise<void> {
  const current = await loadCloudAccount();
  if (current === null || current.token !== token) {
    throw new CloudUnauthorizedError();
  }
  await chrome.storage.local.set({ [CLOUD_SYNC_KEY]: rawKey });
}

async function requireAccount(): Promise<CloudAccount> {
  const account = await loadCloudAccount();
  if (account === null) {
    throw new CloudUnauthorizedError();
  }
  return account;
}

/**
 * Runs a request for the stored account; a 401 forgets the account (the token is no longer
 * good) and is then thrown on, so the page says so and shows "Sign in" again.
 */
export async function withCloudAccount<T>(run: (account: CloudAccount) => Promise<T>): Promise<T> {
  try {
    return await run(await requireAccount());
  } catch (err: unknown) {
    if (err instanceof CloudUnauthorizedError) {
      await forgetCloudAccount();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sign-in, sign-out, delete
// ---------------------------------------------------------------------------

export type SignInOutcome =
  | { outcome: 'signedIn'; account: CloudAccount; keySetup: CloudKeySetup | null }
  | { outcome: 'cancelled' };

/**
 * Signs in with Google, straight from a click: Google's chooser in a window Chrome opens, the
 * ID token from the redirect (its nonce checked against the one sent), the server's token for
 * it, and the account stored. A closed window or a refusal is `'cancelled'`, not an error.
 */
export async function signIn(options: CloudApiOptions = {}): Promise<SignInOutcome> {
  const nonce = randomNonce();
  const url = googleAuthUrl(
    cloudSyncConfig().googleClientId,
    chrome.identity.getRedirectURL(),
    nonce,
  );
  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (err: unknown) {
    if (isCancelled(err)) {
      return { outcome: 'cancelled' };
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExplainedError(`launchWebAuthFlow failed (${reason})`, 'errorCloudSignInFailed');
  }
  const answer = idTokenFromRedirect(redirect ?? '');
  if ('error' in answer) {
    if (answer.error === 'access_denied') {
      return { outcome: 'cancelled' };
    }
    throw new ExplainedError(`Google sign-in returned ${answer.error}`, 'errorCloudSignInFailed');
  }
  if (jwtPayload(answer.idToken)?.nonce !== nonce) {
    throw new ExplainedError('The ID token carries another nonce', 'errorCloudSignInFailed');
  }
  const result = await authGoogle(answer.idToken, options);
  const account: CloudAccount = {
    token: result.token,
    expiresAt: result.expiresAt,
    email: result.email,
  };
  // A key left from an earlier sign-in (another account, or this one before its passphrase was
  // made again) must not carry over: it stays only when it opens this account's setup.
  await keepSyncKeyFor(result.keySetup);
  await chrome.storage.local.set({ [CLOUD_ACCOUNT_KEY]: account });
  return { outcome: 'signedIn', account, keySetup: result.keySetup };
}

/** Signs out: the server forgets the token when it can, this device forgets account and key. */
export async function signOut(options: CloudApiOptions = {}): Promise<void> {
  const account = await loadCloudAccount();
  if (account !== null) {
    try {
      await logout(account.token, options);
    } catch (err: unknown) {
      // Best effort: the token expires on its own, and signing out here must not wait on it.
      console.warn('[tabinet] sign-out not confirmed by the server', err);
    }
  }
  await forgetCloudAccount();
}

/** Deletes the account and everything on the server, then signs out on this device. */
export async function deleteCloudData(options: CloudApiOptions = {}): Promise<void> {
  await withCloudAccount((account) => deleteAccount(account.token, options));
  await forgetCloudAccount();
}

// ---------------------------------------------------------------------------
// The sync passphrase
// ---------------------------------------------------------------------------

export type SetUpPassphraseOutcome =
  | { outcome: 'ready'; setup: CloudKeySetup }
  | { outcome: 'exists' };

/**
 * Sets up a new passphrase: the key setup goes to the server and the key is kept here (`'ready'`,
 * with the setup now on the server). `'exists'` when another device set one up first; nothing is
 * kept then, and the person enters that one. Signed out meanwhile, the key is not kept either.
 */
export async function setUpPassphrase(
  passphrase: string,
  options: CloudApiOptions & { iterations?: number } = {},
): Promise<SetUpPassphraseOutcome> {
  const { setup, rawKey } = await createKeySetup(passphrase, options.iterations);
  const { result, token } = await withCloudAccount(async (account) => ({
    result: await putKeys(account.token, setup, options),
    token: account.token,
  }));
  if (result === 'exists') {
    return { outcome: 'exists' };
  }
  await storeSyncKeyFor(token, rawKey);
  return { outcome: 'ready', setup };
}

/**
 * Tries `passphrase` against the server's setup and keeps the key when it is right, unless the
 * account was signed out (or replaced) while the key was derived.
 */
export async function unlockWithPassphrase(
  setup: CloudKeySetup,
  passphrase: string,
): Promise<boolean> {
  const { token } = await requireAccount();
  const rawKey = await unlockKeySetup(setup, passphrase);
  if (rawKey === null) {
    return false;
  }
  await storeSyncKeyFor(token, rawKey);
  return true;
}
