import {
  matchSessionName,
  SEARCH_SOURCES,
  type SearchEntry,
  type SearchResult,
  type SearchSource,
} from '@/sessions/search';
import type { SessionSummary } from '@/types';

/** The tier-1 (session name) block plus the tier-2 sources, in the order they are rendered. */
export type SearchGroupSource = 'sessions' | SearchSource;

export const SEARCH_GROUP_HEADINGS: Record<SearchGroupSource, string> = {
  sessions: 'Matching sessions',
  open: 'Open tabs',
  saved: 'Saved sessions',
  history: 'History',
};

/** One activatable row: restore a whole session (tier 1), or open/focus one tab (tier 2). */
export type SearchItem =
  | { kind: 'session'; key: string; summary: SessionSummary }
  | { kind: 'tab'; key: string; entry: SearchEntry };

export interface SearchGroup {
  source: SearchGroupSource;
  heading: string;
  /** Every match in this source, including the ones cut off by the per-source limit. */
  count: number;
  hasMore: boolean;
  items: SearchItem[];
  /** Index of this group's first item in the flattened list — the keyboard highlight's index. */
  startIndex: number;
}

/**
 * Tier-1 matches: sessions whose *name* contains every token, answered from the index alone (no
 * body reads). History snapshots only take part while "Include history" is checked, exactly like
 * the tier-2 entries. Order is the index's (newest first).
 */
export function sessionNameMatches(
  summaries: readonly SessionSummary[],
  tokens: readonly string[],
  options: { includeHistory?: boolean } = {},
): SessionSummary[] {
  if (tokens.length === 0) {
    return [];
  }
  const includeHistory = options.includeHistory ?? false;
  return summaries.filter(
    (summary) =>
      (summary.kind !== 'history' || includeHistory) && matchSessionName(summary.name, [...tokens]),
  );
}

/**
 * A tab row's React key. Saved and history entries are addressed by session + position; an open
 * tab by its runtime id, which survives the tab moving inside its window (its position does not).
 */
function entryKey(entry: SearchEntry): string {
  if (entry.tabId !== undefined) {
    return `open:${String(entry.tabId)}`;
  }
  return `${entry.source}:${entry.sessionId ?? ''}:${String(entry.windowIndex)}:${String(entry.tabIndex)}`;
}

/**
 * The rendered result groups: the tier-1 session matches first, then open tabs, saved sessions
 * and history (`SEARCH_SOURCES` order). Empty groups are dropped, and `startIndex` gives each
 * group's offset into `flattenSearchItems()` so a row can address its own highlight index.
 */
export function buildSearchGroups(
  result: SearchResult,
  sessionMatches: readonly SessionSummary[] = [],
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  let startIndex = 0;

  const push = (
    source: SearchGroupSource,
    items: SearchItem[],
    count: number,
    hasMore: boolean,
  ) => {
    if (items.length === 0) {
      return;
    }
    groups.push({
      source,
      heading: SEARCH_GROUP_HEADINGS[source],
      count,
      hasMore,
      items,
      startIndex,
    });
    startIndex += items.length;
  };

  push(
    'sessions',
    sessionMatches.map((summary) => ({
      kind: 'session' as const,
      key: `session:${summary.id}`,
      summary,
    })),
    sessionMatches.length,
    false,
  );

  for (const source of SEARCH_SOURCES) {
    const bucket = result.bySource[source];
    push(
      source,
      bucket.entries.map((entry) => ({ kind: 'tab' as const, key: entryKey(entry), entry })),
      bucket.count,
      bucket.hasMore,
    );
  }
  return groups;
}

/** The groups' rows as one ordered list — the order ArrowDown / ArrowUp walk. */
export function flattenSearchItems(groups: readonly SearchGroup[]): SearchItem[] {
  return groups.flatMap((group) => group.items);
}

/** No row highlighted. `nextIndex` starts at the top from here, `prevIndex` at the bottom. */
export const NO_HIGHLIGHT = -1;

/** ArrowDown: the row after `current`, wrapping to the first; `NO_HIGHLIGHT` when there are none. */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) {
    return NO_HIGHLIGHT;
  }
  if (current < 0 || current >= length - 1) {
    return 0;
  }
  return current + 1;
}

/** ArrowUp: the row before `current`, wrapping to the last; `NO_HIGHLIGHT` when there are none. */
export function prevIndex(current: number, length: number): number {
  if (length <= 0) {
    return NO_HIGHLIGHT;
  }
  // `current` can also be past the end (the results shrank under a highlight): wrap to the last.
  if (current <= 0 || current > length - 1) {
    return length - 1;
  }
  return current - 1;
}

/** The shape of an event target this module needs; `HTMLElement` satisfies it structurally. */
export interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * True when a keystroke is already going into a field, so the `/` shortcut must leave it alone:
 * an `<input>`, `<textarea>` or `<select>`, or anything inside a contenteditable region.
 */
export function isEditableTarget(target: EditableTargetLike | null | undefined): boolean {
  if (target === null || target === undefined) {
    return false;
  }
  if (target.isContentEditable === true) {
    return true;
  }
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
