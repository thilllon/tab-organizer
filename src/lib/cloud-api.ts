/**
 * The sync server's API (GitHub issue #165), one typed function per route under `/v1`. Every
 * answer is checked by hand before it is trusted. Failures become errors the page can explain:
 * a 401 is `CloudUnauthorizedError` (the caller then forgets the stored account), any other
 * failure an `ExplainedError` whose `userKey` `src/lib/error-message.ts` turns into a sentence.
 * Nothing here logs a token or a ciphertext.
 */
import { cloudSyncConfig } from '@/lib/cloud-config';
import { ExplainedError } from '@/lib/error-message';
import { isRecord } from '@/lib/import-guards';
import type { CloudKeySetup, CloudRecord, CloudRecordKind, CloudRecordWithSeq } from '@/types';

/** The token is missing, unknown or expired: the stored account is no longer signed in. */
export class CloudUnauthorizedError extends ExplainedError {
  constructor() {
    super('The sync server answered 401 unauthorized', 'errorCloudSignedOut');
    this.name = 'CloudUnauthorizedError';
  }
}

export interface CloudApiOptions {
  /** Injectable for tests; defaults to the global `fetch`, looked up at call time. */
  fetch?: typeof fetch;
  /** The server origin; defaults to the configured `apiBase`. */
  apiBase?: string;
}

/** What `POST /v1/auth/google` answers. `keySetup` is `null` until a passphrase was created. */
export interface CloudSignInResult {
  token: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  email: string;
  keySetup: CloudKeySetup | null;
}

export interface CloudMe {
  email: string;
  keySetup: CloudKeySetup | null;
}

export interface CloudRecordPage {
  records: CloudRecordWithSeq[];
  /** The `since` for the next page: the last record's `seq`, or the `since` asked for. */
  next: number;
  hasMore: boolean;
}

export interface CloudWriteResult {
  kind: CloudRecordKind;
  id: string;
  status: 'applied' | 'stale';
  seq?: number;
  current?: CloudRecordWithSeq;
}

// ---------------------------------------------------------------------------
// Guards for what the server sends back
// ---------------------------------------------------------------------------

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isCloudKeySetup(value: unknown): value is CloudKeySetup {
  if (!isRecord(value) || !isRecord(value.kdf)) {
    return false;
  }
  return (
    value.kdf.name === 'PBKDF2' &&
    value.kdf.hash === 'SHA-256' &&
    isCount(value.kdf.iterations) &&
    value.kdf.iterations > 0 &&
    isString(value.salt) &&
    isString(value.check) &&
    isString(value.checkIv)
  );
}

function isKind(value: unknown): value is CloudRecordKind {
  return value === 'session' || value === 'settings';
}

function isRecordWithSeq(value: unknown): value is CloudRecordWithSeq {
  return (
    isRecord(value) &&
    isKind(value.kind) &&
    isString(value.id) &&
    isCount(value.updatedAt) &&
    typeof value.deleted === 'boolean' &&
    isString(value.iv) &&
    isString(value.ciphertext) &&
    isCount(value.seq)
  );
}

function isWriteResult(value: unknown): value is CloudWriteResult {
  return (
    isRecord(value) &&
    isKind(value.kind) &&
    isString(value.id) &&
    (value.status === 'applied' || value.status === 'stale') &&
    (value.seq === undefined || isCount(value.seq)) &&
    (value.current === undefined || isRecordWithSeq(value.current))
  );
}

