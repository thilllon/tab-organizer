/**
 * The app page is one page with hash routes, so every view has an address: the Settings view can
 * be opened from Chrome's own "Options" item, a session can be bookmarked, and the browser's Back
 * button walks the views. Hash routing (not the History API) because `hashchange` is the only
 * navigation signal an extension page gets for free, and `chrome-extension://` has no server to
 * resolve a path against.
 */

export type Route =
  | { view: 'open' }
  | { view: 'settings' }
  | { view: 'saved'; id: string }
  | { view: 'auto'; id: string }
  | { view: 'search'; query: string };

/** What an unknown, empty or malformed hash resolves to. */
export const HOME: Route = { view: 'open' };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A half-typed or hand-edited escape ("%E0") is a value, not a crash.
    return value;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '' || raw === 'open') {
    return HOME;
  }
  if (raw === 'settings') {
    return { view: 'settings' };
  }
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return HOME;
  }
  const head = raw.slice(0, slash);
  const tail = decode(raw.slice(slash + 1));
  if (tail === '') {
    return HOME;
  }
  if (head === 'saved') {
    return { view: 'saved', id: tail };
  }
  if (head === 'auto') {
    return { view: 'auto', id: tail };
  }
  if (head === 'search') {
    return { view: 'search', query: tail };
  }
  return HOME;
}

export function formatRoute(route: Route): string {
  switch (route.view) {
    case 'open':
      return '#open';
    case 'settings':
      return '#settings';
    case 'saved':
      return `#saved/${encodeURIComponent(route.id)}`;
    case 'auto':
      return `#auto/${encodeURIComponent(route.id)}`;
    case 'search':
      return `#search/${encodeURIComponent(route.query)}`;
  }
}

/** The id a session/snapshot route points at, or `undefined` for the other views. */
export function routeSessionId(route: Route): string | undefined {
  return route.view === 'saved' || route.view === 'auto' ? route.id : undefined;
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}
