/**
 * Sorting the current window: what a click on the toolbar icon (or its shortcut) does. The event
 * listener that calls it lives in `src/service-worker.ts`; the pure ordering rules are in
 * `sort-order.ts` and `move-plan.ts`.
 */

import { isContiguous, type MoveBatch, planMoves } from '@/lib/move-plan';
import {
  findDuplicateTabs,
  hashStringToColor,
  sortByCustom,
  sortByTitleOrUrl,
} from '@/lib/sort-order';
import { DEFAULT_SORT_SETTINGS } from '@/lib/sort-settings';
import type { DuplicateTabHandling, SortSettings } from '@/types';

/*
 * Core sort orchestration
 */

/** What a click on the toolbar icon does: sorts the last-focused window. */
export async function sortTabGroups(): Promise<void> {
  const settings = await chrome.storage.sync.get<SortSettings>(DEFAULT_SORT_SETTINGS);

  const currentWindow = await chrome.windows.getLastFocused();

  const pinnedTabs = await chrome.tabs.query({
    windowId: currentWindow.id,
    pinned: true,
    currentWindow: true,
  });
  let groupOffset = pinnedTabs.length;

  if (pinnedTabs.length > 0 && settings.sortPinnedTabs) {
    await sortTabs(pinnedTabs, pinnedTabs[0].groupId, settings);
  }

  const tabGroups = await chrome.tabGroups.query({ windowId: currentWindow.id });

  // Sort tab groups by title (you can prefix names with numbers to override order)
  tabGroups.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));

  for (const tabGroup of tabGroups) {
    await chrome.tabGroups.move(tabGroup.id, { index: groupOffset });
    const color = hashStringToColor(tabGroup.title ?? '');
    await chrome.tabGroups.update(tabGroup.id, { color });
    const tabs = await chrome.tabs.query({
      windowId: currentWindow.id,
      groupId: tabGroup.id,
    });
    groupOffset += tabs.length;
    await sortTabs(tabs, tabGroup.id, settings);
  }

  // Sort ungrouped tabs
  const ungroupedTabs = await chrome.tabs.query({
    windowId: currentWindow.id,
    pinned: false,
    groupId: -1,
  });
  await sortTabs(ungroupedTabs, -1, settings);

  if (currentWindow.id !== undefined) {
    await handleDuplicateTabs(settings.duplicateTabHandling, currentWindow.id);
  }
}

async function sortTabs(
  tabs: chrome.tabs.Tab[],
  groupId: number,
  settings: SortSettings,
): Promise<void> {
  if (tabs.length === 0) {
    return;
  }

  // `tabSuspenderExtensionId` defaults to "The Marvellous Suspender" (DEFAULT_SORT_SETTINGS);
  // `loadSuspendedPrefix()` in session-capture.ts reads the same stored setting for sessions.
  const tabSuspenderExtensionId = settings.tabSuspenderExtensionId;
  const suspendedPrefix = `chrome-extension://${tabSuspenderExtensionId}/suspended.html#`;
  const suspendedPrefixLen = suspendedPrefix.length;

  const firstTabIndex = tabs[0].index;
  // The order on the strip right now; the sort functions below reorder `tabs` in place.
  const before = tabs.map((tab) => ({ id: tab.id, index: tab.index }));

  switch (settings.sortBy) {
    case 'url':
    case 'title':
      sortByTitleOrUrl(
        tabs,
        settings.sortBy,
        settings.groupSuspendedTabs,
        settings.sortPinnedTabs,
        suspendedPrefix,
        suspendedPrefixLen,
      );
      break;
    case 'custom':
      sortByCustom(
        tabs,
        settings.groupFrom,
        settings.groupSuspendedTabs,
        settings.preserveOrderWithinGroups,
        settings.sortPinnedTabs,
        settings.groupingMode,
        tabSuspenderExtensionId,
        suspendedPrefix,
        suspendedPrefixLen,
      );
      break;
  }

  const filteredIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
  if (filteredIds.length === 0) {
    return;
  }
  const tabIds: [number, ...number[]] = [filteredIds[0], ...filteredIds.slice(1)];

  // Only the tabs that are out of place move (see move-plan.ts). The plan counts positions from
  // the block's first tab, so it needs the block to be one unbroken run of known ids; anything
  // else gets the single whole-block call this always used to make.
  const beforeIds = before.map((tab) => tab.id).filter((id): id is number => id !== undefined);
  const plannable =
    beforeIds.length === before.length && isContiguous(before.map((tab) => tab.index));
  const batches: MoveBatch[] = plannable
    ? planMoves(beforeIds, filteredIds)
    : [{ tabIds, index: 0 }];

  for (const batch of batches) {
    await chrome.tabs.move(batch.tabIds, { index: firstTabIndex + batch.index });
  }
  // A tab moved to the edge of its group can drop out of it; one that did not move cannot.
  if (groupId > -1 && batches.length > 0) {
    await chrome.tabs.group({ groupId, tabIds });
  }
}

/*
 * Duplicate tab handling
 */

async function handleDuplicateTabs(
  duplicateHandling: DuplicateTabHandling,
  windowId: number,
): Promise<void> {
  if (duplicateHandling === 'none') {
    return;
  }

  const allTabs = await chrome.tabs.query({ windowId });
  const duplicates = findDuplicateTabs(allTabs);

  if (duplicateHandling === 'closeAllButOne') {
    for (const [_, tabs] of duplicates) {
      await closeDuplicateTabs(tabs);
    }
  } else if (duplicateHandling === 'group') {
    for (const [url, tabs] of duplicates) {
      await groupDuplicateTabs(url, tabs);
    }
  }
}

async function closeDuplicateTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
  const activeTab = tabs.find((tab) => tab.active);
  const tabToKeep = activeTab ?? tabs[0];

  const tabsToClose = tabs.filter((tab) => tab.id !== tabToKeep.id);
  const tabIdsToClose = tabsToClose
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined);

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }
}

async function groupDuplicateTabs(url: string, tabs: chrome.tabs.Tab[]): Promise<void> {
  const filteredIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);

  if (filteredIds.length < 2) {
    return;
  }

  const tabIds: [number, ...number[]] = [filteredIds[0], ...filteredIds.slice(1)];

  const groupId = await chrome.tabs.group({ tabIds });

  try {
    const urlObj = new URL(url);
    const groupTitle = `${urlObj.hostname} (${tabIds.length})`;
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      color: hashStringToColor(urlObj.hostname),
      collapsed: false,
    });
  } catch {
    const groupTitle = `Duplicates (${tabIds.length})`;
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      color: hashStringToColor(groupTitle),
    });
  }
}
