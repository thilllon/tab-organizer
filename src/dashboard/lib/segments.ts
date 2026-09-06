import type { TabSnapshot } from '@/types';

export interface TabSegment {
  groupIndex?: number;
  tabs: TabSnapshot[];
  /**
   * Index of this segment's first tab in the window's `tabs` array. Row actions ("Remove from
   * session", "Close tab") address a tab by that absolute index, which segmenting would otherwise
   * lose.
   */
  startIndex: number;
}

/**
 * Splits a window's tabs (strip order) into runs: each ungrouped tab is its own segment,
 * consecutive tabs sharing a groupIndex form one segment. Rendering the segments in order
 * reproduces the tab strip exactly.
 */
export function segmentTabs(tabs: TabSnapshot[]): TabSegment[] {
  const segments: TabSegment[] = [];
  tabs.forEach((tab, index) => {
    const last = segments[segments.length - 1];
    if (
      tab.groupIndex !== undefined &&
      last !== undefined &&
      last.groupIndex !== undefined &&
      last.groupIndex === tab.groupIndex
    ) {
      last.tabs.push(tab);
    } else {
      segments.push({ groupIndex: tab.groupIndex, tabs: [tab], startIndex: index });
    }
  });
  return segments;
}
