/**
 * Unwraps a tab-suspender wrapper url (The Marvellous Suspender / The Great Suspender).
 *
 * The wrapper is `<prefix>ttl=<encoded title>&pos=<n>&uri=<RAW url>`: the suspender appends the
 * original url raw (not percent-encoded) and last, and its own parser takes everything after the
 * `uri=` marker verbatim. Parsing the suffix with `URLSearchParams` instead silently corrupts the
 * real url -- it is cut at its first `&` (`?v=abc&list=PL123` -> `?v=abc`), `+` becomes a space,
 * and `%XX` escapes are decoded -- so this mirrors the suspender and returns the remainder as is.
 *
 * Returns `url` unchanged when it does not start with `suspendedPrefix` (or the prefix is empty),
 * and `null` when the wrapper has no `uri=` parameter or an empty one.
 */
export function unwrapSuspendedUrl(url: string, suspendedPrefix: string): string | null {
  if (suspendedPrefix === '' || !url.startsWith(suspendedPrefix)) {
    return url;
  }
  const suffix = url.slice(suspendedPrefix.length);
  // First `uri=` that starts a parameter (start of the suffix or right after `&`), so a title
  // that happens to contain "uri=" cannot hijack the lookup.
  const marker = /(?:^|&)uri=/.exec(suffix);
  if (marker === null) {
    return null;
  }
  const inner = suffix.slice(marker.index + marker[0].length);
  return inner === '' ? null : inner;
}
