export type SortBy = 'url' | 'title' | 'custom';

export type GroupFrom = 'leftToRight' | 'rightToLeft';

export type DuplicateTabHandling = 'none' | 'closeAllButOne' | 'group';

export type GroupingMode = 'subdomain' | 'domain';

export interface SortSettings {
  sortBy: SortBy;
  groupFrom: GroupFrom;
  preserveOrderWithinGroups: boolean;
  groupSuspendedTabs: boolean;
  tabSuspenderExtensionId: string;
  sortPinnedTabs: boolean;
  duplicateTabHandling: DuplicateTabHandling;
  groupingMode: GroupingMode;
}

// ---------------------------------------------------------------------------
// Sessions (save / restore). Chrome runtime ids are never persisted.
// ---------------------------------------------------------------------------

export const SESSION_SCHEMA_VERSION = 1 as const;
export type SessionId = string; // crypto.randomUUID()
export type SessionKind = 'saved' | 'history';
export type SessionOrigin = 'manual' | 'alarm' | 'startup' | 'recovered' | 'import';
export type TabGroupColor = `${chrome.tabGroups.Color}`; // same form as hashStringToColor()

export interface TabSnapshot {
  url: string; // pendingUrl ?? url; suspender wrappers unwrapped via unwrapSuspendedUrl()
  title: string;
  pinned: boolean;
  active: boolean; // at most one true per window
  groupIndex?: number; // index into WindowSnapshot.groups; MUST be absent when pinned
}

export interface GroupSnapshot {
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowSnapshot {
  state: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
  focused: boolean;
  bounds?: WindowBounds; // only when state === 'normal'
  groups: GroupSnapshot[]; // first-appearance order
  tabs: TabSnapshot[]; // tab-strip order; pinned first (Chrome invariant)
}

export interface Session {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: SessionId;
  kind: SessionKind;
  name: string;
  origin: SessionOrigin;
  createdAt: number; // epoch ms
  updatedAt: number;
  protected?: boolean; // history only: exempt from pruning (recovered / user-pinned)
  /**
   * The `protected` flag above was set by `markRecovered()`, not by the user's Protect switch.
   * Crash recovery pins one snapshot per browser start, so without this marker the pins would
   * accumulate forever and no cleanup could tell them from a pin the user asked for. Any use of
   * the Protect switch clears it (`setProtected`), making the pin the user's for good; only
   * still-marked snapshots beyond the newest few are demoted back to prunable
   * (`demoteAutoProtected`). Never set on a `kind: 'saved'` session.
   */
  autoProtected?: boolean;
  contentHash?: string; // FNV-1a over windows->tabs (url, pinned, groupIndex, group title)
  windows: WindowSnapshot[]; // normal, non-incognito windows only; empty windows dropped
}

/**
 * Why the body behind an index entry cannot be read (spec §3). There is one reason today: the
 * record was written by a newer schema version than this build understands, so `migrateSession`
 * refuses it. `reconcile()` marks the entry instead of dropping it, so a store written by a newer
 * Tab Organizer and then opened by an older one still lists its sessions -- read-only, with an
 * explanation -- rather than showing an empty dashboard while the bodies sit on disk.
 */
export interface UnreadableSession {
  reason: 'unknown-schema';
  /** The `schemaVersion` found on the stored body; always > SESSION_SCHEMA_VERSION. */
  version: number;
}

export interface SessionSummary {
  // what the index holds
  id: SessionId;
  kind: SessionKind;
  name: string;
  origin: SessionOrigin;
  createdAt: number;
  updatedAt: number;
  protected?: boolean;
  autoProtected?: boolean; // `protected` came from crash recovery, not the user (see Session)
  contentHash?: string;
  windowCount: number;
  tabCount: number;
  bytes: number; // JSON length at last write
  /**
   * Set only by `reconcile()`, for a body this build cannot migrate. The row is rendered inert
   * (no restore / rename / export / expand, delete still available) and `windowCount`/`tabCount`
   * are not to be trusted -- nothing could read the body to count them.
   */
  unreadable?: UnreadableSession;
}

export interface SessionIndex {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessions: SessionSummary[]; // newest first
}

export interface SessionSettings {
  // chrome.storage.local key 'sessionSettings' (device-local; NOT sync)
  historyEnabled: boolean; // default true (owner decision)
  historyIntervalMinutes: 5 | 10 | 30; // default 5
  historyMaxSnapshots: number; // default 20 unprotected
  restoreLazy: 'auto' | 'always' | 'never'; // default 'auto' = discard when tabCount > 50
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  historyEnabled: true,
  historyIntervalMinutes: 5,
  historyMaxSnapshots: 20,
  restoreLazy: 'auto',
};

export type ExportFormat = 'json' | 'markdown' | 'text' | 'html' | 'csv';

export interface ExportBundle {
  app: 'tab-organizer';
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  exportedAt: number;
  sessions: Session[];
}
