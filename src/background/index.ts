// Default to "The Marvellous Suspender" as the de facto The Great Suspender replacement
const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID = 'noogafoofpebimajpfpamcfhoaifemoa'

let tabSuspenderExtensionId = ''
let suspendedPrefix = `chrome-extension://${tabSuspenderExtensionId}/suspended.html#`
let suspendedPrefixLen = suspendedPrefix.length

// ---------- Types ----------

interface SortSettings {
  sortBy: 'url' | 'title' | 'custom'
  groupFrom: 'leftToRight' | 'rightToLeft'
  preserveOrderWithinGroups: boolean
  groupSuspendedTabs: boolean
  tabSuspenderExtensionId: string
  sortPinnedTabs: boolean
  duplicateTabHandling: 'none' | 'closeAllButOne' | 'group'
}

const DEFAULT_SETTINGS: SortSettings = {
  sortBy: 'url',
  groupFrom: 'leftToRight',
  preserveOrderWithinGroups: false,
  groupSuspendedTabs: false,
  tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
  sortPinnedTabs: false,
  duplicateTabHandling: 'none',
}

// ---------- Utility functions ----------

function isSuspended(tab: chrome.tabs.Tab): boolean {
  return !!tab.url?.startsWith(suspendedPrefix)
}

function tabToUrl(tab: chrome.tabs.Tab, groupSuspendedTabs: boolean): URL {
  if (groupSuspendedTabs) {
    return new URL(tab.url ?? '')
  }

  const suspendedSuffix = tab.url?.slice(suspendedPrefixLen)
  if (suspendedSuffix) {
    const params = new URLSearchParams(suspendedSuffix)
    for (const [param, val] of params) {
      if (param === 'uri') {
        return new URL(val)
      }
    }
  }
  return new URL(tab.pendingUrl ?? tab.url ?? '')
}

function updateTabGroupMap(
  tabGroupMap: Map<string, number>,
  tab: chrome.tabs.Tab,
  sortBy: string,
  groupSuspendedTabs: boolean,
): void {
  if (sortBy === 'title') {
    const title = tab.title ?? ''
    if (!tabGroupMap.has(title)) {
      tabGroupMap.set(title, tabGroupMap.size)
    }
  } else {
    const urlParser = tabToUrl(tab, groupSuspendedTabs)
    const host = urlParser.host
    if (!tabGroupMap.has(host)) {
      tabGroupMap.set(host, tabGroupMap.size)
    }
  }
}

function compareByUrlComponents(urlA: URL, urlB: URL): number {
  const keyA = urlA.hostname.replace(/^www\./i, '') + urlA.pathname + urlA.search + urlA.hash
  const keyB = urlB.hostname.replace(/^www\./i, '') + urlB.pathname + urlB.search + urlB.hash
  return keyA.localeCompare(keyB)
}

// ---------- Sort functions ----------

function sortByTitleOrUrl(
  tabs: chrome.tabs.Tab[],
  sortBy: 'title' | 'url',
  groupSuspendedTabs: boolean,
  sortPinnedTabs: boolean,
): void {
  const titleComparator = (a: chrome.tabs.Tab, b: chrome.tabs.Tab): number => {
    if (!sortPinnedTabs && (a.pinned || b.pinned)) return 0
    if (groupSuspendedTabs) {
      if (isSuspended(a) && !isSuspended(b)) return -1
      if (!isSuspended(a) && isSuspended(b)) return 1
    }
    return (a.title ?? '').localeCompare(b.title ?? '')
  }

  const urlComparator = (a: chrome.tabs.Tab, b: chrome.tabs.Tab): number => {
    if (!sortPinnedTabs && (a.pinned || b.pinned)) return 0
    if (groupSuspendedTabs) {
      if (isSuspended(a) && !isSuspended(b)) return -1
      if (!isSuspended(a) && isSuspended(b)) return 1
    }
    const urlA = tabToUrl(a, groupSuspendedTabs)
    const urlB = tabToUrl(b, groupSuspendedTabs)
    return compareByUrlComponents(urlA, urlB)
  }

  tabs.sort(sortBy === 'title' ? titleComparator : urlComparator)
}

