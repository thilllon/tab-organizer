import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import {
  OPEN_WINDOWS_DEBOUNCE_MS,
  snapshotOpenWindows,
  subscribeOpenWindows,
} from './open-windows';

const OWN_PREFIX = 'chrome-extension://fakeextid/';

/** Creates a window with `urls` in strip order and returns its id. */
async function seedWindow(urls: string[]): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0], focused: false });
  if (win?.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  return win.id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('snapshotOpenWindows', () => {
  it('mirrors the tab strip and carries the window, group and tab runtime ids', async () => {
    const fake = getChromeFake();
    const [firstWindowId] = [...fake.state.windows.keys()];
    const windowId = await seedWindow([
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
    ]);
    const strip = await chrome.tabs.query({ windowId });
    const ids = strip.map((tab) => tab.id ?? -1);
    await chrome.tabs.update(ids[0], { pinned: true });
    const groupId = await chrome.tabs.group({ tabIds: [ids[1], ids[2]] });
    await chrome.tabGroups.update(groupId, { title: 'Work', color: 'blue', collapsed: true });

    const views = await snapshotOpenWindows({ excludeUrlPrefix: OWN_PREFIX });

    const view = views.find((entry) => entry.windowId === windowId);
    expect(views.map((entry) => entry.windowId)).toEqual([firstWindowId, windowId]);
    expect(view?.state).toBe('normal');
    expect(view?.groups).toEqual([{ title: 'Work', color: 'blue', collapsed: true, groupId }]);
    expect(view?.tabs).toEqual([
      {
        url: 'https://a.example/',
        title: 'https://a.example/',
        pinned: true,
        active: true,
        tabId: ids[0],
      },
      {
        url: 'https://b.example/',
        title: 'https://b.example/',
        pinned: false,
        active: false,
        groupIndex: 0,
        tabId: ids[1],
      },
      {
        url: 'https://c.example/',
        title: 'https://c.example/',
        pinned: false,
        active: false,
        groupIndex: 0,
        tabId: ids[2],
      },
    ]);
  });

  it('hides own extension pages but keeps the window they live in', async () => {
    const windowId = await seedWindow([`${OWN_PREFIX}dashboard.html`]);

    const views = await snapshotOpenWindows({ excludeUrlPrefix: OWN_PREFIX });

    const view = views.find((entry) => entry.windowId === windowId);
    expect(view).toBeDefined();
    expect(view?.tabs).toEqual([]);
  });

  it('shows own extension pages when no excludeUrlPrefix is given', async () => {
    const windowId = await seedWindow([`${OWN_PREFIX}dashboard.html`]);

    const views = await snapshotOpenWindows();

    expect(views.find((entry) => entry.windowId === windowId)?.tabs).toHaveLength(1);
  });

  it('unwraps a suspended tab to the page it stands for', async () => {
    await chrome.storage.sync.set({ tabSuspenderExtensionId: 'suspenderid' });
    const windowId = await seedWindow([
      'chrome-extension://suspenderid/suspended.html#ttl=Hi&uri=https://real.example/page',
    ]);

    const views = await snapshotOpenWindows({ excludeUrlPrefix: OWN_PREFIX });

    expect(views.find((entry) => entry.windowId === windowId)?.tabs[0].url).toBe(
      'https://real.example/page',
    );
  });

  it('drops incognito windows', async () => {
    const win = await chrome.windows.create({ url: 'https://secret.example/', incognito: true });
    if (win?.id === undefined) {
      throw new Error('expected window');
    }

    const views = await snapshotOpenWindows({ excludeUrlPrefix: OWN_PREFIX });

    expect(views.map((entry) => entry.windowId)).not.toContain(win.id);
  });
});

describe('subscribeOpenWindows', () => {
  it('coalesces a burst of events into a single onChange after the debounce', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const unsubscribe = subscribeOpenWindows(() => {
      calls += 1;
    });

    await chrome.tabs.create({ url: 'https://a.test', active: false });
    await chrome.tabs.create({ url: 'https://b.test', active: false });
    await chrome.tabs.create({ url: 'https://c.test', active: false });
    expect(calls).toBe(0);

    vi.advanceTimersByTime(OPEN_WINDOWS_DEBOUNCE_MS);
    expect(calls).toBe(1);

    await chrome.tabs.create({ url: 'https://d.test', active: false });
    vi.advanceTimersByTime(OPEN_WINDOWS_DEBOUNCE_MS);
    expect(calls).toBe(2);

    unsubscribe();
  });

  it('honours a custom debounce and does not fire before it elapses', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const unsubscribe = subscribeOpenWindows(
      () => {
        calls += 1;
      },
      { debounceMs: 500 },
    );

    await chrome.tabs.create({ url: 'https://a.test', active: false });
    vi.advanceTimersByTime(499);
    expect(calls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls).toBe(1);

    unsubscribe();
  });

  it('reacts to every tab, window and group event it registers for', async () => {
    vi.useFakeTimers();
    const fake = getChromeFake();
    // A tab that keeps the focus in window 1, so the tabs created below start inactive and
    // `tabs.update({ active: true })` really is a change of the active tab.
    await chrome.tabs.create({ url: 'https://filler.test' });
    const seen: string[] = [];
    const unsubscribe = subscribeOpenWindows(() => {
      seen.push('change');
    });

    const emitters: [string, () => Promise<unknown> | unknown][] = [
      ['tabs.onCreated', () => chrome.tabs.create({ url: 'https://a.test', active: false })],
      [
        'tabs.onUpdated',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://a.test' });
          await chrome.tabs.update(tab.id ?? -1, { url: 'https://a2.test' });
        },
      ],
      [
        'tabs.onActivated',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://a2.test' });
          await chrome.tabs.update(tab.id ?? -1, { active: true });
        },
      ],
      [
        'tabs.onMoved',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://a2.test' });
          await chrome.tabs.move(tab.id ?? -1, { index: 0 });
        },
      ],
      [
        'tabGroups.onCreated',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://a2.test' });
          await chrome.tabs.group({ tabIds: [tab.id ?? -1] });
        },
      ],
      [
        'tabGroups.onUpdated',
        async () => {
          const [group] = await chrome.tabGroups.query({});
          await chrome.tabGroups.update(group.id, { title: 'G' });
        },
      ],
      [
        'tabGroups.onMoved',
        async () => {
          const [group] = await chrome.tabGroups.query({});
          await chrome.tabGroups.move(group.id, { index: -1 });
        },
      ],
      ['windows.onCreated', () => chrome.windows.create({ url: 'https://w.test' })],
      ['windows.onFocusChanged', () => chrome.windows.update(1, { focused: true })],
      ['tabs.onReplaced', () => fake.fire.tabReplaced(1, 2)],
      [
        'tabs.onDetached/onAttached',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://w.test' });
          await chrome.tabs.move(tab.id ?? -1, { windowId: 1, index: -1 });
        },
      ],
      [
        'tabs.onRemoved',
        async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://a2.test' });
          await chrome.tabs.remove(tab.id ?? -1);
        },
      ],
      [
        'windows.onRemoved',
        async () => {
          const extra = (await chrome.windows.getAll()).find((win) => win.id !== 1);
          await chrome.windows.remove(extra?.id ?? -1);
        },
      ],
    ];

    for (const [name, mutate] of emitters) {
      seen.length = 0;
      await mutate();
      vi.advanceTimersByTime(OPEN_WINDOWS_DEBOUNCE_MS);
      expect(seen, name).toEqual(['change']);
    }

    unsubscribe();
  });

  it('removes every listener and cancels a pending timer on unsubscribe', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const unsubscribe = subscribeOpenWindows(() => {
      calls += 1;
    });

    await chrome.tabs.create({ url: 'https://a.test', active: false });
    unsubscribe();
    vi.advanceTimersByTime(OPEN_WINDOWS_DEBOUNCE_MS * 10);
    expect(calls).toBe(0);

    await chrome.tabs.create({ url: 'https://b.test', active: false });
    vi.advanceTimersByTime(OPEN_WINDOWS_DEBOUNCE_MS * 10);
    expect(calls).toBe(0);
    expect(chrome.tabs.onCreated.hasListeners()).toBe(false);
    expect(chrome.tabGroups.onUpdated.hasListeners()).toBe(false);
    expect(chrome.windows.onFocusChanged.hasListeners()).toBe(false);
  });
});
