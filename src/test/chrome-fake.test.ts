import { describe, expect, it } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';

describe('chrome fake: tab strip', () => {
  it('keeps pinned tabs first and re-indexes on create', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test', active: false });
    const b = await chrome.tabs.create({ url: 'https://b.test', active: false });
    const p = await chrome.tabs.create({ url: 'https://p.test', pinned: true, active: false });

    const strip = await chrome.tabs.query({ windowId: a.windowId });
    expect(strip.map((tab) => [tab.url, tab.index, tab.pinned])).toEqual([
      ['https://p.test', 0, true],
      ['https://a.test', 1, false],
      ['https://b.test', 2, false],
    ]);
    expect(p.index).toBe(0);
    expect(b.id).not.toBe(a.id);
  });

  it('activates the new tab by default and deactivates siblings', async () => {
    const first = await chrome.tabs.create({ url: 'https://a.test' });
    const second = await chrome.tabs.create({ url: 'https://b.test' });
    const strip = await chrome.tabs.query({});
    expect(strip.find((tab) => tab.id === first.id)?.active).toBe(false);
    expect(strip.find((tab) => tab.id === second.id)?.active).toBe(true);
  });

  it('rejects tabs.create for an unknown window', async () => {
    await expect(chrome.tabs.create({ windowId: 999, url: 'https://a.test' })).rejects.toThrow(
      'No window with id: 999.',
    );
  });

  it('does not record a rejected tabs.create in state.createdTabs', async () => {
    await expect(chrome.tabs.create({ windowId: 999, url: 'https://a.test' })).rejects.toThrow(
      'No window with id: 999.',
    );
    expect(getChromeFake().state.createdTabs).toEqual([]);
  });

  it('re-indexes after tabs.remove', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test' });
    const b = await chrome.tabs.create({ url: 'https://b.test' });
    const c = await chrome.tabs.create({ url: 'https://c.test' });
    if (b.id === undefined) {
      throw new Error('expected id');
    }
    await chrome.tabs.remove(b.id);
    const strip = await chrome.tabs.query({});
    expect(strip.map((tab) => [tab.id, tab.index])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
  });

  it('windows.create makes a window with one about:blank tab', async () => {
    const win = await chrome.windows.create({ focused: false });
    if (!win) {
      throw new Error('expected window');
    }
    expect(win.tabs?.length).toBe(1);
    expect(win.tabs?.[0]?.url).toBe('about:blank');
    expect(win.tabs?.[0]?.active).toBe(true);
    expect(getChromeFake().state.windows.size).toBe(2);
  });

  it('tabs.discard marks the tab and refuses the active tab', async () => {
    const active = await chrome.tabs.create({ url: 'https://a.test' });
    const idle = await chrome.tabs.create({ url: 'https://b.test', active: false });
    if (active.id === undefined || idle.id === undefined) {
      throw new Error('expected ids');
    }
    await expect(chrome.tabs.discard(active.id)).rejects.toThrow('Cannot discard active tab');
    const discarded = await chrome.tabs.discard(idle.id);
    expect(discarded?.discarded).toBe(true);
  });

  it('deferCommit leaves a created tab uncommitted until commitNavigation is called', async () => {
    const fake = getChromeFake();
    fake.state.deferCommit = true;

    const tab = await chrome.tabs.create({ url: 'https://a.test', active: false });
    if (tab.id === undefined) {
      throw new Error('expected id');
    }
    expect(tab.url).toBe('');
    expect(tab.pendingUrl).toBe('https://a.test');
    expect(tab.status).toBe('loading');

    fake.commitNavigation(tab.id);
    const committed = await chrome.tabs.get(tab.id);
    expect(committed.url).toBe('https://a.test');
    expect(committed.pendingUrl).toBeUndefined();
    expect(committed.status).toBe('complete');
  });

  it('tabs.discard on an uncommitted tab mimics Chrome: url stays empty, status becomes unloaded', async () => {
    // A decoy tab occupies "active" so the tab under test (created second, active: false) is not
    // forced active by the fake's "sole tab in the window is always active" rule.
    await chrome.tabs.create({ url: 'https://decoy.test' });
    const fake = getChromeFake();
    fake.state.deferCommit = true;

    const tab = await chrome.tabs.create({ url: 'https://a.test', active: false });
    if (tab.id === undefined) {
      throw new Error('expected id');
    }
    expect(tab.active).toBe(false);
    const discarded = await chrome.tabs.discard(tab.id);
    expect(discarded?.discarded).toBe(true);
    expect(discarded?.url).toBe('');
    expect(discarded?.status).toBe('unloaded');
    // The original url is permanently lost: it never makes it into `url`, and commitNavigation
    // has nothing left to promote once the tab has been discarded uncommitted.
    expect(discarded?.pendingUrl).toBe('https://a.test');
  });
});

