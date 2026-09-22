import { openTabInBackground } from '@/dashboard/lib/open-tab';
import { goToTab } from '@/dashboard/lib/window-actions';

/**
 * Clicking a tab in a saved session or a snapshot: a tab manager must not make tabs multiply, so
 * a page that is already open is brought forward instead of opened a second time. Matching is on
 * the exact stored URL — a saved `…/issues?page=2` is a different page from `…/issues`, and
 * guessing which query strings are "the same page" would surprise more often than it would help.
 */

/** The open tab to jump to, or `undefined` when this URL is not open anywhere. */
export function pickOpenTab(
  tabs: readonly chrome.tabs.Tab[],
  url: string,
): { tabId: number; windowId: number } | undefined {
  for (const tab of tabs) {
    if (tab.id === undefined || tab.windowId === undefined) {
      continue;
    }
    // A tab still loading reports its destination in `pendingUrl` and an empty `url`.
    const current = tab.url !== undefined && tab.url !== '' ? tab.url : tab.pendingUrl;
    if (current === url) {
      return { tabId: tab.id, windowId: tab.windowId };
    }
  }
  return undefined;
}

export type OpenSavedTabResult = { ok: true; switched: boolean } | { ok: false; reason: string };

export async function openSavedTab(url: string): Promise<OpenSavedTabResult> {
  let open: { tabId: number; windowId: number } | undefined;
  try {
    // No url filter: a match pattern cannot express "this exact URL, query string and all".
    open = pickOpenTab(await chrome.tabs.query({}), url);
  } catch {
    // Reading the tab list is a convenience here; failing it just means opening a new tab.
    open = undefined;
  }
  if (open === undefined) {
    const opened = await openTabInBackground(url);
    return opened.ok ? { ok: true, switched: false } : opened;
  }
  const jumped = await goToTab(open.tabId, open.windowId);
  return jumped.ok ? { ok: true, switched: true } : jumped;
}
