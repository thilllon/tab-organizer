import { THE_MARVELLOUS_SUSPENDER_EXTENSION_ID } from '@/sessions/capture';
import type { DuplicateTabHandling, GroupFrom, GroupingMode, SortBy, SortSettings } from '@/types';

/**
 * Pure rules behind the Options page's sort settings (`chrome.storage.sync`). The component stays
 * thin: everything that decides what a stored or typed-in value means — and therefore what the
 * "Save" button writes — is decided here and unit-tested (AGENTS.md "Testing": vitest runs without
 * a DOM, so the React components themselves are not tested).
 */

/**
 * Mirrors `DEFAULT_SETTINGS` in `src/background/index.ts`, the object the sort engine passes to
 * `chrome.storage.sync.get()` and so what it falls back to for a key that was never written. The
 * two must stay in step: a different default here would show a setting the engine does not apply.
 * `sort-settings.test.ts` pins the values.
 */
export const DEFAULT_SORT_SETTINGS: SortSettings = {
  sortBy: 'url',
  groupFrom: 'leftToRight',
  preserveOrderWithinGroups: false,
  groupSuspendedTabs: false,
  tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
  sortPinnedTabs: false,
  duplicateTabHandling: 'none',
  groupingMode: 'subdomain',
};

/** Every key the page reads on mount and writes on "Save" — the whole of `SortSettings`. */
export const SORT_SETTING_KEYS: readonly (keyof SortSettings)[] = [
  'sortBy',
  'groupFrom',
  'preserveOrderWithinGroups',
  'groupSuspendedTabs',
  'tabSuspenderExtensionId',
  'sortPinnedTabs',
  'duplicateTabHandling',
  'groupingMode',
];

export function isSortBy(value: unknown): value is SortBy {
  return value === 'url' || value === 'title' || value === 'custom';
}

export function isGroupFrom(value: unknown): value is GroupFrom {
  return value === 'leftToRight' || value === 'rightToLeft';
}

export function isDuplicateTabHandling(value: unknown): value is DuplicateTabHandling {
  return value === 'none' || value === 'closeAllButOne' || value === 'group';
}

export function isGroupingMode(value: unknown): value is GroupingMode {
  return value === 'subdomain' || value === 'domain';
}

/** A Chrome extension id: exactly 32 characters from the alphabet a–p, lower case. */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function isExtensionId(value: string): boolean {
  return EXTENSION_ID_PATTERN.test(value);
}

/**
 * What the suspender-id input currently holds:
 * - `'default'` — empty, i.e. "use the built-in default" (see `normalizeSuspenderId`);
 * - `'valid'` — a well-formed extension id;
 * - `'invalid'` — anything else; the page shows an error and blocks "Save" instead of writing an
 *   id that could never match a tab.
 */
export type SuspenderIdStatus = 'default' | 'valid' | 'invalid';

export function suspenderIdStatus(draft: string): SuspenderIdStatus {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return 'default';
  }
  return isExtensionId(trimmed) ? 'valid' : 'invalid';
}

/**
 * The id to store for a given input value: the trimmed text when it is a valid extension id, and
 * the default otherwise.
 *
 * An empty field means "use the default", and must resolve to the default id *before* it reaches
 * storage. `loadSuspendedPrefix()` (`src/sessions/capture.ts`, the sessions side) already falls
 * back to the default for an empty stored id, but the sort engine does not: it interpolates
 * whatever it read into `chrome-extension://<id>/suspended.html#`, so an empty or malformed id
 * there yields a prefix that matches no tab and silently disables suspended-tab handling.
 */
export function normalizeSuspenderId(draft: string): string {
  const trimmed = draft.trim();
  return isExtensionId(trimmed) ? trimmed : THE_MARVELLOUS_SUSPENDER_EXTENSION_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Reads the whole of `SortSettings` out of what `chrome.storage.sync.get()` returned. Every value
 * is validated on its own and falls back to its default, so a missing key, a key left behind by an
 * older version, or a hand-edited value can never put the page (or the "Save" it writes back) into
 * a state the sort engine cannot read.
 */
export function parseSortSettings(raw: unknown): SortSettings {
  const stored = isRecord(raw) ? raw : {};
  return {
    sortBy: isSortBy(stored.sortBy) ? stored.sortBy : DEFAULT_SORT_SETTINGS.sortBy,
    groupFrom: isGroupFrom(stored.groupFrom) ? stored.groupFrom : DEFAULT_SORT_SETTINGS.groupFrom,
    preserveOrderWithinGroups: parseBoolean(
      stored.preserveOrderWithinGroups,
      DEFAULT_SORT_SETTINGS.preserveOrderWithinGroups,
    ),
    groupSuspendedTabs: parseBoolean(
      stored.groupSuspendedTabs,
      DEFAULT_SORT_SETTINGS.groupSuspendedTabs,
    ),
    tabSuspenderExtensionId:
      typeof stored.tabSuspenderExtensionId === 'string'
        ? normalizeSuspenderId(stored.tabSuspenderExtensionId)
        : DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId,
    sortPinnedTabs: parseBoolean(stored.sortPinnedTabs, DEFAULT_SORT_SETTINGS.sortPinnedTabs),
    duplicateTabHandling: isDuplicateTabHandling(stored.duplicateTabHandling)
      ? stored.duplicateTabHandling
      : DEFAULT_SORT_SETTINGS.duplicateTabHandling,
    groupingMode: isGroupingMode(stored.groupingMode)
      ? stored.groupingMode
      : DEFAULT_SORT_SETTINGS.groupingMode,
  };
}

/**
 * The exact object "Save" writes. Only the suspender id needs resolving; the custom-only settings
 * are stored as they are even under "By URL"/"By title" — the engine ignores them there, and
 * keeping them means switching back to "Custom grouping" restores the user's own choice.
 */
export function toStoredSortSettings(draft: SortSettings): SortSettings {
  return {
    ...draft,
    tabSuspenderExtensionId: normalizeSuspenderId(draft.tabSuspenderExtensionId),
  };
}

/**
 * The settings only `sortByCustom()` reads (`src/background/sort.ts`): `sortByTitleOrUrl()` is not
 * even passed them, so under "By URL"/"By title" they change nothing.
 */
export type CustomOnlySetting = 'groupFrom' | 'preserveOrderWithinGroups';

/** Which controls the page disables (rather than hides) for the selected sort mode. */
export function disabledSortControls(sortBy: SortBy): Record<CustomOnlySetting, boolean> {
  const customOnly = sortBy !== 'custom';
  return { groupFrom: customOnly, preserveOrderWithinGroups: customOnly };
}