describe('chrome fake: windows.create state validation', () => {
  // Verified in Chrome for Testing 151: each of these three combinations rejects with
  // "Invalid value for state"; the accepted ones below resolve.
  it('rejects a minimized window that is also focused', async () => {
    await expect(chrome.windows.create({ state: 'minimized', focused: true })).rejects.toThrow(
      'Invalid value for state',
    );
    expect(getChromeFake().state.windows.size).toBe(1);
  });

  it('rejects a maximized or fullscreen window that is not focused', async () => {
    await expect(chrome.windows.create({ state: 'maximized', focused: false })).rejects.toThrow(
      'Invalid value for state',
    );
    await expect(chrome.windows.create({ state: 'fullscreen', focused: false })).rejects.toThrow(
      'Invalid value for state',
    );
    expect(getChromeFake().state.windows.size).toBe(1);
  });

  it('rejects a non-normal state combined with bounds', async () => {
    await expect(
      chrome.windows.create({ state: 'maximized', left: 10, top: 20, width: 800, height: 600 }),
    ).rejects.toThrow('Invalid value for state');
    await expect(chrome.windows.create({ state: 'minimized', width: 800 })).rejects.toThrow(
      'Invalid value for state',
    );
    expect(getChromeFake().state.windows.size).toBe(1);
  });

  it('accepts the combinations Chrome allows', async () => {
    const normal = await chrome.windows.create({
      state: 'normal',
      focused: false,
      left: 10,
      top: 20,
      width: 800,
      height: 600,
    });
    expect(normal?.state).toBe('normal');
    expect(normal?.left).toBe(10);
    const maximized = await chrome.windows.create({ state: 'maximized', focused: true });
    expect(maximized?.state).toBe('maximized');
    const minimized = await chrome.windows.create({ state: 'minimized', focused: false });
    expect(minimized?.state).toBe('minimized');
    // No state at all: bounds and focus are unconstrained.
    const plain = await chrome.windows.create({ focused: false, width: 640 });
    expect(plain?.state).toBe('normal');
  });
});

describe('chrome fake: groups', () => {
  it('tabs.group assigns a fresh group id and sets groupId on members', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test' });
    const b = await chrome.tabs.create({ url: 'https://b.test' });
    const c = await chrome.tabs.create({ url: 'https://c.test' });
    if (a.id === undefined || b.id === undefined || c.id === undefined) {
      throw new Error('expected ids');
    }
    const g1 = await chrome.tabs.group({ tabIds: [a.id, b.id], createProperties: { windowId: 1 } });
    const g2 = await chrome.tabs.group({ tabIds: [c.id] });
    expect(g1).not.toBe(g2);

    const grouped = await chrome.tabs.query({ groupId: g1 });
    expect(grouped.map((tab) => tab.id)).toEqual([a.id, b.id]);

    await chrome.tabGroups.update(g1, { title: 'Work', color: 'blue', collapsed: true });
    expect(await chrome.tabGroups.get(g1)).toMatchObject({
      id: g1,
      windowId: 1,
      title: 'Work',
      color: 'blue',
      collapsed: true,
    });
    expect((await chrome.tabGroups.query({})).length).toBe(2);
  });

  it('refuses to group a pinned tab', async () => {
    const p = await chrome.tabs.create({ url: 'https://p.test', pinned: true });
    if (p.id === undefined) {
      throw new Error('expected id');
    }
    await expect(chrome.tabs.group({ tabIds: [p.id] })).rejects.toThrow(
      'Tabs cannot be pinned and grouped.',
    );
  });
});

