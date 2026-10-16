import type { GroupFrom, GroupingMode, SortBy } from '@/types';

const TAB_GROUP_COLORS: `${chrome.tabGroups.Color}`[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

export function hashStringToColor(str: string): `${chrome.tabGroups.Color}` {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return TAB_GROUP_COLORS[Math.abs(hash) % TAB_GROUP_COLORS.length];
}

/**
 * One collator for every text comparison in a sort. `collator.compare(a, b)` is by definition what
 * `a.localeCompare(b)` returns with no arguments — the same default locale and options — without
 * resolving them again on each of the n·log n comparisons.
 */
const collator = new Intl.Collator();

/** The text a url sorts by: hostname without `www.`, then path, query and fragment. */
export function urlSortKey(url: URL): string {
  return url.hostname.replace(/^www\./i, '') + url.pathname + url.search + url.hash;
}

export function compareByUrlComponents(urlA: URL, urlB: URL): number {
  return collator.compare(urlSortKey(urlA), urlSortKey(urlB));
}

/**
 * A stable sort that derives each item's key exactly once, then compares keys only. The sorts
 * below used to parse both urls inside the comparator, so a tab's url was parsed once per
 * comparison it took part in rather than once. Returns a new array; `items` is left alone.
 */
export function sortedByKey<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
  compare: (a: K, b: K) => number,
): T[] {
  return items
    .map((item) => ({ item, key: keyOf(item) }))
    .sort((a, b) => compare(a.key, b.key))
    .map((entry) => entry.item);
}

/** What one tab contributes to a comparison, worked out once per tab. */
interface TabSortKey {
  pinned: boolean;
  /** Only ever `true` while suspended tabs are being kept together. */
  suspended: boolean;
  /** Position of the tab's host group (custom sorting only). */
  groupPos?: number;
  text: string;
}

/**
 * The part every sort mode shares: pinned tabs hold their place unless they are being sorted, and
 * suspended tabs come first while they are kept together. `undefined` means "not decided here".
 */
function compareHeldAndSuspended(
  a: TabSortKey,
  b: TabSortKey,
  sortPinnedTabs: boolean,
): number | undefined {
  if (!sortPinnedTabs && (a.pinned || b.pinned)) {
    return 0;
  }
  if (a.suspended !== b.suspended) {
    return a.suspended ? -1 : 1;
  }
  return undefined;
}

/** The sorts' contract is to reorder the array they were given. */
function replaceContents<T>(target: T[], next: readonly T[]): void {
  target.splice(0, target.length, ...next);
}

