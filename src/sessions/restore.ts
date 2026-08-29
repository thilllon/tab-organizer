import type { Session, SessionSettings, WindowBounds, WindowSnapshot } from '@/types';

export const DEFAULT_CHUNK_SIZE = 25;
export const LAZY_AUTO_THRESHOLD = 50;
const MIN_WINDOW_SIDE = 200;

export interface SanitizeOptions {
  /** `chrome.runtime.id` — only our own chrome-extension:// pages may be restored. */
  ownExtensionId: string;
  /** Result of `chrome.extension.isAllowedFileSchemeAccess()`. */
  fileAccessAllowed: boolean;
  /** Suspender wrapper prefix, or '' when no suspender is configured. */
  suspendedPrefix: string;
  suspendedPrefixLen: number;
}

export type RestoreTarget = { kind: 'newWindows' } | { kind: 'window'; windowId: number };

export interface RestoreOptions {
  target: RestoreTarget;
  lazy: SessionSettings['restoreLazy'];
  chunkSize?: number;
  sanitize: SanitizeOptions;
}

export interface PlannedTab {
  url: string;
  pinned: boolean;
  active: boolean;
  groupIndex?: number;
}

export interface PlannedWindow {
  snapshot: WindowSnapshot;
  tabs: PlannedTab[];
  chunks: PlannedTab[][];
  lazy: boolean;
}

export interface RestorePlan {
  target: RestoreTarget;
  windows: PlannedWindow[];
  skipped: string[];
  totalTabs: number;
}

export interface RestoreResult {
  restored: number;
  skipped: string[];
  errors: { url: string; message: string }[];
}

export interface RestoreHooks {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  screen?: { availWidth: number; availHeight: number };
}

function unwrapSuspended(url: string, options: SanitizeOptions): string | null {
  if (options.suspendedPrefix === '' || !url.startsWith(options.suspendedPrefix)) {
    return url;
  }
  const params = new URLSearchParams(url.slice(options.suspendedPrefixLen));
  return params.get('uri');
}

/** Spec §6: returns the url to open, or null when it must be skipped. Never throws. */
export function sanitizeRestoreUrl(url: string, options: SanitizeOptions): string | null {
  const candidate = unwrapSuspended(url, options);
  if (candidate === null || candidate === '') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  switch (parsed.protocol) {
    case 'http:':
    case 'https:':
    case 'ftp:':
    case 'chrome:': {
      return candidate;
    }
    case 'about:': {
      return candidate === 'about:blank' ? candidate : null;
    }
    case 'chrome-extension:': {
      return parsed.hostname === options.ownExtensionId ? candidate : null;
    }
    case 'file:': {
      return options.fileAccessAllowed ? candidate : null;
    }
    default: {
      return null;
    }
  }
}

/** Intersects bounds with the available screen; undefined when less than 200x200 remains. */
export function clampToScreen(
  bounds: WindowBounds,
  screen: { availWidth: number; availHeight: number },
): WindowBounds | undefined {
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const right = Math.min(screen.availWidth, bounds.left + bounds.width);
  const bottom = Math.min(screen.availHeight, bounds.top + bounds.height);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_WINDOW_SIDE || height < MIN_WINDOW_SIDE) {
    return undefined;
  }
  return { left, top, width, height };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function planWindowTabs(
  snapshot: WindowSnapshot,
  sanitize: SanitizeOptions,
  skipped: string[],
): PlannedTab[] {
  const pinned: PlannedTab[] = [];
  const unpinned: PlannedTab[] = [];
  let activeCount = 0;

  for (const tab of snapshot.tabs) {
    if (tab.pinned && tab.groupIndex !== undefined) {
      throw new Error('Invariant violated: pinned tab has groupIndex');
    }
    if (tab.groupIndex !== undefined && tab.groupIndex >= snapshot.groups.length) {
      throw new Error('Invariant violated: groupIndex out of range');
    }
    if (tab.active) {
      activeCount += 1;
      if (activeCount > 1) {
        throw new Error('Invariant violated: more than one active tab');
      }
    }

    const url = sanitizeRestoreUrl(tab.url, sanitize);
    if (url === null) {
      skipped.push(tab.url);
      continue;
    }

    const planned: PlannedTab = { url, pinned: tab.pinned, active: tab.active };
    if (tab.groupIndex !== undefined) {
      planned.groupIndex = tab.groupIndex;
    }
    if (tab.pinned) {
      pinned.push(planned);
    } else {
      unpinned.push(planned);
    }
  }

  return [...pinned, ...unpinned];
}

