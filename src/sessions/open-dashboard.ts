/**
 * Opens the Sessions dashboard as a singleton: focuses the existing dashboard tab (and its
 * window) when one is open, otherwise creates it. Used by the service worker (context menu,
 * keyboard command) and by the options page.
 */
export async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url: `${url}*` });
  const tab = existing[0];

  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url, active: true });
}