describe('chrome fake: storage', () => {
  it('storage.onChanged fires with old and new values for the local area', async () => {
    const seen: Array<[Record<string, chrome.storage.StorageChange>, string]> = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      seen.push([changes, area]);
    });
    await chrome.storage.local.set({ k: 1 });
    await chrome.storage.local.set({ k: 2 });
    await chrome.storage.local.remove('k');
    expect(seen).toEqual([
      [{ k: { oldValue: undefined, newValue: 1 } }, 'local'],
      [{ k: { oldValue: 1, newValue: 2 } }, 'local'],
      [{ k: { oldValue: 2 } }, 'local'],
    ]);
  });

  it('get returns copies, honours defaults objects and null (everything)', async () => {
    await chrome.storage.local.set({ a: { n: 1 }, b: 'x' });
    const all = await chrome.storage.local.get(null);
    expect(all).toEqual({ a: { n: 1 }, b: 'x' });
    const withDefault = await chrome.storage.local.get({ a: 0, missing: 'dflt' });
    expect(withDefault).toEqual({ a: { n: 1 }, missing: 'dflt' });
    const stored = getChromeFake().state.local.get('a');
    expect(stored).toEqual({ n: 1 });
    expect(stored).not.toBe(all.a);
  });

  it('getKeys lists keys and getBytesInUse counts JSON bytes', async () => {
    await chrome.storage.local.set({ 'session:1': { x: 1 }, sessionIndex: [] });
    expect((await chrome.storage.local.getKeys()).sort()).toEqual(['session:1', 'sessionIndex']);
    expect(await chrome.storage.local.getBytesInUse('sessionIndex')).toBe(
      'sessionIndex'.length + '[]'.length,
    );
    expect(await chrome.storage.local.getBytesInUse(null)).toBe(
      'sessionIndex'.length + 2 + 'session:1'.length + JSON.stringify({ x: 1 }).length,
    );
  });

  it('sync is a separate area', async () => {
    await chrome.storage.sync.set({ s: 1 });
    expect(await chrome.storage.local.get('s')).toEqual({});
    expect(await chrome.storage.sync.get('s')).toEqual({ s: 1 });
  });
});

