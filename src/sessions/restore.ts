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
