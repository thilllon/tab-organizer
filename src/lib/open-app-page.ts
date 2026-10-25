/**
 * Opens Tab Organizer's app page as a singleton: focuses the existing tab (and its window) when
 * one is open, otherwise creates it. Used by the service worker (context menu, keyboard command).
 * The `*` on the query matches the page whatever view its hash points at.
 *
 * `hash` (a route such as `#settings`, see src/lib/app-route.ts) points the page at that view. An
 * open tab only has its fragment changed, which Chrome does without reloading the page: the app
 * follows it through `hashchange` and keeps the view behind (Settings is a dialog over it). A tab
 * already at that address is left as it is.
 */
export async function openDashboard(hash?: string): Promise<void> {
  const url = chrome.runtime.getURL('app.html');
  const target = hash === undefined ? url : `${url}${hash}`;
  const existing = await chrome.tabs.query({ url: `${url}*` });
  const tab = existing[0];

  if (tab?.id !== undefined) {
    const navigate = hash !== undefined && tab.url !== target;
    await chrome.tabs.update(tab.id, navigate ? { active: true, url: target } : { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: target, active: true });
}
