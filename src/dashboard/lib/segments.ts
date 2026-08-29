import type { TabSnapshot } from '@/types';

export interface TabSegment {
  groupIndex?: number;
  tabs: TabSnapshot[];
}

/**
 * Splits a window's tabs (strip order) into runs: each ungrouped tab is its own segment,
 * consecutive tabs sharing a groupIndex form one segment. Rendering the segments in order
 * reproduces the tab strip exactly.
 */
export function segmentTabs(tabs: TabSnapshot[]): TabSegment[] {
  const segments: TabSegment[] = [];
  for (const tab of tabs) {
    const last = segments[segments.length - 1];
    if (
      tab.groupIndex !== undefined &&
      last !== undefined &&
      last.groupIndex !== undefined &&
      last.groupIndex === tab.groupIndex
    ) {
      last.tabs.push(tab);
    } else {
      segments.push({ groupIndex: tab.groupIndex, tabs: [tab] });
    }
  }
  return segments;
}
