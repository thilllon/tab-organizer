/** Spec §2: chrome://extensions/shortcuts may be opened from extension pages via tabs.create. */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

export async function openShortcutSettings(): Promise<void> {
  await chrome.tabs.create({ url: SHORTCUTS_URL });
}
