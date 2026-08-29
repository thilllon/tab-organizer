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