/** `expiresAt` as milliseconds, whether the server sent a number or an ISO date. */
function expiryMs(value: unknown): number | undefined {
  if (isCount(value)) {
    return value;
  }
  if (isString(value)) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function badResponse(route: string): ExplainedError {
  return new ExplainedError(
    `${route}: the server's answer has an unexpected shape`,
    'errorCloudBadResponse',
  );
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface Request {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  token?: string;
  body?: unknown;
}

/** The full URL of `path` (which starts with `/v1/`) on the server. */
export function apiUrl(apiBase: string, path: string): string {
  return `${apiBase.replace(/\/+$/, '')}${path}`;
}

/** The `{error}` code of an error body, when there is one. */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && isString(body.error) ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends one request and returns the response when it is a 2xx (or one of `accept`). Never logs
 * the token or the body.
 */
async function send(
  request: Request,
  options: CloudApiOptions,
  accept: readonly number[] = [],
): Promise<Response> {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const headers: Record<string, string> = {};
  if (request.token !== undefined) {
    headers.Authorization = `Bearer ${request.token}`;
  }
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const route = `${request.method} ${request.path.split('?')[0]}`;
  let response: Response;
  try {
    response = await doFetch(apiUrl(options.apiBase ?? cloudSyncConfig().apiBase, request.path), {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExplainedError(`${route}: network failure (${reason})`, 'errorCloudUnreachable');
  }
  if (response.ok || accept.includes(response.status)) {
    return response;
  }
  if (response.status === 401) {
    throw new CloudUnauthorizedError();
  }
  const code = (await errorCode(response)) ?? 'none';
  throw new ExplainedError(
    `${route}: HTTP ${response.status} (error ${code})`,
    response.status >= 500 ? 'errorCloudServer' : 'errorCloudRejected',
  );
}

async function json(response: Response, route: string): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw badResponse(route);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** `POST /v1/auth/google`: trades a Google ID token for the server's bearer token. */
export async function authGoogle(
  idToken: string,
  options: CloudApiOptions = {},
): Promise<CloudSignInResult> {
  const route = 'POST /v1/auth/google';
  const body = await json(
    await send({ method: 'POST', path: '/v1/auth/google', body: { idToken } }, options),
    route,
  );
  if (!isRecord(body) || !isString(body.token) || !isString(body.email)) {
    throw badResponse(route);
  }
  const expiresAt = expiryMs(body.expiresAt);
  const keySetup = body.keySetup ?? null;
  if (expiresAt === undefined || (keySetup !== null && !isCloudKeySetup(keySetup))) {
    throw badResponse(route);
  }
  return { token: body.token, expiresAt, email: body.email, keySetup };
}

/** `POST /v1/auth/logout`: forgets `token` on the server. */
export async function logout(token: string, options: CloudApiOptions = {}): Promise<void> {
  await send({ method: 'POST', path: '/v1/auth/logout', token }, options);
}

/** `GET /v1/me`: the account's address and whether a passphrase was set up. */
export async function me(token: string, options: CloudApiOptions = {}): Promise<CloudMe> {
  const route = 'GET /v1/me';
  const body = await json(await send({ method: 'GET', path: '/v1/me', token }, options), route);
  if (!isRecord(body) || !isString(body.email)) {
    throw badResponse(route);
  }
  const keySetup = body.keySetup ?? null;
  if (keySetup !== null && !isCloudKeySetup(keySetup)) {
    throw badResponse(route);
  }
  return { email: body.email, keySetup };
}

/**
 * `PUT /v1/keys`: stores the passphrase setup once. `'exists'` (409 `key_exists`) means another
 * device set one up first; the caller then asks for that passphrase instead.
 */
export async function putKeys(
  token: string,
  setup: CloudKeySetup,
  options: CloudApiOptions = {},
): Promise<'created' | 'exists'> {
  const response = await send(
    { method: 'PUT', path: '/v1/keys', token, body: setup },
    options,
    [409],
  );
  if (response.status !== 409) {
    return 'created';
  }
  const code = await errorCode(response);
  if (code === 'key_exists') {
    return 'exists';
  }
  throw new ExplainedError(
    `PUT /v1/keys: HTTP 409 (error ${code ?? 'none'})`,
    'errorCloudRejected',
  );
}

/** `GET /v1/records`: the caller's records changed after `since`, oldest change first. */
export async function getRecords(
  token: string,
  since: number,
  limit?: number,
  options: CloudApiOptions = {},
): Promise<CloudRecordPage> {
  const route = 'GET /v1/records';
  const query = new URLSearchParams({ since: String(since) });
  if (limit !== undefined) {
    query.set('limit', String(limit));
  }
  const body = await json(
    await send({ method: 'GET', path: `/v1/records?${query.toString()}`, token }, options),
    route,
  );
  if (
    !isRecord(body) ||
    !Array.isArray(body.records) ||
    !body.records.every(isRecordWithSeq) ||
    !isCount(body.next) ||
    typeof body.hasMore !== 'boolean'
  ) {
    throw badResponse(route);
  }
  return { records: body.records, next: body.next, hasMore: body.hasMore };
}

/** `POST /v1/records`: writes up to 100 records; each is applied, or `stale` with the newer one. */
export async function postRecords(
  token: string,
  records: readonly CloudRecord[],
  options: CloudApiOptions = {},
): Promise<CloudWriteResult[]> {
  const route = 'POST /v1/records';
  const body = await json(
    await send({ method: 'POST', path: '/v1/records', token, body: { records } }, options),
    route,
  );
  if (!isRecord(body) || !Array.isArray(body.results) || !body.results.every(isWriteResult)) {
    throw badResponse(route);
  }
  return body.results;
}

/** `DELETE /v1/account`: removes the account, its tokens and every record on the server. */
export async function deleteAccount(token: string, options: CloudApiOptions = {}): Promise<void> {
  await send({ method: 'DELETE', path: '/v1/account', token }, options);
}
