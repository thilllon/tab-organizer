import { describe, expect, it } from 'vitest';
import type { WindowSnapshot } from '@/types';
import { contentHash, fnv1a32 } from './hash';

function win(tabs: WindowSnapshot['tabs'], groups: WindowSnapshot['groups'] = []): WindowSnapshot {
  return { state: 'normal', focused: false, groups, tabs };
}

describe('fnv1a32', () => {
  it('matches known FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});

describe('contentHash', () => {
  const base = [
    win(
      [
        { url: 'https://a.test', title: 'A', pinned: true, active: false },
        { url: 'https://b.test', title: 'B', pinned: false, active: true, groupIndex: 0 },
      ],
      [{ title: 'Work', color: 'blue', collapsed: false }],
    ),
  ];

  it('is 8 lowercase hex chars and stable across calls', () => {
    const hash = contentHash(base);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(structuredClone(base))).toBe(hash);
  });

  it('ignores titles', () => {
    const renamed = structuredClone(base);
    const first = renamed[0]?.tabs[0];
    if (first) {
      first.title = 'Changed';
    }
    expect(contentHash(renamed)).toBe(contentHash(base));
  });

  it('changes when tab order, pinned state, group membership or group title change', () => {
    const reordered = structuredClone(base);
    reordered[0]?.tabs.reverse();
    expect(contentHash(reordered)).not.toBe(contentHash(base));

    const unpinned = structuredClone(base);
    const first = unpinned[0]?.tabs[0];
    if (first) {
      first.pinned = false;
    }
    expect(contentHash(unpinned)).not.toBe(contentHash(base));

    const ungrouped = structuredClone(base);
    const second = ungrouped[0]?.tabs[1];
    if (second) {
      second.groupIndex = undefined;
    }
    expect(contentHash(ungrouped)).not.toBe(contentHash(base));

    const retitled = structuredClone(base);
    const group = retitled[0]?.groups[0];
    if (group) {
      group.title = 'Play';
    }
    expect(contentHash(retitled)).not.toBe(contentHash(base));
  });

  it('hashes an empty layout to the FNV offset basis', () => {
    expect(contentHash([])).toBe('811c9dc5');
  });
});
