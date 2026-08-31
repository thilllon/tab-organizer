import { describe, expect, it } from 'vitest';
import { type CaptureOptions, captureWindows } from './capture';

const SUSPENDED_PREFIX = 'chrome-extension://suspenderid/suspended.html#';

const OPTIONS: CaptureOptions = {
  ownUrlPrefix: 'chrome-extension://fakeextid/',
  suspendedPrefix: SUSPENDED_PREFIX,
  suspendedPrefixLen: SUSPENDED_PREFIX.length,
};

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    lastAccessed: 0,
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  };
}

function makeWindow(overrides: Partial<chrome.windows.Window> = {}): chrome.windows.Window {
  return {
    id: 1,
    focused: false,
    alwaysOnTop: false,
    incognito: false,
    type: 'normal',
    state: 'normal',
    left: 10,
    top: 20,
    width: 1200,
    height: 800,
    tabs: [],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<chrome.tabGroups.TabGroup> = {}): chrome.tabGroups.TabGroup {
  return {
    id: 100,
    windowId: 1,
    collapsed: false,
    shared: false,
    color: 'blue',
    title: 'Group',
    ...overrides,
  };
}

function tabsInOrder(...tabs: Partial<chrome.tabs.Tab>[]): chrome.tabs.Tab[] {
  return tabs.map((overrides, index) => makeTab({ id: index + 1, index, ...overrides }));
}

describe('captureWindows', () => {
  it('captures tabs in strip order with url, title, pinned and active', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', title: 'A', pinned: true },
        { url: 'https://b.com/', title: 'B', active: true },
        { url: 'https://c.com/', title: 'C' },
      ),
    });

    const result = captureWindows([win], [], OPTIONS);

    expect(result).toHaveLength(1);
    expect(result[0].tabs).toEqual([
      { url: 'https://a.com/', title: 'A', pinned: true, active: false },
      { url: 'https://b.com/', title: 'B', pinned: false, active: true },
      { url: 'https://c.com/', title: 'C', pinned: false, active: false },
    ]);
    expect(result[0].groups).toEqual([]);
  });

  it('sorts tabs by index even when the input array is out of order', () => {
    const win = makeWindow({
      tabs: [
        makeTab({ id: 2, index: 1, url: 'https://second.com/' }),
        makeTab({ id: 1, index: 0, url: 'https://first.com/' }),
      ],
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://first.com/', 'https://second.com/']);
  });

  it('prefers pendingUrl over url', () => {
    const win = makeWindow({
      tabs: tabsInOrder({ url: 'https://old.com/', pendingUrl: 'https://new.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('https://new.com/');
  });

  it('uses an empty title when the tab has none', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', title: undefined }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].title).toBe('');
  });

  it('skips incognito windows', () => {
    const win = makeWindow({ incognito: true, tabs: tabsInOrder({ url: 'https://a.com/' }) });

    expect(captureWindows([win], [], OPTIONS)).toEqual([]);
  });

  it('skips non-normal window types (popup, app, devtools)', () => {
    const popup = makeWindow({ type: 'popup', tabs: tabsInOrder({ url: 'https://a.com/' }) });
    const devtools = makeWindow({ type: 'devtools', tabs: tabsInOrder({ url: 'https://a.com/' }) });

    expect(captureWindows([popup, devtools], [], OPTIONS)).toEqual([]);
  });

  it('drops our own extension pages', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'chrome-extension://fakeextid/dashboard.html' },
        { url: 'https://a.com/' },
        { url: 'chrome-extension://fakeextid/options.html' },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://a.com/']);
  });

  it('keeps other extensions pages', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'chrome-extension://otherid/page.html' }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('chrome-extension://otherid/page.html');
  });

  it('does not treat every url as an own page when ownUrlPrefix is empty', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/' }) });

    const result = captureWindows([win], [], { ...OPTIONS, ownUrlPrefix: '' });

    expect(result[0].tabs).toHaveLength(1);
  });

  it('drops windows that become empty after filtering', () => {
    const onlyDashboard = makeWindow({
      id: 1,
      tabs: tabsInOrder({ url: 'chrome-extension://fakeextid/dashboard.html' }),
    });
    const noTabs = makeWindow({ id: 2, tabs: [] });
    const populated = makeWindow({ id: 3, tabs: undefined });

    expect(captureWindows([onlyDashboard, noTabs, populated], [], OPTIONS)).toEqual([]);
  });

  it('drops tabs that have neither url nor pendingUrl', () => {
    const win = makeWindow({
      tabs: tabsInOrder({ url: undefined, pendingUrl: undefined }, { url: 'https://a.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://a.com/']);
  });

  it('unwraps suspended tabs to the real url', () => {
    const win = makeWindow({
      tabs: tabsInOrder({
        url: `${SUSPENDED_PREFIX}ttl=Docs&uri=https://docs.example.com/page?x=1`,
        title: 'Docs',
      }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('https://docs.example.com/page?x=1');
  });

  it('keeps the wrapper url when a suspended tab has no uri parameter', () => {
    const url = `${SUSPENDED_PREFIX}ttl=Docs`;
    const win = makeWindow({ tabs: tabsInOrder({ url }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe(url);
  });

  it('keeps a suspended tab with an empty uri parameter, falling back to the wrapper url', () => {
    const url = `${SUSPENDED_PREFIX}uri=`;
    const win = makeWindow({
      tabs: tabsInOrder({ url, title: 'Docs', pinned: true }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0]).toEqual({ url, title: 'Docs', pinned: true, active: false });
  });

  it('keeps a suspended tab with a relative uri, preserving active state and group', () => {
    const groups = [makeGroup({ id: 100, title: 'G' })];
    const url = `${SUSPENDED_PREFIX}uri=/foo`;
    const win = makeWindow({
      tabs: tabsInOrder({ url, title: 'Docs', active: true, groupId: 100 }),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.tabs[0]).toEqual({
      url,
      title: 'Docs',
      pinned: false,
      active: true,
      groupIndex: 0,
    });
    expect(snapshot.groups).toEqual([{ title: 'G', color: 'blue', collapsed: false }]);
  });

  it('never treats tabs as suspended when suspendedPrefix is empty', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/?uri=https://evil.com/' }) });

    const result = captureWindows([win], [], {
      ...OPTIONS,
      suspendedPrefix: '',
      suspendedPrefixLen: 0,
    });

    expect(result[0].tabs[0].url).toBe('https://a.com/?uri=https://evil.com/');
  });

  it('builds groups in first-appearance order and references them by index', () => {
    const groups = [
      makeGroup({ id: 200, title: 'Second', color: 'red', collapsed: true }),
      makeGroup({ id: 100, title: 'First', color: 'green', collapsed: false }),
    ];
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', groupId: 100 },
        { url: 'https://b.com/', groupId: 100 },
        { url: 'https://c.com/' },
        { url: 'https://d.com/', groupId: 200 },
      ),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.groups).toEqual([
      { title: 'First', color: 'green', collapsed: false },
      { title: 'Second', color: 'red', collapsed: true },
    ]);
    expect(snapshot.tabs.map((t) => t.groupIndex)).toEqual([0, 0, undefined, 1]);
  });

  it("orders groups by first non-pinned appearance when a group's first tab is pinned", () => {
    const groups = [makeGroup({ id: 100, title: 'A' }), makeGroup({ id: 200, title: 'B' })];
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a1.com/', pinned: true, groupId: 100 },
        { url: 'https://b1.com/', groupId: 200 },
        { url: 'https://a2.com/', groupId: 100 },
      ),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.groups).toEqual([
      { title: 'B', color: 'blue', collapsed: false },
      { title: 'A', color: 'blue', collapsed: false },
    ]);
    expect(snapshot.tabs.map((t) => t.groupIndex)).toEqual([undefined, 0, 1]);
  });

  it('uses an empty title for untitled groups', () => {
    const groups = [makeGroup({ id: 100, title: undefined })];
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.groups[0].title).toBe('');
  });

  it('treats a groupId that is not in the groups list as ungrouped', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 999 }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.groups).toEqual([]);
    expect(snapshot.tabs[0].groupIndex).toBeUndefined();
  });

  it('strips groupIndex from pinned tabs and does not create a group for them', () => {
    const groups = [makeGroup({ id: 100, title: 'G' })];
    const win = makeWindow({
      tabs: tabsInOrder({ url: 'https://a.com/', pinned: true, groupId: 100 }),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.tabs[0]).toEqual({
      url: 'https://a.com/',
      title: 'Example',
      pinned: true,
      active: false,
    });
    expect(snapshot.groups).toEqual([]);
  });

  it('keeps groups scoped per window', () => {
    const groups = [makeGroup({ id: 100, windowId: 1 }), makeGroup({ id: 200, windowId: 2 })];
    const win1 = makeWindow({ id: 1, tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });
    const win2 = makeWindow({
      id: 2,
      tabs: tabsInOrder({ url: 'https://b.com/', groupId: 200, windowId: 2 }),
    });

    const result = captureWindows([win1, win2], groups, OPTIONS);

    expect(result[0].groups).toHaveLength(1);
    expect(result[1].groups).toHaveLength(1);
    expect(result[1].tabs[0].groupIndex).toBe(0);
  });

  it('keeps at most one active tab per window', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', active: true },
        { url: 'https://b.com/', active: true },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.active)).toEqual([true, false]);
  });

  it('yields no active tab when the active tab was an own page', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'chrome-extension://fakeextid/dashboard.html', active: true },
        { url: 'https://a.com/' },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.some((t) => t.active)).toBe(false);
  });

  it('records state, focused and bounds for a normal window', () => {
    const win = makeWindow({
      focused: true,
      state: 'normal',
      left: 5,
      top: 6,
      width: 700,
      height: 500,
      tabs: tabsInOrder({ url: 'https://a.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.state).toBe('normal');
    expect(snapshot.focused).toBe(true);
    expect(snapshot.bounds).toEqual({ left: 5, top: 6, width: 700, height: 500 });
  });

  it('omits bounds unless the window state is normal', () => {
    const states: chrome.windows.Window['state'][] = ['maximized', 'minimized', 'fullscreen'];

    for (const state of states) {
      const win = makeWindow({ state, tabs: tabsInOrder({ url: 'https://a.com/' }) });
      const [snapshot] = captureWindows([win], [], OPTIONS);
      expect(snapshot.state).toBe(state);
      expect(snapshot.bounds).toBeUndefined();
    }
  });

  it('omits bounds when any coordinate is missing', () => {
    const win = makeWindow({ state: 'normal', width: undefined, tabs: tabsInOrder({}) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.bounds).toBeUndefined();
  });

  it('maps locked-fullscreen to fullscreen and an undefined state to normal', () => {
    const locked = makeWindow({ id: 1, state: 'locked-fullscreen', tabs: tabsInOrder({}) });
    const unknown = makeWindow({ id: 2, state: undefined, tabs: tabsInOrder({}) });

    const result = captureWindows([locked, unknown], [], OPTIONS);

    expect(result[0].state).toBe('fullscreen');
    expect(result[1].state).toBe('normal');
    expect(result[1].bounds).toEqual({ left: 10, top: 20, width: 1200, height: 800 });
  });

  it('never copies chrome runtime ids into the snapshot', () => {
    const groups = [makeGroup({ id: 100 })];
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });

    const json = JSON.stringify(captureWindows([win], groups, OPTIONS));

    expect(json).not.toContain('"id"');
    expect(json).not.toContain('windowId');
    expect(json).not.toContain('groupId');
  });
});