describe('chrome fake: failNext and events', () => {
  it('failNext rejects exactly N calls, then succeeds', async () => {
    getChromeFake().failNext('tabs.create', 2, 'Tabs cannot be edited right now');
    await expect(chrome.tabs.create({ url: 'https://a.test' })).rejects.toThrow(
      'Tabs cannot be edited right now',
    );
    await expect(chrome.tabs.create({ url: 'https://a.test' })).rejects.toThrow(
      'Tabs cannot be edited right now',
    );
    const ok = await chrome.tabs.create({ url: 'https://a.test' });
    expect(ok.url).toBe('https://a.test');
    expect(getChromeFake().state.createdTabs.length).toBe(1);
  });

  it('fire helpers reach registered listeners', () => {
    const fake = getChromeFake();
    const log: string[] = [];
    chrome.runtime.onInstalled.addListener((details) => {
      log.push(`installed:${details.reason}`);
    });
    chrome.runtime.onStartup.addListener(() => {
      log.push('startup');
    });
    chrome.contextMenus.onClicked.addListener((info) => {
      log.push(`menu:${String(info.menuItemId)}`);
    });
    chrome.commands.onCommand.addListener((name) => {
      log.push(`command:${name}`);
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
      log.push(`alarm:${alarm.name}`);
    });
    fake.fire.installed({ reason: 'install' });
    fake.fire.startup();
    fake.fire.menuClicked('save-window');
    fake.fire.command('open-dashboard');
    fake.fire.alarm('history-snapshot');
    expect(log).toEqual([
      'installed:install',
      'startup',
      'menu:save-window',
      'command:open-dashboard',
      'alarm:history-snapshot',
    ]);
  });

  it('fire.actionClicked reaches every action.onClicked listener with the active tab', async () => {
    const fake = getChromeFake();
    const seen: string[] = [];
    // Two listeners, as in the real worker (sort in index.ts + snapshot in sessions.ts).
    chrome.action.onClicked.addListener((tab) => {
      seen.push(`first:${tab.url}`);
    });
    chrome.action.onClicked.addListener((tab) => {
      seen.push(`second:${tab.url}`);
    });

    // No tab at all: Chrome never fires the event without a tab, and neither does the fake.
    fake.fire.actionClicked();
    expect(seen).toEqual([]);

    await chrome.windows.create({ url: 'https://a.test/' });
    fake.fire.actionClicked();
    expect(seen).toEqual(['first:https://a.test/', 'second:https://a.test/']);
  });

  it('runtime, badge, menus and alarms are inspectable', async () => {
    const fake = getChromeFake();
    expect(chrome.runtime.id).toBe('fakeextid');
    expect(chrome.runtime.getURL('/dashboard.html')).toBe(
      'chrome-extension://fakeextid/dashboard.html',
    );
    expect(chrome.runtime.getManifest().version).toBe('7.0.0');
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    expect(fake.state.badge).toEqual({ text: '✓', color: '#16a34a' });
    chrome.contextMenus.create({ id: 'x', title: 'X', contexts: ['action'] });
    expect(fake.state.menus.map((menu) => menu.id)).toEqual(['x']);
    await chrome.contextMenus.removeAll();
    expect(fake.state.menus).toEqual([]);
    await chrome.alarms.create('history-snapshot', { periodInMinutes: 5 });
    expect((await chrome.alarms.getAll()).map((alarm) => alarm.name)).toEqual(['history-snapshot']);
    expect(await chrome.alarms.clear('history-snapshot')).toBe(true);
    expect(await chrome.extension.isAllowedFileSchemeAccess()).toBe(false);
    fake.state.fileAccessAllowed = true;
    expect(await chrome.extension.isAllowedFileSchemeAccess()).toBe(true);
  });

  it('a fresh fake is installed for every test', () => {
    expect(getChromeFake().state.tabs.size).toBe(0);
  });
});

