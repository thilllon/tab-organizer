import { captureSession } from '@/sessions/capture';
import { migrateSession, UnknownSchemaVersionError } from '@/sessions/migrate';
import { openDashboard } from '@/sessions/open-dashboard';
import { sessionKey, sessionRepo, withLock } from '@/sessions/storage';

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

const SEPARATOR_ID = 'sessions-separator';
const BADGE_COLOR = '#16a34a';
const BADGE_CLEAR_MS = 2000;

export function showSavedBadge(): void {
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  void chrome.action.setBadgeText({ text: '✓' });
  setTimeout(clearBadge, BADGE_CLEAR_MS);
}

export function clearBadge(): void {
  void chrome.action.setBadgeText({ text: '' });
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
  const session = await captureSession(scope);
  if (session.windows.length === 0) {
    // Nothing capturable (e.g. only the dashboard is open): no badge, no empty session.
    return;
  }
  await sessionRepo.put(session);
  showSavedBadge();
}

export async function handleMenuOrCommand(id: string): Promise<void> {
  clearBadge();
  switch (id) {
    case MENU_IDS.saveWindow:
    case 'save-session':
      await saveSession('window');
      return;
    case MENU_IDS.saveAll:
      await saveSession('all');
      return;
    case MENU_IDS.openDashboard:
      await openDashboard();
      return;
    default:
      return;
  }
}

/**
 * Eager migration on extension update: one key at a time under the lock. For schema v1 this is
 * the identity, so nothing is rewritten; newer records stay untouched (the UI shows them
 * read-only).
 */
async function migrateStoredSessions(): Promise<void> {
  const summaries = await sessionRepo.listSummaries();
  for (const summary of summaries) {
    await withLock(async () => {
      const key = sessionKey(summary.id);
      const raw = await chrome.storage.local.get(key);
      const record: unknown = raw[key];
      if (record === undefined) {
        return;
      }
      try {
        const migrated = migrateSession(record);
        if (JSON.stringify(migrated) !== JSON.stringify(record)) {
          await chrome.storage.local.set({ [key]: migrated });
        }
      } catch (err) {
        if (err instanceof UnknownSchemaVersionError) {
          return;
        }
        throw err;
      }
    });
  }
}

async function onInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  await registerContextMenus();
  await sessionRepo.reconcile();
  if (details.reason === 'update') {
    await migrateStoredSessions();
  }
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
