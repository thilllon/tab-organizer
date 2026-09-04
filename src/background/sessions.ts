import { captureSession } from '@/sessions/capture';
import {
  ensureHistoryAlarm,
  HISTORY_ALARM,
  HISTORY_FIRST_ALARM,
  promoteRecoveredSnapshot,
  scheduleFirstSnapshot,
  takeHistorySnapshot,
} from '@/sessions/history';
import { ensureUniqueName } from '@/sessions/naming';
import { openDashboard } from '@/sessions/open-dashboard';
import { SETTINGS_KEY, sessionRepo } from '@/sessions/storage';

/**
 * Session-related service-worker listeners. Imported once from ./index.ts. Every listener is
 * registered synchronously at module top level (MV3 requirement). No tab/window listeners here —
 * ever (see AGENTS.md). History snapshots are driven by `chrome.alarms` only (spec §5), which is
 * why `'alarms'` sits in the manifest permissions: `chrome.alarms.onAlarm.addListener` below runs
 * while this module evaluates, and a missing permission would take the whole worker down.
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
    // Two saves in the same minute would otherwise share the default name.
    const names = (await sessionRepo.listSummaries()).map((summary) => summary.name);
    await sessionRepo.put({ ...session, name: ensureUniqueName(session.name, names) });
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
  // Chrome drops every alarm on extension update/reload, so the periodic history alarm is
  // re-asserted for all reasons (a no-op replace when it already exists).
  await ensureHistoryAlarm();
}

async function onStartup(): Promise<void> {
  clearBadge();
  await sessionRepo.reconcile();
  // Crash recovery first, so the last snapshot of the previous browser session is protected
  // before any new snapshot can push it out of the ring. Caught locally (like migrateAll above)
  // so a failed promotion still lets the alarms below be armed.
  await promoteRecoveredSnapshot().catch(report);
  const settings = await sessionRepo.getSettings();
  await ensureHistoryAlarm(settings);
  // One-shot 'history-first' 1 min out: Chrome is still restoring tabs while onStartup runs,
  // and a capture now would record half-loaded windows.
  await scheduleFirstSnapshot(settings);
}

/**
 * `alarms.onAlarm` handler. Both history alarms take an `origin: 'alarm'` snapshot;
 * `takeHistorySnapshot` itself returns `'disabled'` (without querying windows) when the user
 * turned history off after the alarm was scheduled, so no settings read is needed here.
 */
function onAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name !== HISTORY_ALARM && alarm.name !== HISTORY_FIRST_ALARM) {
    return;
  }
  takeHistorySnapshot({ origin: 'alarm' }).catch(report);
}

/**
 * Second `action.onClicked` listener (the first, in ./index.ts, is the sort — untouched). Runs
 * concurrently with the sort and is never awaited by it: the snapshot only needs the URLs, which
 * it captures before a `closeAllButOne` duplicate pass closes any (tab order may reflect an
 * in-progress sort — acceptable, recovery is about URLs). `takeHistorySnapshot` gates on
 * `historyEnabled` before touching any window, so a click costs one storage read while history is
 * off. Errors are reported, never thrown: the click must keep sorting no matter what.
 */
function onActionClicked(): void {
  // The badge is browser state, but the timer that clears it is worker state: a worker torn down
  // during those 2 s leaves a stale save/error badge on the icon indefinitely. Every other entry
  // point clears it first (`handleMenuOrCommand`, `onStartup`), so the icon click does too --
  // synchronously and without awaiting anything, leaving the sort in ./index.ts untouched.
  clearBadge();
  takeHistorySnapshot({ origin: 'manual' }).catch(report);
}

/**
 * `storage.onChanged` handler: a `sessionSettings` write from the dashboard or Options page
 * (history toggled, interval changed) re-arms or clears the alarms. The stored value is re-read
 * through `sessionRepo.getSettings()` rather than taken from `changes[...].newValue` so it goes
 * through the same normalisation (and default fallback when the key was removed) as every other
 * settings read.
 */
function onStorageChanged(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: chrome.storage.AreaName,
): void {
  if (areaName !== 'local' || !(SETTINGS_KEY in changes)) {
    return;
  }
  ensureHistoryAlarm().catch(report);
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

chrome.alarms.onAlarm.addListener(onAlarm);

chrome.action.onClicked.addListener(onActionClicked);

chrome.storage.onChanged.addListener(onStorageChanged);
