import { describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import type { Session, WindowSnapshot } from '@/types';
import {
  executeRestore,
  isTabsCannotBeEditedError,
  planRestore,
  type RestoreOptions,
  type RestorePlan,
  withRetryOnce,
} from './restore';

const SANITIZE: RestoreOptions['sanitize'] = {
  ownExtensionId: 'fakeextid',
  fileAccessAllowed: false,
  suspendedPrefix: 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#',
  suspendedPrefixLen: 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#'.length,
};

/** 1 pinned, group "Work" (blue, open) with 2 tabs, group "News" (red, collapsed) with 1 tab, 1 loose. */
const WINDOW_A: WindowSnapshot = {
  state: 'normal',
  focused: true,
  bounds: { left: 10, top: 20, width: 800, height: 600 },
  groups: [
    { title: 'Work', color: 'blue', collapsed: false },
    { title: 'News', color: 'red', collapsed: true },
  ],
  tabs: [
    { url: 'https://pinned.example/', title: 'Pinned', pinned: true, active: false },
    { url: 'https://work.example/a', title: 'A', pinned: false, active: false, groupIndex: 0 },
    { url: 'https://work.example/b', title: 'B', pinned: false, active: true, groupIndex: 0 },
    { url: 'https://news.example/', title: 'News', pinned: false, active: false, groupIndex: 1 },
    { url: 'https://loose.example/', title: 'Loose', pinned: false, active: false },
  ],
};

const WINDOW_B: WindowSnapshot = {
  state: 'normal',
  focused: false,
  groups: [],
  tabs: [
    { url: 'https://b1.example/', title: 'B1', pinned: false, active: true },
    { url: 'https://b2.example/', title: 'B2', pinned: false, active: false },
  ],
};

function makeSession(windows: WindowSnapshot[]): Session {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'saved',
    name: 'Fixture',
    origin: 'manual',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    windows,
  };
}

function makePlan(windows: WindowSnapshot[], overrides: Partial<RestoreOptions> = {}): RestorePlan {
  return planRestore(makeSession(windows), {
    target: { kind: 'newWindows' },
    lazy: 'never',
    chunkSize: 25,
    sanitize: SANITIZE,
    ...overrides,
  });
}

interface StripRow {
  url: string;
  pinned: boolean;
  active: boolean;
  group: string | null;
}

/** The tab strip of `windowId` in index order, with the group title resolved. */
function stripOf(windowId: number): StripRow[] {
  const fake = getChromeFake();
  return [...fake.state.tabs.values()]
    .filter((tab) => tab.windowId === windowId)
    .sort((a, b) => a.index - b.index)
    .map((tab) => {
      const group = tab.groupId === -1 ? undefined : fake.state.groups.get(tab.groupId);
      return { url: tab.url, pinned: tab.pinned, active: tab.active, group: group?.title ?? null };
    });
}

function newWindowIds(before: Set<number>): number[] {
  return [...getChromeFake().state.windows.keys()].filter((id) => !before.has(id));
}

function snapshotWindowIds(): Set<number> {
  return new Set(getChromeFake().state.windows.keys());
}

describe('isTabsCannotBeEditedError', () => {
  it('matches the Chrome drag-lock message, case-insensitively', () => {
    expect(
      isTabsCannotBeEditedError(
        new Error('Tabs cannot be edited right now (user may be dragging a tab).'),
      ),
    ).toBe(true);
    expect(isTabsCannotBeEditedError('tabs CANNOT BE EDITED')).toBe(true);
    expect(isTabsCannotBeEditedError(new Error('No window with id: 9'))).toBe(false);
    expect(isTabsCannotBeEditedError(undefined)).toBe(false);
  });
});

