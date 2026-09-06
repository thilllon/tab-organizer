import type {
  ExportBundle,
  GroupSnapshot,
  Session,
  SessionKind,
  SessionOrigin,
  TabGroupColor,
  TabSnapshot,
  WindowBounds,
  WindowSnapshot,
} from '@/types';
import { SESSION_SCHEMA_VERSION } from '@/types';

/**
 * Hand-written type guards for data that arrives from outside the extension (pasted or
 * uploaded JSON). Tolerant of extra fields, strict on the required ones, and they check the
 * session invariants the restore planner relies on (see `isTabSnapshot` / `isWindowSnapshot`).
 */

/** A plain object: not `null` and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `Record<Union, true>` makes the compiler insist that every member of the union is listed,
// so a new Chrome colour / origin shows up as a type error here instead of a silent rejection.
const TAB_GROUP_COLORS: Record<TabGroupColor, true> = {
  blue: true,
  cyan: true,
  green: true,
  grey: true,
  orange: true,
  pink: true,
  purple: true,
  red: true,
  yellow: true,
};

const WINDOW_STATES: Record<WindowSnapshot['state'], true> = {
  normal: true,
  minimized: true,
  maximized: true,
  fullscreen: true,
};

const SESSION_KINDS: Record<SessionKind, true> = { saved: true, history: true };

const SESSION_ORIGINS: Record<SessionOrigin, true> = {
  manual: true,
  alarm: true,
  startup: true,
  recovered: true,
  import: true,
};

function isMember<T extends string>(table: Record<T, true>, value: unknown): value is T {
  return typeof value === 'string' && Object.hasOwn(table, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptional<T>(value: unknown, check: (candidate: unknown) => candidate is T): boolean {
  return value === undefined || check(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isArrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every((item) => check(item));
}

export function isTabSnapshot(value: unknown): value is TabSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const { url, title, pinned, active, groupIndex } = value;
  if (!isString(url) || !isString(title) || !isBoolean(pinned) || !isBoolean(active)) {
    return false;
  }
  if (groupIndex === undefined) {
    return true;
  }
  // Chrome cannot put a pinned tab in a group, so a pinned tab must not reference one.
  return (
    typeof groupIndex === 'number' && Number.isInteger(groupIndex) && groupIndex >= 0 && !pinned
  );
}

export function isGroupSnapshot(value: unknown): value is GroupSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const { title, color, collapsed } = value;
  return isString(title) && isMember(TAB_GROUP_COLORS, color) && isBoolean(collapsed);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!isRecord(value)) {
    return false;
  }
  const { left, top, width, height } = value;
  return (
    isFiniteNumber(left) && isFiniteNumber(top) && isFiniteNumber(width) && isFiniteNumber(height)
  );
}

export function isWindowSnapshot(value: unknown): value is WindowSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const { state, focused, bounds, groups, tabs } = value;
  if (
    !isMember(WINDOW_STATES, state) ||
    !isBoolean(focused) ||
    !isOptional(bounds, isWindowBounds) ||
    !isArrayOf(groups, isGroupSnapshot) ||
    !isArrayOf(tabs, isTabSnapshot)
  ) {
    return false;
  }
  // Invariants: every groupIndex points into `groups`; at most one active tab per window.
  let activeCount = 0;
  for (const tab of tabs) {
    if (tab.groupIndex !== undefined && tab.groupIndex >= groups.length) {
      return false;
    }
    if (tab.active) {
      activeCount += 1;
    }
  }
  return activeCount <= 1;
}

export function isSession(value: unknown): value is Session {
  if (!isRecord(value)) {
    return false;
  }
  const {
    schemaVersion,
    id,
    kind,
    name,
    origin,
    createdAt,
    updatedAt,
    protected: isProtected,
    contentHash,
    windows,
  } = value;
  return (
    schemaVersion === SESSION_SCHEMA_VERSION &&
    isString(id) &&
    isMember(SESSION_KINDS, kind) &&
    isString(name) &&
    isMember(SESSION_ORIGINS, origin) &&
    isFiniteNumber(createdAt) &&
    isFiniteNumber(updatedAt) &&
    isOptional(isProtected, isBoolean) &&
    isOptional(contentHash, isString) &&
    isArrayOf(windows, isWindowSnapshot)
  );
}

export function isExportBundle(value: unknown): value is ExportBundle {
  if (!isRecord(value)) {
    return false;
  }
  const { app, schemaVersion, exportedAt, sessions } = value;
  return (
    app === 'tab-organizer' &&
    schemaVersion === SESSION_SCHEMA_VERSION &&
    isFiniteNumber(exportedAt) &&
    isArrayOf(sessions, isSession)
  );
}
