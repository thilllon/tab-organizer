import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/types';
import { segmentTabs } from './segments';

function tab(url: string, groupIndex?: number, pinned = false): TabSnapshot {
  return groupIndex === undefined
    ? { url, title: url, pinned, active: false }
    : { url, title: url, pinned, active: false, groupIndex };
}

describe('segmentTabs', () => {
  it('returns an empty list for no tabs', () => {
    expect(segmentTabs([])).toEqual([]);
  });

  it('keeps ungrouped tabs as single-tab segments in strip order', () => {
    const tabs = [tab('https://a/'), tab('https://b/')];
    expect(segmentTabs(tabs)).toEqual([
      { groupIndex: undefined, tabs: [tabs[0]] },
      { groupIndex: undefined, tabs: [tabs[1]] },
    ]);
  });

  it('merges consecutive tabs of the same group into one segment', () => {
    const tabs = [
      tab('https://pinned/', undefined, true),
      tab('https://a/', 0),
      tab('https://b/', 0),
      tab('https://c/'),
      tab('https://d/', 1),
    ];
    expect(segmentTabs(tabs)).toEqual([
      { groupIndex: undefined, tabs: [tabs[0]] },
      { groupIndex: 0, tabs: [tabs[1], tabs[2]] },
      { groupIndex: undefined, tabs: [tabs[3]] },
      { groupIndex: 1, tabs: [tabs[4]] },
    ]);
  });

  it('starts a new segment when the group index changes between neighbours', () => {
    const tabs = [tab('https://a/', 0), tab('https://b/', 1), tab('https://c/', 0)];
    expect(segmentTabs(tabs).map((segment) => segment.groupIndex)).toEqual([0, 1, 0]);
  });
});
