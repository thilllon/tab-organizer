import { isSuspended, tabToUrl } from '@/background/sort';
import type { GroupSnapshot, Session, TabSnapshot, WindowSnapshot } from '@/types';
import { contentHash } from './hash';
import { defaultSessionName } from './naming';

export interface CaptureOptions {
  /** `chrome.runtime.getURL('')` — tabs whose url starts with this are our own pages. */
  ownUrlPrefix: string;
  /** Suspender wrapper prefix (`chrome-extension://<id>/suspended.html#`), or '' when none. */
  suspendedPrefix: string;
  suspendedPrefixLen: number;
}

function toWindowState(state: chrome.windows.Window['state']): WindowSnapshot['state'] {
  switch (state) {
    case 'minimized':
    case 'maximized':
    case 'fullscreen': {
      return state;
    }
    case 'locked-fullscreen': {
      return 'fullscreen';
    }
    default: {
      return 'normal';
    }
  }
}

function resolveTabUrl(tab: chrome.tabs.Tab, options: CaptureOptions): string | undefined {
  const raw = tab.pendingUrl ?? tab.url;
  if (options.suspendedPrefix !== '' && isSuspended(tab, options.suspendedPrefix)) {
    try {
      return tabToUrl(tab, false, options.suspendedPrefixLen).href;
    } catch {
      // Malformed suspended wrapper (empty/relative `uri`): keep the tab rather than
      // dropping it silently. `sanitizeRestoreUrl` (restore path) decides what to do
      // with a raw `chrome-extension://` url later.
      return raw === undefined || raw === '' ? undefined : raw;
    }
  }
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return raw;
}

function isOwnPage(url: string, options: CaptureOptions): boolean {
  return options.ownUrlPrefix !== '' && url.startsWith(options.ownUrlPrefix);
}

function captureWindow(
  win: chrome.windows.Window,
  groupById: Map<number, chrome.tabGroups.TabGroup>,
  options: CaptureOptions,
): WindowSnapshot | undefined {
  if (win.incognito) {
    return undefined;
  }
  if (win.type !== undefined && win.type !== 'normal') {
    return undefined;
  }

  const sourceTabs = [...(win.tabs ?? [])].sort((a, b) => a.index - b.index);
  const groups: GroupSnapshot[] = [];
  const groupIndexById = new Map<number, number>();
  const tabs: TabSnapshot[] = [];
  let activeSeen = false;

  for (const tab of sourceTabs) {
    const url = resolveTabUrl(tab, options);
    if (url === undefined || isOwnPage(url, options)) {
      continue;
    }

    const active = tab.active && !activeSeen;
    if (active) {
      activeSeen = true;
    }
    const snapshot: TabSnapshot = { url, title: tab.title ?? '', pinned: tab.pinned, active };

    if (!tab.pinned && tab.groupId !== undefined && tab.groupId !== -1) {
      const group = groupById.get(tab.groupId);
      if (group !== undefined) {
        let groupIndex = groupIndexById.get(group.id);
        if (groupIndex === undefined) {
          groupIndex = groups.length;
          groupIndexById.set(group.id, groupIndex);
          groups.push({ title: group.title ?? '', color: group.color, collapsed: group.collapsed });
        }
        snapshot.groupIndex = groupIndex;
      }
    }

    tabs.push(snapshot);
  }

  if (tabs.length === 0) {
    return undefined;
  }

  const state = toWindowState(win.state);
  const snapshot: WindowSnapshot = { state, focused: win.focused, groups, tabs };
  if (
    state === 'normal' &&
    typeof win.left === 'number' &&
    typeof win.top === 'number' &&
    typeof win.width === 'number' &&
    typeof win.height === 'number'
  ) {
    snapshot.bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  }
  return snapshot;
}

/**
 * Pure snapshot of populated windows (`windows.getAll({ populate: true })`).
 * Never copies Chrome runtime ids; groups are referenced by first-appearance index.
 */
export function captureWindows(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[],
  options: CaptureOptions,
): WindowSnapshot[] {
  const groupById = new Map<number, chrome.tabGroups.TabGroup>();
  for (const group of groups) {
    groupById.set(group.id, group);
  }

  const result: WindowSnapshot[] = [];
  for (const win of windows) {
    const snapshot = captureWindow(win, groupById, options);
    if (snapshot !== undefined) {
      result.push(snapshot);
    }
  }
  return result;
}

// Default to "The Marvellous Suspender", the same de facto default as src/background/index.ts.
// Shared with the dashboard (src/dashboard/lib/sanitize-options.ts imports both exports).
export const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID = 'noogafoofpebimajpfpamcfhoaifemoa';

/** `chrome-extension://<suspender id>/suspended.html#`, honouring the Options-page override. */
export async function loadSuspendedPrefix(): Promise<string> {
  const stored = await chrome.storage.sync.get<{ tabSuspenderExtensionId: string }>({
    tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
  });
  const suspenderId =
    typeof stored.tabSuspenderExtensionId === 'string' && stored.tabSuspenderExtensionId !== ''
      ? stored.tabSuspenderExtensionId
      : THE_MARVELLOUS_SUSPENDER_EXTENSION_ID;
  return `chrome-extension://${suspenderId}/suspended.html#`;
}

async function loadCaptureOptions(): Promise<CaptureOptions> {
  const suspendedPrefix = await loadSuspendedPrefix();
  return {
    ownUrlPrefix: chrome.runtime.getURL(''),
    suspendedPrefix,
    suspendedPrefixLen: suspendedPrefix.length,
  };
}

export async function captureSession(scope: 'window' | 'all', name?: string): Promise<Session> {
  const [allWindows, groups, focused, options] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
    loadCaptureOptions(),
  ]);

  const windows =
    scope === 'window'
      ? allWindows.filter((w) => w.id !== undefined && w.id === focused.id)
      : allWindows;

  const snapshots = captureWindows(windows, groups, options);
  const tabCount = snapshots.reduce((sum, w) => sum + w.tabs.length, 0);
  const now = Date.now();

  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind: 'saved',
    name: name ?? defaultSessionName(new Date(now), snapshots.length, tabCount),
    origin: 'manual',
    createdAt: now,
    updatedAt: now,
    contentHash: contentHash(snapshots),
    windows: snapshots,
  };
}