export function extractGroupingKey(hostname: string, mode: GroupingMode): string {
  if (mode === 'subdomain') {
    return hostname;
  }
  const parts = hostname.split('.');
  const knownSecondLevel = ['co', 'com', 'org', 'net', 'edu', 'gov', 'ac'];
  if (parts.length >= 3 && knownSecondLevel.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isSuspended(tab: chrome.tabs.Tab, suspendedPrefix: string): boolean {
  return !!tab.url?.startsWith(suspendedPrefix);
}

/**
 * Where a tab with no usable url sorts. Chrome hands us `url: ''` with no `pendingUrl` for a tab
 * that has not committed a navigation yet, and `new URL('')` throws — which would abort the whole
 * sort. Every real key `compareByUrlComponents` builds is lowercase ASCII (Chrome punycodes
 * hostnames and percent-encodes the rest), so a host of `z`s collates after all of them: unknown
 * tabs land together at the end, and `.invalid` (RFC 6761) can never be a real host.
 */
const UNKNOWN_TAB_URL = 'https://zzzzzzzzzzzzzzzz.invalid/';

/** `new URL(raw)`, or the sentinel when `raw` is empty/absent — `tabToUrl` must never throw. */
function toUrlOrUnknown(raw: string | undefined): URL {
  if (raw === undefined || raw === '') {
    return new URL(UNKNOWN_TAB_URL);
  }
  try {
    return new URL(raw);
  } catch {
    return new URL(UNKNOWN_TAB_URL);
  }
}

export function tabToUrl(
  tab: chrome.tabs.Tab,
  groupSuspendedTabs: boolean,
  suspendedPrefixLen: number,
): URL {
  // A still-loading tab reports `url: ''` and its destination in `pendingUrl`, so both exits
  // resolve the url the same way: without this the same tab sorted two different ways (and threw)
  // depending on `groupSuspendedTabs`.
  const tabUrl = tab.pendingUrl === undefined || tab.pendingUrl === '' ? tab.url : tab.pendingUrl;

  if (groupSuspendedTabs) {
    return toUrlOrUnknown(tabUrl);
  }

  const suspendedSuffix = tab.url?.slice(suspendedPrefixLen);
  if (suspendedSuffix) {
    const params = new URLSearchParams(suspendedSuffix);
    for (const [param, val] of params) {
      if (param === 'uri') {
        return toUrlOrUnknown(val);
      }
    }
  }
  return toUrlOrUnknown(tabUrl);
}

export function updateTabGroupMap(
  tabGroupMap: Map<string, number>,
  tab: chrome.tabs.Tab,
  sortBy: string,
  groupSuspendedTabs: boolean,
  groupingMode: GroupingMode,
  suspendedPrefixLen: number,
): void {
  if (sortBy === 'title') {
    const title = tab.title ?? '';
    if (!tabGroupMap.has(title)) {
      tabGroupMap.set(title, tabGroupMap.size);
    }
  } else {
    const urlParser = tabToUrl(tab, groupSuspendedTabs, suspendedPrefixLen);
    const host = extractGroupingKey(urlParser.hostname, groupingMode);
    if (!tabGroupMap.has(host)) {
      tabGroupMap.set(host, tabGroupMap.size);
    }
  }
}

export function findDuplicateTabs(tabs: chrome.tabs.Tab[]): Map<string, chrome.tabs.Tab[]> {
  const urlMap = new Map<string, chrome.tabs.Tab[]>();

  for (const tab of tabs) {
    const url = tab.url ?? tab.pendingUrl;
    if (!url) {
      continue;
    }

    const existingTabs = urlMap.get(url);
    if (existingTabs) {
      existingTabs.push(tab);
    } else {
      urlMap.set(url, [tab]);
    }
  }

  const duplicates = new Map<string, chrome.tabs.Tab[]>();
  for (const [url, tabList] of urlMap) {
    if (tabList.length > 1) {
      duplicates.set(url, tabList);
    }
  }

  return duplicates;
}

export function sortByTitleOrUrl(
  tabs: chrome.tabs.Tab[],
  sortBy: SortBy,
  groupSuspendedTabs: boolean,
  sortPinnedTabs: boolean,
  suspendedPrefix: string,
  suspendedPrefixLen: number,
): void {
  const keyOf = (tab: chrome.tabs.Tab): TabSortKey => ({
    pinned: tab.pinned,
    suspended: groupSuspendedTabs && isSuspended(tab, suspendedPrefix),
    text:
      sortBy === 'title'
        ? (tab.title ?? '')
        : urlSortKey(tabToUrl(tab, groupSuspendedTabs, suspendedPrefixLen)),
  });
  const compare = (a: TabSortKey, b: TabSortKey): number =>
    compareHeldAndSuspended(a, b, sortPinnedTabs) ?? collator.compare(a.text, b.text);

  replaceContents(tabs, sortedByKey(tabs, keyOf, compare));
}

export function sortByCustom(
  tabs: chrome.tabs.Tab[],
  groupFrom: GroupFrom,
  groupSuspendedTabs: boolean,
  preserveOrderWithinGroups: boolean,
  sortPinnedTabs: boolean,
  groupingMode: GroupingMode,
  tabSuspenderExtensionId: string,
  suspendedPrefix: string,
  suspendedPrefixLen: number,
): void {
  const tabGroupMap = new Map<string, number>();
  let left = 0;
  let suspendedTabCount = 0;
  let right = tabs.length;

  if (groupFrom === 'leftToRight') {
    if (groupSuspendedTabs) {
      tabGroupMap.set(tabSuspenderExtensionId, 0);
    }
    while (left !== right) {
      if (isSuspended(tabs[left], suspendedPrefix)) {
        suspendedTabCount += 1;
      }
      updateTabGroupMap(
        tabGroupMap,
        tabs[left],
        'custom',
        groupSuspendedTabs,
        groupingMode,
        suspendedPrefixLen,
      );
      left += 1;
    }
  } else {
    while (left !== right) {
      right -= 1;
      if (isSuspended(tabs[right], suspendedPrefix)) {
        suspendedTabCount += 1;
      }
      updateTabGroupMap(
        tabGroupMap,
        tabs[right],
        'custom',
        groupSuspendedTabs,
        groupingMode,
        suspendedPrefixLen,
      );
    }
    if (groupSuspendedTabs) {
      tabGroupMap.set(tabSuspenderExtensionId, tabGroupMap.size);
    }
  }

  // `tabGroupMap` is read when a key is built, so each pass below sees the map as it is then.
  const keyOf =
    (gsSuspended: boolean) =>
    (tab: chrome.tabs.Tab): TabSortKey => {
      const url = tabToUrl(tab, gsSuspended, suspendedPrefixLen);
      return {
        pinned: tab.pinned,
        suspended: gsSuspended && isSuspended(tab, suspendedPrefix),
        groupPos: tabGroupMap.get(extractGroupingKey(url.hostname, groupingMode)),
        text: preserveOrderWithinGroups ? '' : urlSortKey(url),
      };
    };

  const compare =
    (gsSortPinned: boolean) =>
    (a: TabSortKey, b: TabSortKey): number => {
      const decided = compareHeldAndSuspended(a, b, gsSortPinned);
      if (decided !== undefined) {
        return decided;
      }
      if (a.groupPos !== undefined && b.groupPos !== undefined && a.groupPos !== b.groupPos) {
        return a.groupPos < b.groupPos === (groupFrom === 'leftToRight') ? -1 : 1;
      }
      // By here the pair is always same-partition (the suspended / normal split above decides
      // every cross-partition pair), so honouring `preserveOrderWithinGroups` cannot compare a
      // suspended tab against a normal one. The suspended block's order from the first pass is
      // discarded anyway -- it is re-sorted below with `gsSuspended = false`, which decodes each
      // tab's real target url.
      return preserveOrderWithinGroups ? 0 : collator.compare(a.text, b.text);
    };

  replaceContents(tabs, sortedByKey(tabs, keyOf(groupSuspendedTabs), compare(sortPinnedTabs)));

  // Sub-sort suspended tabs independently if groupSuspendedTabs is enabled
  if (groupSuspendedTabs) {
    tabGroupMap.clear();
    left = 0;
    right = suspendedTabCount;
    if (groupFrom === 'leftToRight') {
      while (left !== right) {
        updateTabGroupMap(
          tabGroupMap,
          tabs[left],
          'custom',
          false,
          groupingMode,
          suspendedPrefixLen,
        );
        left += 1;
      }
    } else {
      while (left !== right) {
        right -= 1;
        updateTabGroupMap(
          tabGroupMap,
          tabs[right],
          'custom',
          false,
          groupingMode,
          suspendedPrefixLen,
        );
      }
    }

    // Pinned tabs always hold their place in this pass, whatever `sortPinnedTabs` says.
    const suspendedTabs = sortedByKey(
      tabs.slice(0, suspendedTabCount),
      keyOf(false),
      compare(false),
    );
    const postSorted = tabs.slice(suspendedTabCount);
    replaceContents(tabs, [...suspendedTabs, ...postSorted]);
  }
}