function sortByCustom(
  tabs: chrome.tabs.Tab[],
  groupFrom: 'leftToRight' | 'rightToLeft',
  groupSuspendedTabs: boolean,
  preserveOrderWithinGroups: boolean,
  sortPinnedTabs: boolean,
): void {
  const tabGroupMap = new Map<string, number>()
  let left = 0
  let suspendedTabCount = 0
  let right = tabs.length

  if (groupFrom === 'leftToRight') {
    if (groupSuspendedTabs) {
      tabGroupMap.set(tabSuspenderExtensionId, 0)
    }
    while (left !== right) {
      if (isSuspended(tabs[left])) suspendedTabCount += 1
      updateTabGroupMap(tabGroupMap, tabs[left], 'custom', groupSuspendedTabs)
      left += 1
    }
  } else {
    while (left !== right) {
      right -= 1
      if (isSuspended(tabs[right])) suspendedTabCount += 1
      updateTabGroupMap(tabGroupMap, tabs[right], 'custom', groupSuspendedTabs)
    }
    if (groupSuspendedTabs) {
      tabGroupMap.set(tabSuspenderExtensionId, tabGroupMap.size)
    }
  }

  const customSortComparator = (
    a: chrome.tabs.Tab,
    b: chrome.tabs.Tab,
    gsSuspended: boolean,
    gsSortPinned?: boolean,
  ): number => {
    if (!gsSortPinned && (a.pinned || b.pinned)) return 0
    if (gsSuspended) {
      if (isSuspended(a) && !isSuspended(b)) return -1
      if (!isSuspended(a) && isSuspended(b)) return 1
    }
    const urlA = tabToUrl(a, gsSuspended)
    const urlB = tabToUrl(b, gsSuspended)
    const groupPosA = tabGroupMap.get(urlA.host)
    const groupPosB = tabGroupMap.get(urlB.host)

    if (groupPosA !== undefined && groupPosB !== undefined) {
      if (groupFrom === 'leftToRight') {
        if (groupPosA < groupPosB) return -1
        if (groupPosA > groupPosB) return 1
      } else {
        if (groupPosA < groupPosB) return 1
        if (groupPosA > groupPosB) return -1
      }
    }

    if (!gsSuspended && !preserveOrderWithinGroups) {
      return compareByUrlComponents(urlA, urlB)
    }
    return 0
  }

  tabs.sort((a, b) => customSortComparator(a, b, groupSuspendedTabs, sortPinnedTabs))

  // Sub-sort suspended tabs independently if groupSuspendedTabs is enabled
  if (groupSuspendedTabs) {
    tabGroupMap.clear()
    left = 0
    right = suspendedTabCount
    if (groupFrom === 'leftToRight') {
      while (left !== right) {
        updateTabGroupMap(tabGroupMap, tabs[left], 'custom', false)
        left += 1
      }
    } else {
      while (left !== right) {
        right -= 1
        updateTabGroupMap(tabGroupMap, tabs[right], 'custom', false)
      }
    }

    const suspendedTabs = tabs
      .slice(0, suspendedTabCount)
      .sort((a, b) => customSortComparator(a, b, false))
    const postSorted = tabs.slice(suspendedTabCount)
    tabs.length = 0
    tabs.push(...suspendedTabs, ...postSorted)
  }
}

// ---------- Duplicate tab handling ----------

function findDuplicateTabs(tabs: chrome.tabs.Tab[]): Map<string, chrome.tabs.Tab[]> {
  const urlMap = new Map<string, chrome.tabs.Tab[]>()

  for (const tab of tabs) {
    const url = tab.url ?? tab.pendingUrl
    if (!url) continue

    const existingTabs = urlMap.get(url)
    if (existingTabs) {
      existingTabs.push(tab)
    } else {
      urlMap.set(url, [tab])
    }
  }

  // 중복이 있는 것만 필터링 (2개 이상)
  const duplicates = new Map<string, chrome.tabs.Tab[]>()
  for (const [url, tabList] of urlMap) {
    if (tabList.length > 1) {
      duplicates.set(url, tabList)
    }
  }

  return duplicates
}

async function closeDuplicateTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
  // 첫 번째 탭 또는 활성 탭을 제외하고 나머지 닫기
  const activeTab = tabs.find((tab) => tab.active)
  const tabToKeep = activeTab ?? tabs[0]

  const tabsToClose = tabs.filter((tab) => tab.id !== tabToKeep.id)
  const tabIdsToClose = tabsToClose
    .map((tab) => tab.id)
    .filter((id): id is number => id !== undefined)

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose)
  }
}

