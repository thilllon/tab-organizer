import type { GoogleIdentity } from './types.js';

/** Google's token information endpoint. The token goes in a POST body, never in this URL. */
export const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** How long Google is given to answer before the sign-in fails with a 500. */
export const TOKENINFO_TIMEOUT_MS = 10_000;

export type VerifyGoogleToken = (accessToken: string) => Promise<GoogleIdentity | null>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Whether the token was issued to one of our OAuth clients. Google's answer for an access token
 * carries `aud` (the client the token is for) and usually `azp` (the client that asked for it);
 * for a Chrome extension client both are its client id. When `aud` is there it must be ours, even
 * if `azp` is: a token minted for another app's audience is refused whoever requested it. Only
 * when `aud` is absent does `azp` decide. Either way a token another app obtained for the same
 * Google account is refused, which is the point: without this check any site the person signed
 * in to with Google could replay its own access token here and act as them.
 */
export function issuedToUs(info: Record<string, unknown>, clientIds: readonly string[]): boolean {
  if (info.aud !== undefined) {
    return nonEmptyString(info.aud) && clientIds.includes(info.aud);
  }
  return nonEmptyString(info.azp) && clientIds.includes(info.azp);
}

/**
 * The identity in a tokeninfo answer, or null when it does not vouch for a live token issued to
 * one of our clients with a verified email. Pure.
 */
export function identityFromTokenInfo(
  info: unknown,
  clientIds: readonly string[],
): GoogleIdentity | null {
  if (typeof info !== 'object' || info === null || Array.isArray(info)) {
    return null;
  }
  const record = info as Record<string, unknown>;
  const verified = record.email_verified === true || record.email_verified === 'true';
  const expiresIn =
    typeof record.expires_in === 'number' ? record.expires_in : Number(record.expires_in);
  if (
    !issuedToUs(record, clientIds) ||
    !verified ||
    !nonEmptyString(record.email) ||
    !nonEmptyString(record.sub) ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return null;
  }
  return { sub: record.sub, email: record.email };
}

/**
 * Verifies a Google OAuth access token by asking Google about it (the tokeninfo endpoint, the
 * token in a form body). Returns null for a token Google refuses (a 4xx answer) or one that fails
 * `identityFromTokenInfo()`. A failure to reach Google, a 5xx or a timeout is thrown, so it
 * becomes a 500 rather than a false "unauthorized". The token is never logged.
 */
export function createGoogleVerifier(options: {
  clientIds: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
}): VerifyGoogleToken {
  const clientIds = [...options.clientIds];
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TOKENINFO_TIMEOUT_MS;
  return async (accessToken) => {
    if (clientIds.length === 0) {
      return null;
    }
    const response = await send(GOOGLE_TOKENINFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 400 && response.status < 500) {
      return null;
    }
    if (response.status !== 200) {
      throw new Error(`Google tokeninfo answered HTTP ${response.status}`);
    }
    let info: unknown;
    try {
      info = await response.json();
    } catch {
      throw new Error('Google tokeninfo answered with something other than JSON');
    }
    return identityFromTokenInfo(info, clientIds);
  };
}
