import { isSuspended } from '@/background/sort';
import type { GroupSnapshot, Session, TabSnapshot, WindowSnapshot } from '@/types';
import { contentHash } from './hash';
import { defaultSessionName } from './naming';
import { unwrapSuspendedUrl } from './suspender';

export interface CaptureOptions {
  /** `chrome.runtime.getURL('')` — tabs whose url starts with this are our own pages. */
  ownUrlPrefix: string;
  /** Suspender wrapper prefix (`chrome-extension://<id>/suspended.html#`), or '' when none. */
  suspendedPrefix: string;
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

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveTabUrl(tab: chrome.tabs.Tab, options: CaptureOptions): string | undefined {
  const raw = tab.pendingUrl ?? tab.url;
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (options.suspendedPrefix !== '' && isSuspended(tab, options.suspendedPrefix)) {
    // `isSuspended` matched `tab.url`, so that is the wrapper to unwrap (verbatim -- see
    // suspender.ts). A malformed wrapper (missing/empty/relative `uri`) keeps the tab on the raw
    // wrapper url rather than dropping it silently; `sanitizeRestoreUrl` (restore path) decides
    // what to do with a raw `chrome-extension://` url later.
    const inner = unwrapSuspendedUrl(tab.url ?? '', options.suspendedPrefix);
    return inner !== null && isAbsoluteUrl(inner) ? inner : raw;
  }
  return raw;
}

function isOwnPage(url: string, options: CaptureOptions): boolean {
  return options.ownUrlPrefix !== '' && url.startsWith(options.ownUrlPrefix);
}

/**
 * A captured window that still carries the Chrome runtime ids of its window, groups and tabs.
 * In-memory only, for the dashboard's live open-windows pane: `captureWindows()` — the only path
 * into a stored `Session` — strips every id first (spec §3: runtime ids are never persisted).
 */
export interface IdentifiedWindowSnapshot extends WindowSnapshot {
  windowId: number;
  groups: (GroupSnapshot & { groupId: number })[];
  tabs: (TabSnapshot & { tabId: number })[];
}

/** `IdentifiedWindowSnapshot` before the window id is known to exist (see `hasWindowId`). */
interface CapturedWindow extends Omit<IdentifiedWindowSnapshot, 'windowId'> {
  windowId?: number;
}

/** `chrome.tabs.TAB_ID_NONE` — a tab that is not a browser tab (devtools, ...) has no usable id. */
const NO_TAB_ID = -1;

function captureWindow(
  win: chrome.windows.Window,
  groupById: Map<number, chrome.tabGroups.TabGroup>,
  options: CaptureOptions,
): CapturedWindow | undefined {
  if (win.incognito) {
    return undefined;
  }
  if (win.type !== undefined && win.type !== 'normal') {
    return undefined;
  }

  const sourceTabs = [...(win.tabs ?? [])].sort((a, b) => a.index - b.index);
  const groups: CapturedWindow['groups'] = [];
  const groupIndexById = new Map<number, number>();
  const tabs: CapturedWindow['tabs'] = [];
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
    const snapshot: CapturedWindow['tabs'][number] = {
      url,
      title: tab.title ?? '',
      pinned: tab.pinned,
      active,
      tabId: tab.id ?? NO_TAB_ID,
    };

    if (!tab.pinned && tab.groupId !== undefined && tab.groupId !== -1) {
      const group = groupById.get(tab.groupId);
      if (group !== undefined) {
        let groupIndex = groupIndexById.get(group.id);
        if (groupIndex === undefined) {
          groupIndex = groups.length;
          groupIndexById.set(group.id, groupIndex);
          groups.push({
            title: group.title ?? '',
            color: group.color,
            collapsed: group.collapsed,
            groupId: group.id,
          });
        }
        snapshot.groupIndex = groupIndex;
      }
    }

    tabs.push(snapshot);
  }

  const state = toWindowState(win.state);
  const captured: CapturedWindow = { state, focused: win.focused, groups, tabs };
  if (win.id !== undefined) {
    captured.windowId = win.id;
  }
  if (
    state === 'normal' &&
    typeof win.left === 'number' &&
    typeof win.top === 'number' &&
    typeof win.width === 'number' &&
    typeof win.height === 'number'
  ) {
    captured.bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  }
  return captured;
}

function captureAll(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[],
  options: CaptureOptions,
): CapturedWindow[] {
  const groupById = new Map<number, chrome.tabGroups.TabGroup>();
  for (const group of groups) {
    groupById.set(group.id, group);
  }

  const result: CapturedWindow[] = [];
  for (const win of windows) {
    const captured = captureWindow(win, groupById, options);
    if (captured !== undefined) {
      result.push(captured);
    }
  }
  return result;
}

/** Drops `tabId`/`groupId` field by field — nothing that reaches storage may carry a runtime id. */
function stripRuntimeIds(captured: CapturedWindow): WindowSnapshot {
  const snapshot: WindowSnapshot = {
    state: captured.state,
    focused: captured.focused,
    groups: captured.groups.map((group) => ({
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    })),
    tabs: captured.tabs.map((tab) => {
      const plain: TabSnapshot = {
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned,
        active: tab.active,
      };
      if (tab.groupIndex !== undefined) {
        plain.groupIndex = tab.groupIndex;
      }
      return plain;
    }),
  };
  if (captured.bounds !== undefined) {
    snapshot.bounds = captured.bounds;
  }
  return snapshot;
}

function hasWindowId(captured: CapturedWindow): captured is IdentifiedWindowSnapshot {
  return captured.windowId !== undefined;
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
  return captureAll(windows, groups, options)
    .filter((captured) => captured.tabs.length > 0)
    .map(stripRuntimeIds);
}

/**
 * `captureWindows` with the runtime ids kept, for the dashboard's live pane (spec §12 Phase 2).
 *
 * Two deliberate differences from `captureWindows`:
 * - windows left with no capturable tabs are KEPT — for a capture there is nothing to save, but
 *   the pane must still show the window the dashboard itself lives in (all of whose tabs may be
 *   own extension pages) so it can be marked and acted on;
 * - a tab with no id is dropped: `populate: true` always supplies one, and a tab that has none
 *   could not be activated or closed anyway.
 */
export function captureWindowsWithIds(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[],
  options: CaptureOptions,
): IdentifiedWindowSnapshot[] {
  return captureAll(windows, groups, options)
    .filter(hasWindowId)
    .map((captured) => ({
      ...captured,
      tabs: captured.tabs.filter((tab) => tab.tabId !== NO_TAB_ID),
    }));
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
  return { ownUrlPrefix: chrome.runtime.getURL(''), suspendedPrefix: await loadSuspendedPrefix() };
}

/**
 * What to capture: the last-focused window, every window, or one window by its runtime id (the
 * open-windows pane's "Save this window", which must not depend on which window has focus).
 */
export type CaptureScope = 'window' | 'all' | { windowId: number };

/**
 * The one window `scope` selects, or undefined when it selects none — which for a single-window
 * scope means "capture nothing", never "capture everything" (`getLastFocused()` without an id).
 */
function scopeWindowId(scope: CaptureScope, lastFocusedId: number | undefined): number | undefined {
  return typeof scope === 'object' ? scope.windowId : lastFocusedId;
}

export async function captureSession(scope: CaptureScope, name?: string): Promise<Session> {
  const [allWindows, groups, focused, options] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
    loadCaptureOptions(),
  ]);

  const windows =
    scope === 'all'
      ? allWindows
      : allWindows.filter((w) => w.id !== undefined && w.id === scopeWindowId(scope, focused.id));

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