describe('withRetryOnce', () => {
  it('retries exactly once when shouldRetry says so', async () => {
    let calls = 0;
    const result = await withRetryOnce(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('cannot be edited');
        }
        return 'ok';
      },
      () => true,
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry when shouldRetry returns false', async () => {
    let calls = 0;
    await expect(
      withRetryOnce(
        async () => {
          calls += 1;
          throw new Error('fatal');
        },
        () => false,
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('rethrows the second failure', async () => {
    let calls = 0;
    await expect(
      withRetryOnce(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        () => true,
      ),
    ).rejects.toThrow('fail 2');
  });
});

describe('executeRestore', () => {
  it('recreates the tab strip: order, pinned, groups (title/colour/collapsed) and active tab', async () => {
    const before = snapshotWindowIds();
    const result = await executeRestore(makePlan([WINDOW_A]));

    const created = newWindowIds(before);
    expect(created).toHaveLength(1);
    const windowId = created[0];

    expect(stripOf(windowId)).toEqual([
      { url: 'https://pinned.example/', pinned: true, active: false, group: null },
      { url: 'https://work.example/a', pinned: false, active: false, group: 'Work' },
      { url: 'https://work.example/b', pinned: false, active: true, group: 'Work' },
      { url: 'https://news.example/', pinned: false, active: false, group: 'News' },
      { url: 'https://loose.example/', pinned: false, active: false, group: null },
    ]);

    const groups = [...getChromeFake().state.groups.values()]
      .filter((group) => group.windowId === windowId)
      .map(({ title, color, collapsed }) => ({ title, color, collapsed }));
    expect(groups).toEqual([
      { title: 'Work', color: 'blue', collapsed: false },
      { title: 'News', color: 'red', collapsed: true },
    ]);

    expect(result).toEqual({ restored: 5, skipped: [], errors: [] });
  });

  it('applies clamped bounds for normal windows and focuses the snapshot-focused window last', async () => {
    const before = snapshotWindowIds();
    await executeRestore(makePlan([WINDOW_B, WINDOW_A]), {
      screen: { availWidth: 500, availHeight: 400 },
    });
    const [winB, winA] = newWindowIds(before);
    const fake = getChromeFake();
    const a = fake.state.windows.get(winA);
    const b = fake.state.windows.get(winB);
    expect(a?.focused).toBe(true);
    expect(b?.focused).toBe(false);
    expect({ left: a?.left, top: a?.top, width: a?.width, height: a?.height }).toEqual({
      left: 10,
      top: 20,
      width: 490,
      height: 380,
    });
  });

  it('removes the about:blank placeholder after activating the session tab', async () => {
    const updateSpy = vi.spyOn(chrome.tabs, 'update');
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    const before = snapshotWindowIds();
    await executeRestore(makePlan([WINDOW_A]));
    const [windowId] = newWindowIds(before);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      removeSpy.mock.invocationCallOrder[0],
    );
    expect(stripOf(windowId).some((row) => row.url === 'about:blank')).toBe(false);
    vi.restoreAllMocks();
  });

  it('orders: all creates before grouping, style before collapse, placeholder removed last', async () => {
    const createSpy = vi.spyOn(chrome.tabs, 'create');
    const groupSpy = vi.spyOn(chrome.tabs, 'group');
    const groupUpdateSpy = vi.spyOn(chrome.tabGroups, 'update');
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    await executeRestore(makePlan([WINDOW_A]));

    const createOrder = createSpy.mock.invocationCallOrder;
    const groupOrder = groupSpy.mock.invocationCallOrder;
    expect(createOrder).toHaveLength(5);
    expect(groupOrder).toHaveLength(2);
    // Spec §13 "group-after-all-tabs": every tabs.create precedes the first tabs.group.
    expect(Math.max(...createOrder)).toBeLessThan(Math.min(...groupOrder));

    const updates = groupUpdateSpy.mock.calls.map((args, i) => ({
      props: args[1],
      order: groupUpdateSpy.mock.invocationCallOrder[i],
    }));
    const styleCalls = updates.filter(({ props }) => props.title !== undefined);
    const collapseCalls = updates.filter(
      ({ props }) => props.collapsed !== undefined && props.title === undefined,
    );
    expect(styleCalls).toHaveLength(2);
    expect(collapseCalls).toHaveLength(2);
    // Each tabs.group precedes its own tabGroups.update({ title, color }).
    for (let i = 0; i < groupOrder.length; i++) {
      expect(groupOrder[i]).toBeLessThan(styleCalls[i].order);
    }
    // Spec §13 "collapse after grouping" and "placeholder removed last".
    const lastStyle = Math.max(...styleCalls.map((call) => call.order));
    const removeOrder = removeSpy.mock.invocationCallOrder[0];
    for (const call of collapseCalls) {
      expect(call.order).toBeGreaterThan(lastStyle);
      expect(call.order).toBeLessThan(removeOrder);
    }
    vi.restoreAllMocks();
  });

  it('reports every tab of a window whose windows.create fails and keeps restoring', async () => {
    const fake = getChromeFake();
    fake.failNext('windows.create', 1, 'Invalid value for bounds');
    const progress: [number, number][] = [];
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_B, WINDOW_A]), {
      onProgress: (done, total) => {
        progress.push([done, total]);
      },
    });

    // WINDOW_B (no bounds) fails outright; WINDOW_A is still restored in full.
    expect(newWindowIds(before)).toHaveLength(1);
    expect(result.restored).toBe(5);
    expect(result.errors).toEqual([
      { url: 'https://b1.example/', message: 'Invalid value for bounds' },
      { url: 'https://b2.example/', message: 'Invalid value for bounds' },
    ]);
    expect(progress).toEqual([
      [2, 7],
      [7, 7],
    ]);
  });

  it('retries windows.create without bounds when Chrome rejects the bounds', async () => {
    const fake = getChromeFake();
    fake.failNext('windows.create', 1, 'Invalid value for bounds');
    const createSpy = vi.spyOn(chrome.windows, 'create');
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A]), {
      screen: { availWidth: 1920, availHeight: 1080 },
    });

    expect(result.errors).toEqual([]);
    expect(result.restored).toBe(5);
    expect(createSpy).toHaveBeenCalledTimes(2);
    const [windowId] = newWindowIds(before);
    const win = fake.state.windows.get(windowId);
    // The retry carries no left/top/width/height: the fake falls back to its defaults (0, 0).
    expect({ left: win?.left, top: win?.top }).toEqual({ left: 0, top: 0 });
    vi.restoreAllMocks();
  });

  it('uses the tab ids returned by tabs.discard when grouping lazily restored windows', async () => {
    const fake = getChromeFake();
    // Some Chrome versions replace the discarded tab (new id); the returned Tab is the live one.
    const discardWithNewId = async (tabId?: number): Promise<chrome.tabs.Tab | undefined> => {
      if (tabId === undefined) {
        return undefined;
      }
      const old = fake.state.tabs.get(tabId);
      if (old === undefined) {
        throw new Error(`No tab with id: ${tabId}`);
      }
      const replacement = { ...old, id: fake.state.nextId.tab, discarded: true };
      fake.state.nextId.tab += 1;
      fake.state.tabs.delete(tabId);
      fake.state.tabs.set(replacement.id, replacement);
      return chrome.tabs.get(replacement.id);
    };
    vi.spyOn(chrome.tabs, 'discard').mockImplementation(discardWithNewId);
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A], { lazy: 'always' }));
    const [windowId] = newWindowIds(before);

    expect(result.errors).toEqual([]);
    expect(stripOf(windowId).map((row) => [row.url, row.group])).toEqual([
      ['https://pinned.example/', null],
      ['https://work.example/a', 'Work'],
      ['https://work.example/b', 'Work'],
      ['https://news.example/', 'News'],
      ['https://loose.example/', null],
    ]);
    vi.restoreAllMocks();
  });

  it('keeps going when one tabs.create fails and reports the error', async () => {
    const fake = getChromeFake();
    // The placeholder window is created by windows.create, so the first tabs.create is the pinned tab.
    fake.failNext('tabs.create', 1, 'No window with id: 999');

    const before = snapshotWindowIds();
    const result = await executeRestore(makePlan([WINDOW_A]));
    const [windowId] = newWindowIds(before);

    expect(result.restored).toBe(4);
    expect(result.errors).toEqual([
      { url: 'https://pinned.example/', message: 'No window with id: 999' },
    ]);
    expect(stripOf(windowId).map((row) => row.url)).toEqual([
      'https://work.example/a',
      'https://work.example/b',
      'https://news.example/',
      'https://loose.example/',
    ]);
  });

  it('retries once on "Tabs cannot be edited right now"', async () => {
    const fake = getChromeFake();
    fake.failNext(
      'tabs.create',
      1,
      'Tabs cannot be edited right now (user may be dragging a tab).',
    );
    const createSpy = vi.spyOn(chrome.tabs, 'create');

    const result = await executeRestore(makePlan([WINDOW_B]));

    expect(result.errors).toEqual([]);
    expect(result.restored).toBe(2);
    // 2 tabs + 1 retry
    expect(createSpy).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('never discards the active or pinned tab in lazy mode', async () => {
    const discardSpy = vi.spyOn(chrome.tabs, 'discard');
    const before = snapshotWindowIds();

    await executeRestore(makePlan([WINDOW_A], { lazy: 'always' }));
    const [windowId] = newWindowIds(before);
    const fake = getChromeFake();

    const discardedUrls = [...fake.state.tabs.values()]
      .filter((tab) => tab.windowId === windowId && tab.discarded)
      .map((tab) => tab.url)
      .sort();
    expect(discardedUrls).toEqual([
      'https://loose.example/',
      'https://news.example/',
      'https://work.example/a',
    ]);

    const discardedIds = discardSpy.mock.calls.map(([id]) => id);
    const forbidden = [...fake.state.tabs.values()]
      .filter((tab) => tab.windowId === windowId && (tab.pinned || tab.active))
      .map((tab) => tab.id);
    for (const id of forbidden) {
      expect(discardedIds).not.toContain(id);
    }
    vi.restoreAllMocks();
  });

  it('stops between chunks when the signal aborts, keeping already created tabs', async () => {
    const controller = new AbortController();
    const progress: [number, number][] = [];
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A, WINDOW_B], { chunkSize: 2 }), {
      signal: controller.signal,
      onProgress: (done, total) => {
        progress.push([done, total]);
        if (done === 2) {
          controller.abort();
        }
      },
    });

    const created = newWindowIds(before);
    expect(created).toHaveLength(1);
    const strip = stripOf(created[0]);
    expect(strip.map((row) => row.url)).toEqual([
      'https://pinned.example/',
      'https://work.example/a',
    ]);
    expect(strip.some((row) => row.url === 'about:blank')).toBe(false);
    expect(progress).toEqual([[2, 7]]);
    expect(result.restored).toBe(2);
  });
});
