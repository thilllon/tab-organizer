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

export function compareByUrlComponents(urlA: URL, urlB: URL): number {
  const keyA = urlA.hostname.replace(/^www\./i, '') + urlA.pathname + urlA.search + urlA.hash;
  const keyB = urlB.hostname.replace(/^www\./i, '') + urlB.pathname + urlB.search + urlB.hash;
  return keyA.localeCompare(keyB);
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
  const titleComparator = (a: chrome.tabs.Tab, b: chrome.tabs.Tab): number => {
    if (!sortPinnedTabs && (a.pinned || b.pinned)) {
      return 0;
    }
    if (groupSuspendedTabs) {
      if (isSuspended(a, suspendedPrefix) && !isSuspended(b, suspendedPrefix)) {
        return -1;
      }
      if (!isSuspended(a, suspendedPrefix) && isSuspended(b, suspendedPrefix)) {
        return 1;
      }
    }
    return (a.title ?? '').localeCompare(b.title ?? '');
  };

  const urlComparator = (a: chrome.tabs.Tab, b: chrome.tabs.Tab): number => {
    if (!sortPinnedTabs && (a.pinned || b.pinned)) {
      return 0;
    }
    if (groupSuspendedTabs) {
      if (isSuspended(a, suspendedPrefix) && !isSuspended(b, suspendedPrefix)) {
        return -1;
      }
      if (!isSuspended(a, suspendedPrefix) && isSuspended(b, suspendedPrefix)) {
        return 1;
      }
    }
    const urlA = tabToUrl(a, groupSuspendedTabs, suspendedPrefixLen);
    const urlB = tabToUrl(b, groupSuspendedTabs, suspendedPrefixLen);
    return compareByUrlComponents(urlA, urlB);
  };

  tabs.sort(sortBy === 'title' ? titleComparator : urlComparator);
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

  const customSortComparator = (
    a: chrome.tabs.Tab,
    b: chrome.tabs.Tab,
    gsSuspended: boolean,
    gsSortPinned?: boolean,
  ): number => {
    if (!gsSortPinned && (a.pinned || b.pinned)) {
      return 0;
    }
    if (gsSuspended) {
      if (isSuspended(a, suspendedPrefix) && !isSuspended(b, suspendedPrefix)) {
        return -1;
      }
      if (!isSuspended(a, suspendedPrefix) && isSuspended(b, suspendedPrefix)) {
        return 1;
      }
    }
    const urlA = tabToUrl(a, gsSuspended, suspendedPrefixLen);
    const urlB = tabToUrl(b, gsSuspended, suspendedPrefixLen);
    const groupPosA = tabGroupMap.get(extractGroupingKey(urlA.hostname, groupingMode));
    const groupPosB = tabGroupMap.get(extractGroupingKey(urlB.hostname, groupingMode));

    if (groupPosA !== undefined && groupPosB !== undefined) {
      if (groupFrom === 'leftToRight') {
        if (groupPosA < groupPosB) {
          return -1;
        }
        if (groupPosA > groupPosB) {
          return 1;
        }
      } else {
        if (groupPosA < groupPosB) {
          return 1;
        }
        if (groupPosA > groupPosB) {
          return -1;
        }
      }
    }

    if (!gsSuspended && !preserveOrderWithinGroups) {
      return compareByUrlComponents(urlA, urlB);
    }
    return 0;
  };

  tabs.sort((a, b) => customSortComparator(a, b, groupSuspendedTabs, sortPinnedTabs));

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

    const suspendedTabs = tabs
      .slice(0, suspendedTabCount)
      .sort((a, b) => customSortComparator(a, b, false));
    const postSorted = tabs.slice(suspendedTabCount);
    tabs.length = 0;
    tabs.push(...suspendedTabs, ...postSorted);
  }
}
