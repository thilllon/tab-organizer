/**
 * Recognises and unwraps a tab suspender's placeholder page, whichever extension made it.
 *
 * The Great Suspender and its forks (The Marvellous Suspender, ...) replace a suspended tab's page
 * with `chrome-extension://<id>/suspended.html#ttl=<encoded title>&pos=<n>&uri=<RAW url>`. The
 * extension id differs from fork to fork, so a page is recognised by that shape rather than by one
 * configured id: an extension id (32 letters a-p, Chrome's alphabet for ids), the page
 * `suspended.html`, and a fragment holding a non-empty `uri=` parameter. A page of our own
 * extension is never a suspended tab, whatever its path.
 *
 * The suspender appends the original url raw (not percent-encoded) and last, and its own parser
 * takes everything after the `uri=` marker verbatim. Parsing the fragment with `URLSearchParams`
 * instead silently corrupts the real url - it is cut at its first `&` (`?v=abc&list=PL123` ->
 * `?v=abc`), `+` becomes a space, and `%XX` escapes are decoded - so the remainder is returned as
 * it is.
 *
 * This module is the one place that knows the format: sorting (`sort-order.ts`), capture
 * (`session-capture.ts`), the open-windows pane and the restore sanitiser (`session-restore.ts`)
 * all go through it.
 */

const SUSPENDED_PAGE = /^chrome-extension:\/\/([a-p]{32})\/suspended\.html#/;

/** Our own extension id, or `undefined` where there is no `chrome.runtime` to ask. */
function currentExtensionId(): string | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome.runtime?.id;
}

/**
 * The real url a suspended page stands for, or `null` when `url` is not one. The first `uri=` that
 * starts a parameter (start of the fragment or right after `&`) is the marker, so a title that
 * happens to contain "uri=" cannot hijack the lookup.
 */
function suspendedTarget(url: string, ownExtensionId: string | undefined): string | null {
  const page = SUSPENDED_PAGE.exec(url);
  if (page === null || page[1] === ownExtensionId) {
    return null;
  }
  const fragment = url.slice(page[0].length);
  const marker = /(?:^|&)uri=/.exec(fragment);
  if (marker === null) {
    return null;
  }
  const inner = fragment.slice(marker.index + marker[0].length);
  return inner === '' ? null : inner;
}

/**
 * Whether `url` is a tab suspender's placeholder page (see the module comment). `ownExtensionId`
 * defaults to `chrome.runtime.id`; tests pass it explicitly.
 */
export function isSuspendedUrl(
  url: string | undefined,
  ownExtensionId: string | undefined = currentExtensionId(),
): boolean {
  return url !== undefined && suspendedTarget(url, ownExtensionId) !== null;
}

/**
 * The real url behind a suspended page: the verbatim remainder after its first `uri=` parameter.
 * Any other url, including a `suspended.html` page without a `uri=`, comes back unchanged, so the
 * caller decides what a foreign `chrome-extension://` url means (capture keeps it, the restore
 * sanitiser skips it). The remainder is not checked to be a valid url.
 */
export function unwrapSuspendedUrl(
  url: string,
  ownExtensionId: string | undefined = currentExtensionId(),
): string {
  return suspendedTarget(url, ownExtensionId) ?? url;
}
