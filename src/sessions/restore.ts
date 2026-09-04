import type { Session, SessionSettings, WindowBounds, WindowSnapshot } from '@/types';
import { unwrapSuspendedUrl } from './suspender';

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
  /** Tabs left unloaded until clicked (lazy restore); always <= restored. */
  discarded: number;
  skipped: string[];
  errors: { url: string; message: string }[];
}

/**
 * The screen the dashboard is on, in virtual-desktop coordinates. `availLeft`/`availTop` are
 * non-standard (absent from lib.dom) but present in Chrome; see `screenRectOf`.
 */
export interface ScreenRect {
  availLeft?: number;
  availTop?: number;
  availWidth: number;
  availHeight: number;
}

/** Which window of the plan `executeRestore` is filling right now (0-based). */
export interface RestoreProgressWindow {
  index: number;
  count: number;
}

export interface RestoreHooks {
  /**
   * Called after every chunk (and once for a window that could not be opened) with the tabs done
   * so far. `window` says which window of the plan those tabs belong to, so the dashboard's toast
   * can show "Window 2 of 3"; a two-argument callback stays valid.
   */
  onProgress?: (done: number, total: number, window: RestoreProgressWindow) => void;
  signal?: AbortSignal;
  screen?: ScreenRect;
}

/** Spec §6: returns the url to open, or null when it must be skipped. Never throws. */
export function sanitizeRestoreUrl(url: string, options: SanitizeOptions): string | null {
  const candidate = unwrapSuspendedUrl(url, options.suspendedPrefix);
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

/**
 * Fits saved bounds to the screen the dashboard is on. Bounds are captured in virtual-desktop
 * coordinates, so a window from a secondary monitor has `left >= availWidth` or `left < 0` while
 * being perfectly visible there:
 * - bounds that intersect this screen by at least 200x200 are clamped into it (offset by
 *   `availLeft`/`availTop`, which are 0 when absent);
 * - bounds that do not intersect this screen at all are passed through unchanged. Chrome adjusts
 *   a window that would land entirely off every display onto the nearest one itself, so the
 *   window comes back on its own monitor while that monitor is attached and is still shown when
 *   it is not;
 * - a sliver (intersection under 200x200) or a window already smaller than 200x200 yields
 *   undefined: the caller omits the bounds and Chrome places the window.
 */
export function clampToScreen(bounds: WindowBounds, screen: ScreenRect): WindowBounds | undefined {
  if (bounds.width < MIN_WINDOW_SIDE || bounds.height < MIN_WINDOW_SIDE) {
    return undefined;
  }
  const screenLeft = screen.availLeft ?? 0;
  const screenTop = screen.availTop ?? 0;
  const left = Math.max(screenLeft, bounds.left);
  const top = Math.max(screenTop, bounds.top);
  const right = Math.min(screenLeft + screen.availWidth, bounds.left + bounds.width);
  const bottom = Math.min(screenTop + screen.availHeight, bounds.top + bounds.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return bounds;
  }
  if (width < MIN_WINDOW_SIDE || height < MIN_WINDOW_SIDE) {
    return undefined;
  }
  return { left, top, width, height };
}

function optionalNumber(source: object, key: string): number | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads a `Screen` into a `ScreenRect`. `availLeft`/`availTop` are read defensively: Chrome
 * exposes them (the screen's origin in the virtual desktop) but they are not standard, so a
 * runtime without them simply yields a screen at (0, 0).
 */
export function screenRectOf(source: Pick<Screen, 'availWidth' | 'availHeight'>): ScreenRect {
  const rect: ScreenRect = { availWidth: source.availWidth, availHeight: source.availHeight };
  const availLeft = optionalNumber(source, 'availLeft');
  const availTop = optionalNumber(source, 'availTop');
  if (availLeft !== undefined) {
    rect.availLeft = availLeft;
  }
  if (availTop !== undefined) {
    rect.availTop = availTop;
  }
  return rect;
}

/** Whether the `restoreLazy` setting discards tabs for a restore of `tabCount` tabs (spec §6). */
export function isLazyRestore(lazy: SessionSettings['restoreLazy'], tabCount: number): boolean {
  return lazy === 'always' || (lazy === 'auto' && tabCount > LAZY_AUTO_THRESHOLD);
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
  const lazy = isLazyRestore(options.lazy, totalTabs);

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
const DISCARD_COMMIT_TIMEOUT_MS = 5000;
const DISCARD_POLL_INTERVAL_MS = 50;

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

function currentScreen(hooks: RestoreHooks): ScreenRect | undefined {
  if (hooks.screen) {
    return hooks.screen;
  }
  if (typeof screen !== 'undefined') {
    return screenRectOf(screen);
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
  // Always created normal + unfocused; a non-'normal' snapshot state is applied post-hoc in
  // finishWindow(). Chrome (verified in Chrome for Testing 151) rejects windows.create with
  // "Invalid value for state" for `{ state: 'minimized', focused: true }`, for
  // `{ state: 'maximized' | 'fullscreen', focused: false }`, and for any non-'normal' state
  // combined with left/top/width/height -- so no non-'normal' state can be created here at all
  // without either stealing focus or losing the bounds.
  const createData: chrome.windows.CreateData = {
    url: 'about:blank',
    focused: false,
    state: 'normal',
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
 * Polls `tabs.get(tabId)` until the tab has a committed URL (Chrome moves the URL from
 * `pendingUrl` to `url` on commit; `status` may still be `'loading'`, which is fine) or
 * `DISCARD_COMMIT_TIMEOUT_MS` elapses. `tabs.discard` does NOT reject when called on a tab whose
 * navigation has not committed yet -- it silently unloads the tab with `url: ''`, permanently
 * losing the intended URL -- so the caller must never discard before this resolves `true`.
 * Resolves `false` as soon as `signal` aborts, so a cancel is honoured within one poll instead of
 * only once the timeout has run out.
 */
async function waitForCommit(tabId: number, signal: AbortSignal | undefined): Promise<boolean> {
  const maxAttempts = Math.ceil(DISCARD_COMMIT_TIMEOUT_MS / DISCARD_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      return false;
    }
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      // Tab is gone (closed by the user, replaced, ...): nothing left to wait for or discard.
      return false;
    }
    if (tab.url !== undefined && tab.url !== '') {
      return true;
    }
    if (attempt === maxAttempts) {
      return false;
    }
    await delay(DISCARD_POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Discards the chunk's non-active, non-pinned tabs and returns the ids to keep using: Chrome may
 * replace a discarded tab (new id), and `tabs.discard` resolves with the tab that now exists.
 *
 * Each tab is discarded only after its navigation has committed (see `waitForCommit`); a tab that
 * never commits within the timeout is left loading rather than risking a silent URL loss, and is
 * not treated as an error -- it is simply not lazy-restored. Tabs in a chunk navigate in parallel,
 * so the wait-then-discard runs concurrently per tab too, keeping the returned ids in order.
 * `discarded` counts the tabs actually unloaded, for the result toast.
 */
async function discardChunk(
  chunk: PlannedTab[],
  ids: (number | undefined)[],
  signal: AbortSignal | undefined,
): Promise<{ ids: (number | undefined)[]; discarded: number }> {
  const result = [...ids];
  let discarded = 0;
  await Promise.all(
    chunk.map(async (tab, i) => {
      const id = ids[i];
      if (id === undefined || tab.active || tab.pinned) {
        return;
      }
      if (!(await waitForCommit(id, signal))) {
        return;
      }
      try {
        const replacement = await chrome.tabs.discard(id);
        result[i] = replacement?.id ?? id;
        discarded += 1;
      } catch {
        // "still initializing" and friends: discarding is best-effort
      }
    }),
  );
  return { ids: result, discarded };
}

/**
 * Groups and styles this window's tabs (spec §13 group-after-all-tabs). A rejection from
 * `tabs.group`/`tabGroups.update` costs only that group: one `errors` entry, and the rest of the
 * window (and the rest of the restore) still proceeds. `tabs.group` gets the same drag-lock retry
 * as `tabs.create`, since Chrome raises "cannot be edited" there too.
 */
async function applyGroups(
  planned: PlannedWindow,
  created: (number | undefined)[],
  windowId: number,
  errors: RestoreResult['errors'],
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
    try {
      const groupId = await withRetryOnce(
        () => chrome.tabs.group({ tabIds, createProperties: { windowId } }),
        isTabsCannotBeEditedError,
      );
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
      groupIds.push(groupId);
    } catch (err) {
      errors.push({ url: `group:${group.title}`, message: errorMessage(err) });
      groupIds.push(undefined);
    }
  }
  // Collapse last: the placeholder is still the active tab, so collapsing cannot hit the active tab.
  for (let gi = 0; gi < groupIds.length; gi++) {
    const groupId = groupIds[gi];
    if (groupId === undefined) {
      continue;
    }
    try {
      await chrome.tabGroups.update(groupId, { collapsed: planned.snapshot.groups[gi].collapsed });
    } catch (err) {
      errors.push({
        url: `group:${planned.snapshot.groups[gi].title}`,
        message: errorMessage(err),
      });
    }
  }
}

/**
 * Activates the snapshot's active tab, removes the `about:blank` placeholder, and applies
 * minimized/maximized/fullscreen post-hoc (see `openTargetWindow`: `windows.create` cannot take
 * any of them). Activation and the post-hoc state change are each best-effort:
 * a rejection (e.g. the user closed the just-restored active tab) costs one `errors` entry and
 * never blocks placeholder removal or the rest of the restore.
 */
async function finishWindow(
  plan: RestorePlan,
  planned: PlannedWindow,
  created: (number | undefined)[],
  opened: OpenedWindow,
  errors: RestoreResult['errors'],
): Promise<void> {
  const activeIndex = planned.tabs.findIndex((tab) => tab.active);
  const activeId = created[activeIndex] ?? created.find((id) => id !== undefined);
  if (plan.target.kind === 'newWindows' && activeId !== undefined) {
    try {
      await chrome.tabs.update(activeId, { active: true });
    } catch (err) {
      errors.push({
        url: `activate:${planned.tabs[activeIndex]?.url ?? ''}`,
        message: errorMessage(err),
      });
    }
  }
  if (opened.placeholderId !== undefined) {
    try {
      await chrome.tabs.remove(opened.placeholderId);
    } catch {
      // already gone
    }
  }
  const state = planned.snapshot.state;
  if (plan.target.kind === 'newWindows' && state !== 'normal') {
    try {
      await chrome.windows.update(opened.windowId, { state });
    } catch (err) {
      errors.push({ url: `window-state:${state}`, message: errorMessage(err) });
    }
  }
}

export async function executeRestore(
  plan: RestorePlan,
  hooks: RestoreHooks = {},
): Promise<RestoreResult> {
  const errors: RestoreResult['errors'] = [];
  let restored = 0;
  let discarded = 0;
  let done = 0;
  let focusWindowId: number | undefined;
  let lastWindowId: number | undefined;

  for (const [windowIndex, planned] of plan.windows.entries()) {
    if (hooks.signal?.aborted) {
      break;
    }
    const windowProgress: RestoreProgressWindow = {
      index: windowIndex,
      count: plan.windows.length,
    };
    let opened: OpenedWindow;
    try {
      opened = await openTargetWindow(plan.target, planned.snapshot, hooks);
    } catch (err) {
      // Spec §6 "belt and braces": a failed windows.create costs this window only.
      for (const tab of planned.tabs) {
        errors.push({ url: tab.url, message: errorMessage(err) });
      }
      done += planned.tabs.length;
      hooks.onProgress?.(done, plan.totalTabs, windowProgress);
      continue;
    }
    const created: (number | undefined)[] = [];

    for (const chunk of planned.chunks) {
      const ids = await createChunk(chunk, opened.windowId, errors);
      if (planned.lazy) {
        const lazily = await discardChunk(chunk, ids, hooks.signal);
        created.push(...lazily.ids);
        discarded += lazily.discarded;
      } else {
        created.push(...ids);
      }
      done += chunk.length;
      hooks.onProgress?.(done, plan.totalTabs, windowProgress);
      if (hooks.signal?.aborted) {
        break;
      }
      await delay(0);
    }

    restored += created.filter((id) => id !== undefined).length;
    // Groups only after all tabs of this window exist (groups cannot be empty).
    await applyGroups(planned, created, opened.windowId, errors);
    await finishWindow(plan, planned, created, opened, errors);

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

  return { restored, discarded, skipped: plan.skipped, errors };
}
