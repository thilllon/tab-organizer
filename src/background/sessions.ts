import { captureSession } from '@/sessions/capture';
import { openDashboard } from '@/sessions/open-dashboard';
import { sessionRepo } from '@/sessions/storage';

/**
 * Session-related service-worker listeners. Imported once from ./index.ts. Every listener is
 * registered synchronously at module top level (MV3 requirement). No tab/window listeners here —
 * ever (see AGENTS.md).
 */

export const MENU_IDS = {
  saveWindow: 'save-window',
  saveAll: 'save-all',
  openDashboard: 'open-dashboard',
} as const;

/**
 * Keyboard-command ids. These must stay in lockstep with the `commands` block of
 * `defineManifest()` in `vite.config.ts` — Chrome delivers exactly those strings to
 * `commands.onCommand`, and a rename on one side silently stops the shortcut working.
 * `openDashboard` deliberately shares its id with `MENU_IDS.openDashboard`.
 */
export const COMMAND_IDS = {
  saveSession: 'save-session',
  openDashboard: 'open-dashboard',
} as const;

const SEPARATOR_ID = 'sessions-separator';
const SAVED_BADGE_COLOR = '#16a34a';
const ERROR_BADGE_COLOR = '#d93025';
const BADGE_CLEAR_MS = 2000;

// The only timer in this module; re-armed (never stacked) so two saves in quick succession
// don't have the first save's clear cut off the second save's badge early.
let badgeTimer: ReturnType<typeof setTimeout> | undefined;

function armBadge(text: string, color: string): void {
  if (badgeTimer !== undefined) {
    clearTimeout(badgeTimer);
  }
  chrome.action.setBadgeBackgroundColor({ color }).catch(report);
  chrome.action.setBadgeText({ text }).catch(report);
  badgeTimer = setTimeout(clearBadge, BADGE_CLEAR_MS);
}

export function showSavedBadge(): void {
  armBadge('✓', SAVED_BADGE_COLOR);
}

export function showErrorBadge(): void {
  armBadge('!', ERROR_BADGE_COLOR);
}

export function clearBadge(): void {
  if (badgeTimer !== undefined) {
    clearTimeout(badgeTimer);
    badgeTimer = undefined;
  }
  chrome.action.setBadgeText({ text: '' }).catch(report);
}

export async function registerContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_IDS.saveWindow,
    title: 'Save this window as session',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: MENU_IDS.saveAll,
    title: 'Save all windows as session',
    contexts: ['action'],
  });
  chrome.contextMenus.create({ id: SEPARATOR_ID, type: 'separator', contexts: ['action'] });
  chrome.contextMenus.create({
    id: MENU_IDS.openDashboard,
    title: 'Open Sessions',
    contexts: ['action'],
  });
}

async function saveSession(scope: 'window' | 'all'): Promise<void> {
  try {
    const session = await captureSession(scope);
    if (session.windows.length === 0) {
      // Nothing capturable (e.g. only the dashboard, or an incognito window, is open).
      showErrorBadge();
      return;
    }
    await sessionRepo.put(session);
    showSavedBadge();
  } catch (err) {
    report(err);
    showErrorBadge();
  }
}

export async function handleMenuOrCommand(id: string): Promise<void> {
  clearBadge();
  switch (id) {
    case MENU_IDS.saveWindow:
    case COMMAND_IDS.saveSession:
      await saveSession('window');
      return;
    case MENU_IDS.saveAll:
      await saveSession('all');
      return;
    // Also `COMMAND_IDS.openDashboard`, which is the same id (one case, not two).
    case MENU_IDS.openDashboard:
      await openDashboard();
      return;
    default:
      return;
  }
}

async function onInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  await registerContextMenus();
  if (details.reason === 'update') {
    // Caught locally (not left to the listener's outer .catch) so a failed migration still
    // lets reconcile() run below.
    await sessionRepo.migrateAll().catch(report);
  }
  await sessionRepo.reconcile();
}

async function onStartup(): Promise<void> {
  clearBadge();
  await sessionRepo.reconcile();
}

function report(err: unknown): void {
  console.error('[tab-organizer:sessions]', err);
}

chrome.runtime.onInstalled.addListener((details) => {
  onInstalled(details).catch(report);
});

chrome.runtime.onStartup.addListener(() => {
  onStartup().catch(report);
});

chrome.contextMenus.onClicked.addListener((info) => {
  handleMenuOrCommand(String(info.menuItemId)).catch(report);
});

chrome.commands.onCommand.addListener((command) => {
  handleMenuOrCommand(command).catch(report);
});
