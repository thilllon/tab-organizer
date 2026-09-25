/**
 * Turning a row into a real `<a href>` — the two rules every such row needs.
 *
 * The point of the anchor is the browser's own affordances: the destination in the status bar at
 * the bottom left, ⌘/Ctrl-click and middle-click for a new tab, and "Copy link address" in the
 * context menu. None of that can be faked on a `<button>`.
 */

/**
 * Schemes allowed into an `href`.
 *
 * Deliberately far narrower than `sanitizeRestoreUrl()` (src/sessions/restore.ts), which also
 * passes `chrome:`, `file:`, `about:blank` and our own `chrome-extension:` because it feeds
 * `chrome.tabs.create`, an API that may go where a link may not. Two separate reasons to be
 * strict here:
 *
 * - Safety. A stored url is whatever the page had at capture time, `javascript:` and `data:`
 *   included. `chrome.tabs.create` gets that checked by the sanitiser; an `href` would not, and a
 *   `javascript:` link inside a page holding the `tabs` permission is the one thing that must
 *   never exist.
 * - Honesty. Chrome refuses to follow a link to `chrome://` or `file://` from an ordinary page, so
 *   an anchor pointing there looks clickable, previews in the status bar, and then does nothing on
 *   ⌘-click. A row that stays a button is better than a link that lies.
 *
 * Rows whose url is not linkable keep working exactly as before — `hrefFor` returns undefined and
 * the caller renders a button.
 */
const LINKABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** The url to put in `href`, or `undefined` when this row must not become a link. */
export function hrefFor(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return LINKABLE_PROTOCOLS.has(parsed.protocol) ? parsed.href : undefined;
}

export interface ClickModifiers {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * True when the browser should be left to handle the click itself.
 *
 * A plain left click keeps the app's own behaviour — jump to the live tab, or open the saved url
 * in a background tab — because that is what a tab manager is for, and letting the anchor navigate
 * would replace the app with the site. Every *modified* click is the user explicitly asking for
 * the browser's behaviour instead, so it is passed through: ⌘/Ctrl for a new tab, Shift for a new
 * window, Alt for whatever the platform maps it to.
 *
 * Middle-click needs no entry here in practice — Chrome raises `auxclick`, not `click`, so React's
 * `onClick` never sees it and the browser opens its new tab unimpeded. `button` is still checked so
 * the rule does not depend on that.
 */
export function browserHandlesClick(event: ClickModifiers): boolean {
  return (
    (event.button ?? 0) !== 0 ||
    event.metaKey === true ||
    event.ctrlKey === true ||
    event.shiftKey === true ||
    event.altKey === true
  );
}