/** Pure planner (spec §6). Throws on snapshot invariant violations; never calls chrome. */
export function planRestore(session: Session, options: RestoreOptions): RestorePlan {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  const skipped: string[] = [];
  const planned: { snapshot: WindowSnapshot; tabs: PlannedTab[] }[] = [];
  for (const snapshot of session.windows) {
    const tabs = planWindowTabs(snapshot, options.sanitize, skipped);
    if (tabs.length > 0) {
      planned.push({ snapshot, tabs });
    }
  }

  const totalTabs = planned.reduce((count, entry) => count + entry.tabs.length, 0);
  const lazy =
    options.lazy === 'always' || (options.lazy === 'auto' && totalTabs > LAZY_AUTO_THRESHOLD);

  return {
    target: options.target,
    windows: planned.map((entry) => ({
      snapshot: entry.snapshot,
      tabs: entry.tabs,
      chunks: chunk(entry.tabs, chunkSize),
      lazy,
    })),
    skipped,
    totalTabs,
  };
}

// ---------------------------------------------------------------------------
// executeRestore (Chrome calls; runs in the dashboard page, never in the SW)
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 100;

export function isTabsCannotBeEditedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.toLowerCase().includes('cannot be edited');
}

export async function withRetryOnce<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!shouldRetry(err)) {
      throw err;
    }
    await delay(RETRY_DELAY_MS);
    return fn();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

interface OpenedWindow {
  windowId: number;
  placeholderId: number | undefined;
}

function currentScreen(
  hooks: RestoreHooks,
): { availWidth: number; availHeight: number } | undefined {
  if (hooks.screen) {
    return hooks.screen;
  }
  if (typeof screen !== 'undefined') {
    return { availWidth: screen.availWidth, availHeight: screen.availHeight };
  }
  return undefined;
}

async function openTargetWindow(
  target: RestoreTarget,
  snapshot: WindowSnapshot,
  hooks: RestoreHooks,
): Promise<OpenedWindow> {
  if (target.kind === 'window') {
    return { windowId: target.windowId, placeholderId: undefined };
  }
  const createData: chrome.windows.CreateData = {
    url: 'about:blank',
    focused: false,
    state:
      snapshot.state === 'minimized' || snapshot.state === 'fullscreen' ? 'normal' : snapshot.state,
  };
  if (snapshot.state === 'normal' && snapshot.bounds) {
    const screenInfo = currentScreen(hooks);
    const bounds = screenInfo ? clampToScreen(snapshot.bounds, screenInfo) : snapshot.bounds;
    if (bounds) {
      createData.left = bounds.left;
      createData.top = bounds.top;
      createData.width = bounds.width;
      createData.height = bounds.height;
    }
  }
  let win: chrome.windows.Window | undefined;
  try {
    win = await chrome.windows.create(createData);
  } catch (err) {
    // Chrome refuses bounds it cannot honour (multi-monitor layouts changed, etc.): retry once
    // without left/top/width/height; anything else propagates to executeRestore's per-window catch.
    if (createData.left === undefined || !isBoundsError(err)) {
      throw err;
    }
    win = await chrome.windows.create({
      url: createData.url,
      focused: createData.focused,
      state: createData.state,
    });
  }
  if (win === undefined || win.id === undefined) {
    throw new Error('windows.create returned no window');
  }
  const placeholderId = win.tabs?.[0]?.id;
  return { windowId: win.id, placeholderId };
}

function isBoundsError(err: unknown): boolean {
  return errorMessage(err).toLowerCase().includes('bounds');
}

async function createChunk(
  chunk: PlannedTab[],
  windowId: number,
  errors: RestoreResult['errors'],
): Promise<(number | undefined)[]> {
  return Promise.all(
    chunk.map(async (tab) => {
      try {
        const created = await withRetryOnce(
          () => chrome.tabs.create({ windowId, url: tab.url, pinned: tab.pinned, active: false }),
          isTabsCannotBeEditedError,
        );
        return created.id;
      } catch (err) {
        errors.push({ url: tab.url, message: errorMessage(err) });
        return undefined;
      }
    }),
  );
}

/**
 * Discards the chunk's non-active, non-pinned tabs and returns the ids to keep using: Chrome may
 * replace a discarded tab (new id), and `tabs.discard` resolves with the tab that now exists.
 */