async function groupDuplicateTabs(url: string, tabs: chrome.tabs.Tab[]): Promise<void> {
  const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined) as [
    number,
    ...number[],
  ]

  if (tabIds.length < 2) return

  // 탭 그룹 생성
  const groupId = await chrome.tabs.group({ tabIds })

  // 그룹 이름 설정 (도메인 이름)
  try {
    const urlObj = new URL(url)
    const groupTitle = `${urlObj.hostname} (${tabIds.length})`
    await chrome.tabGroups.update(groupId, {
      title: groupTitle,
      collapsed: false,
    })
  } catch {
    await chrome.tabGroups.update(groupId, {
      title: `Duplicates (${tabIds.length})`,
    })
  }
}

async function handleDuplicateTabs(
  duplicateHandling: 'none' | 'closeAllButOne' | 'group',
  windowId: number,
): Promise<void> {
  if (duplicateHandling === 'none') return

  const allTabs = await chrome.tabs.query({ windowId })
  const duplicates = findDuplicateTabs(allTabs)

  if (duplicateHandling === 'closeAllButOne') {
    for (const [_, tabs] of duplicates) {
      await closeDuplicateTabs(tabs)
    }
  } else if (duplicateHandling === 'group') {
    for (const [url, tabs] of duplicates) {
      await groupDuplicateTabs(url, tabs)
    }
  }
}

// ---------- Core sort orchestration ----------

async function sortTabs(
  tabs: chrome.tabs.Tab[],
  groupId: number,
  settings: SortSettings,
): Promise<void> {
  if (tabs.length === 0) return

  tabSuspenderExtensionId = settings.tabSuspenderExtensionId
  suspendedPrefix = `chrome-extension://${tabSuspenderExtensionId}/suspended.html#`
  suspendedPrefixLen = suspendedPrefix.length

  const firstTabIndex = tabs[0].index

  switch (settings.sortBy) {
    case 'url':
    case 'title':
      sortByTitleOrUrl(tabs, settings.sortBy, settings.groupSuspendedTabs, settings.sortPinnedTabs)
      break
    case 'custom':
      sortByCustom(
        tabs,
        settings.groupFrom,
        settings.groupSuspendedTabs,
        settings.preserveOrderWithinGroups,
        settings.sortPinnedTabs,
      )
      break
  }

  const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined) as [
    number,
    ...number[],
  ]
  if (tabIds.length === 0) return
  await chrome.tabs.move(tabIds, { index: firstTabIndex })
  if (groupId > -1) {
    await chrome.tabs.group({ groupId, tabIds })
  }
}

async function sortTabGroups(): Promise<void> {
  const settings = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as SortSettings

  const currentWindow = await chrome.windows.getLastFocused()

  const pinnedTabs = await chrome.tabs.query({
    windowId: currentWindow.id,
    pinned: true,
    currentWindow: true,
  })
  let groupOffset = pinnedTabs.length

  if (pinnedTabs.length > 0 && settings.sortPinnedTabs) {
    await sortTabs(pinnedTabs, pinnedTabs[0].groupId, settings)
  }

  const tabGroups = await chrome.tabGroups.query({ windowId: currentWindow.id })

  // Sort tab groups by title (you can prefix names with numbers to override order)
  tabGroups.sort((a, b) => (b.title ?? '').localeCompare(a.title ?? ''))

  for (const tabGroup of tabGroups) {
    await chrome.tabGroups.move(tabGroup.id, { index: groupOffset })
    const tabs = await chrome.tabs.query({
      windowId: currentWindow.id,
      groupId: tabGroup.id,
    })
    groupOffset += tabs.length
    await sortTabs(tabs, tabGroup.id, settings)
  }

  // Sort ungrouped tabs
  const ungroupedTabs = await chrome.tabs.query({
    windowId: currentWindow.id,
    pinned: false,
    groupId: -1,
  })
  await sortTabs(ungroupedTabs, -1, settings)

  // 중복 탭 처리 (정렬 후에 수행)
  if (currentWindow.id !== undefined) {
    await handleDuplicateTabs(settings.duplicateTabHandling, currentWindow.id)
  }
}

// ---------- Event listeners ----------

// 익스텐션 아이콘 클릭 시 바로 탭 정렬 실행
chrome.action.onClicked.addListener(() => {
  sortTabGroups()
})

// One-time installation and upgrade handlers
chrome.runtime.onInstalled.addListener((details) => {
  const thisVersion = chrome.runtime.getManifest().version

  if (details.reason === 'install') {
    chrome.storage.sync.set({
      installedVersion: thisVersion,
      newInstall: true,
      newUpdate: false,
    })
  } else if (details.reason === 'update') {
    chrome.storage.sync.set({
      installedVersion: thisVersion,
      newInstall: false,
      newUpdate: true,
    })
  }
})