describe('chrome fake: tab / window / group events', () => {
  /** Every event the dashboard's open-windows pane subscribes to, as `name -> emitted args`. */
  function recordAll(): string[] {
    const log: string[] = [];
    chrome.tabs.onCreated.addListener((tab) => log.push(`tabs.onCreated:${String(tab.id)}`));
    chrome.tabs.onRemoved.addListener((tabId, info) =>
      log.push(`tabs.onRemoved:${tabId}:${String(info.isWindowClosing)}:${info.windowId}`),
    );
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) =>
      log.push(`tabs.onUpdated:${tabId}:${Object.keys(changeInfo).join(',')}`),
    );
    chrome.tabs.onMoved.addListener((tabId, info) =>
      log.push(`tabs.onMoved:${tabId}:${info.fromIndex}->${info.toIndex}`),
    );
    chrome.tabs.onAttached.addListener((tabId, info) =>
      log.push(`tabs.onAttached:${tabId}:${info.newWindowId}`),
    );
    chrome.tabs.onDetached.addListener((tabId, info) =>
      log.push(`tabs.onDetached:${tabId}:${info.oldWindowId}`),
    );
    chrome.tabs.onActivated.addListener((info) =>
      log.push(`tabs.onActivated:${info.tabId}:${info.windowId}`),
    );
    chrome.tabs.onReplaced.addListener((added, removed) =>
      log.push(`tabs.onReplaced:${added}:${removed}`),
    );
    chrome.windows.onCreated.addListener((win) => log.push(`windows.onCreated:${String(win.id)}`));
    chrome.windows.onRemoved.addListener((id) => log.push(`windows.onRemoved:${id}`));
    chrome.windows.onFocusChanged.addListener((id) => log.push(`windows.onFocusChanged:${id}`));
    chrome.tabGroups.onCreated.addListener((g) => log.push(`tabGroups.onCreated:${g.id}`));
    chrome.tabGroups.onUpdated.addListener((g) =>
      log.push(`tabGroups.onUpdated:${g.id}:${g.title}`),
    );
    chrome.tabGroups.onRemoved.addListener((g) => log.push(`tabGroups.onRemoved:${g.id}`));
    chrome.tabGroups.onMoved.addListener((g) => log.push(`tabGroups.onMoved:${g.id}`));
    return log;
  }

  it('tabs.create fires onCreated, then onActivated when the new tab takes focus', async () => {
    const log = recordAll();
    const tab = await chrome.tabs.create({ url: 'https://a.test' });
    expect(log).toEqual([
      `tabs.onCreated:${String(tab.id)}`,
      `tabs.onActivated:${String(tab.id)}:1`,
    ]);
  });

  it('a background tabs.create fires onCreated only', async () => {
    await chrome.tabs.create({ url: 'https://first.test' });
    const log = recordAll();
    const tab = await chrome.tabs.create({ url: 'https://a.test', active: false });
    expect(log).toEqual([`tabs.onCreated:${String(tab.id)}`]);
  });

  it('tabs.remove fires onRemoved and activates the neighbour', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test', active: false });
    const b = await chrome.tabs.create({ url: 'https://b.test' });
    if (a.id === undefined || b.id === undefined) {
      throw new Error('expected ids');
    }
    const log = recordAll();
    await chrome.tabs.remove(b.id);
    expect(log).toEqual([`tabs.onRemoved:${b.id}:false:1`, `tabs.onActivated:${a.id}:1`]);
  });

  it('closing the last tab of a window fires onRemoved with isWindowClosing and windows.onRemoved', async () => {
    const win = await chrome.windows.create({ url: 'https://only.test', focused: false });
    const tabId = win?.tabs?.[0]?.id;
    if (win?.id === undefined || tabId === undefined) {
      throw new Error('expected window and tab');
    }
    const log = recordAll();
    await chrome.tabs.remove(tabId);
    expect(log).toEqual([`tabs.onRemoved:${tabId}:true:${win.id}`, `windows.onRemoved:${win.id}`]);
  });

  it('windows.create fires windows.onCreated, onFocusChanged and the tab events', async () => {
    const log = recordAll();
    const win = await chrome.windows.create({ url: 'https://w.test' });
    const tabId = win?.tabs?.[0]?.id;
    expect(log).toEqual([
      `windows.onCreated:${String(win?.id)}`,
      `windows.onFocusChanged:${String(win?.id)}`,
      `tabs.onCreated:${String(tabId)}`,
      `tabs.onActivated:${String(tabId)}:${String(win?.id)}`,
    ]);
  });

  it('windows.remove fires onRemoved for every tab, then windows.onRemoved', async () => {
    const win = await chrome.windows.create({ url: 'https://a.test', focused: false });
    if (win?.id === undefined) {
      throw new Error('expected window');
    }
    await chrome.tabs.create({ windowId: win.id, url: 'https://b.test', active: false });
    const log = recordAll();
    await chrome.windows.remove(win.id);
    const removals = log.filter((entry) => entry.startsWith('tabs.onRemoved:'));
    expect(removals).toHaveLength(2);
    expect(removals.every((entry) => entry.includes(':true:'))).toBe(true);
    expect(log.at(-1)).toBe(`windows.onRemoved:${win.id}`);
  });

  it('windows.update fires onFocusChanged, with WINDOW_ID_NONE when focus is dropped', async () => {
    const log = recordAll();
    await chrome.windows.update(1, { focused: false });
    await chrome.windows.update(1, { focused: true });
    await chrome.windows.update(1, { focused: true });
    expect(log).toEqual(['windows.onFocusChanged:-1', 'windows.onFocusChanged:1']);
  });

  it('tabs.move fires onMoved inside a window and onDetached/onAttached across windows', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test', active: false });
    const b = await chrome.tabs.create({ url: 'https://b.test', active: false });
    const other = await chrome.windows.create({ url: 'https://o.test', focused: false });
    if (a.id === undefined || b.id === undefined || other?.id === undefined) {
      throw new Error('expected ids');
    }
    const log = recordAll();
    await chrome.tabs.move(b.id, { index: 0 });
    await chrome.tabs.move(a.id, { windowId: other.id, index: -1 });
    expect(log).toEqual([
      `tabs.onMoved:${b.id}:1->0`,
      `tabs.onDetached:${a.id}:1`,
      `tabs.onAttached:${a.id}:${other.id}`,
    ]);
  });

  it('tabs.update fires onUpdated for url and pinned changes only', async () => {
    const tab = await chrome.tabs.create({ url: 'https://a.test' });
    if (tab.id === undefined) {
      throw new Error('expected id');
    }
    const log = recordAll();
    await chrome.tabs.update(tab.id, { url: 'https://b.test' });
    await chrome.tabs.update(tab.id, { pinned: true });
    await chrome.tabs.update(tab.id, { active: true });
    expect(log).toEqual([`tabs.onUpdated:${tab.id}:url`, `tabs.onUpdated:${tab.id}:pinned`]);
  });

  it('grouping fires tabGroups.onCreated plus a tabs.onUpdated per member, ungrouping onRemoved', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test', active: false });
    const b = await chrome.tabs.create({ url: 'https://b.test', active: false });
    if (a.id === undefined || b.id === undefined) {
      throw new Error('expected ids');
    }
    const log = recordAll();
    const groupId = await chrome.tabs.group({ tabIds: [a.id, b.id] });
    await chrome.tabGroups.update(groupId, { title: 'Work' });
    await chrome.tabGroups.move(groupId, { index: -1 });
    await chrome.tabs.ungroup([a.id, b.id]);
    expect(log).toEqual([
      `tabGroups.onCreated:${groupId}`,
      `tabs.onUpdated:${a.id}:groupId`,
      `tabs.onUpdated:${b.id}:groupId`,
      `tabGroups.onUpdated:${groupId}:Work`,
      `tabGroups.onMoved:${groupId}`,
      `tabs.onUpdated:${a.id}:groupId`,
      `tabs.onUpdated:${b.id}:groupId`,
      `tabGroups.onRemoved:${groupId}`,
    ]);
  });

  it('fire.tabReplaced reaches tabs.onReplaced listeners', () => {
    const log = recordAll();
    getChromeFake().fire.tabReplaced(9, 8);
    expect(log).toEqual(['tabs.onReplaced:9:8']);
  });

  it('removeListener stops delivery', async () => {
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    chrome.tabs.onCreated.addListener(listener);
    expect(chrome.tabs.onCreated.hasListener(listener)).toBe(true);
    await chrome.tabs.create({ url: 'https://a.test', active: false });
    chrome.tabs.onCreated.removeListener(listener);
    expect(chrome.tabs.onCreated.hasListener(listener)).toBe(false);
    await chrome.tabs.create({ url: 'https://b.test', active: false });
    expect(calls).toBe(1);
  });
});
