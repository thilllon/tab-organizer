export type SortBy = 'url' | 'title' | 'custom'

export type GroupFrom = 'leftToRight' | 'rightToLeft'

export type DuplicateTabHandling = 'none' | 'closeAllButOne' | 'group'

export type GroupingMode = 'subdomain' | 'domain'

export interface SortSettings {
  sortBy: SortBy
  groupFrom: GroupFrom
  preserveOrderWithinGroups: boolean
  groupSuspendedTabs: boolean
  tabSuspenderExtensionId: string
  sortPinnedTabs: boolean
  duplicateTabHandling: DuplicateTabHandling
  groupingMode: GroupingMode
}