async function discardChunk(
  chunk: PlannedTab[],
  ids: (number | undefined)[],
): Promise<(number | undefined)[]> {
  const result = [...ids];
  for (let i = 0; i < chunk.length; i++) {
    const id = ids[i];
    const tab = chunk[i];
    if (id === undefined || tab.active || tab.pinned) {
      continue;
    }
    try {
      const discarded = await chrome.tabs.discard(id);
      result[i] = discarded?.id ?? id;
    } catch {
      // "still initializing" and friends: discarding is best-effort
    }
  }
  return result;
}

async function applyGroups(
  planned: PlannedWindow,
  created: (number | undefined)[],
  windowId: number,
): Promise<void> {
  const groupIds: (number | undefined)[] = [];
  for (let gi = 0; gi < planned.snapshot.groups.length; gi++) {
    const group = planned.snapshot.groups[gi];
    const ids = created.filter(
      (id, i): id is number => id !== undefined && planned.tabs[i]?.groupIndex === gi,
    );
    if (ids.length === 0) {
      groupIds.push(undefined);
      continue;
    }
    const tabIds: [number, ...number[]] = [ids[0], ...ids.slice(1)];
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
    groupIds.push(groupId);
  }
  // Collapse last: the placeholder is still the active tab, so collapsing cannot hit the active tab.
  for (let gi = 0; gi < groupIds.length; gi++) {
    const groupId = groupIds[gi];
    if (groupId === undefined) {
      continue;
    }
    await chrome.tabGroups.update(groupId, { collapsed: planned.snapshot.groups[gi].collapsed });
  }
}

async function finishWindow(
  plan: RestorePlan,
  planned: PlannedWindow,
  created: (number | undefined)[],
  opened: OpenedWindow,
): Promise<void> {
  const activeIndex = planned.tabs.findIndex((tab) => tab.active);
  const activeId = created[activeIndex] ?? created.find((id) => id !== undefined);
  if (plan.target.kind === 'newWindows' && activeId !== undefined) {
    await chrome.tabs.update(activeId, { active: true });
  }
  if (opened.placeholderId !== undefined) {
    try {
      await chrome.tabs.remove(opened.placeholderId);
    } catch {
      // already gone
    }
  }
  const state = planned.snapshot.state;
  if (plan.target.kind === 'newWindows' && (state === 'minimized' || state === 'fullscreen')) {
    try {
      await chrome.windows.update(opened.windowId, { state });
    } catch {
      // platform may refuse; the window still exists
    }
  }
}

export async function executeRestore(
  plan: RestorePlan,
  hooks: RestoreHooks = {},
): Promise<RestoreResult> {
  const errors: RestoreResult['errors'] = [];
  let restored = 0;
  let done = 0;
  let focusWindowId: number | undefined;
  let lastWindowId: number | undefined;

  for (const planned of plan.windows) {
    if (hooks.signal?.aborted) {
      break;
    }
    let opened: OpenedWindow;
    try {
      opened = await openTargetWindow(plan.target, planned.snapshot, hooks);
    } catch (err) {
      // Spec §6 "belt and braces": a failed windows.create costs this window only.
      for (const tab of planned.tabs) {
        errors.push({ url: tab.url, message: errorMessage(err) });
      }
      done += planned.tabs.length;
      hooks.onProgress?.(done, plan.totalTabs);
      continue;
    }
    const created: (number | undefined)[] = [];

    for (const chunk of planned.chunks) {
      const ids = await createChunk(chunk, opened.windowId, errors);
      created.push(...(planned.lazy ? await discardChunk(chunk, ids) : ids));
      done += chunk.length;
      hooks.onProgress?.(done, plan.totalTabs);
      if (hooks.signal?.aborted) {
        break;
      }
      await delay(0);
    }

    restored += created.filter((id) => id !== undefined).length;
    // Groups only after all tabs of this window exist (groups cannot be empty).
    await applyGroups(planned, created, opened.windowId);
    await finishWindow(plan, planned, created, opened);

    lastWindowId = opened.windowId;
    if (planned.snapshot.focused) {
      focusWindowId = opened.windowId;
    }
    if (hooks.signal?.aborted) {
      break;
    }
  }

  const toFocus = focusWindowId ?? lastWindowId;
  if (plan.target.kind === 'newWindows' && toFocus !== undefined) {
    try {
      await chrome.windows.update(toFocus, { focused: true });
    } catch {
      // window may have been closed by the user mid-restore
    }
  }

  return { restored, skipped: plan.skipped, errors };
}
