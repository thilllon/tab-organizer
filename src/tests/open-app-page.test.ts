import { describe, expect, it, vi } from 'vitest';

import { openDashboard } from '@/lib/open-app-page';

import { getChromeFake } from './chrome-fake';

const APP_URL = 'chrome-extension://fakeextid/app.html';

describe('openDashboard', () => {
  it('creates the app tab when none exists', async () => {
    await chrome.windows.create({ url: 'https://a.example/' });

    await openDashboard();

    const fake = getChromeFake();
    const dashboardTabs = [...fake.state.tabs.values()].filter((t) => t.url === APP_URL);
    expect(dashboardTabs).toHaveLength(1);
    expect(dashboardTabs[0].active).toBe(true);
  });

  it('focuses the existing app tab and its window instead of creating a second one', async () => {
    const fake = getChromeFake();
    const winA = await chrome.windows.create({ url: 'https://a.example/' });
    const winB = await chrome.windows.create({ url: 'https://b.example/' });
    if (winA?.id === undefined || winB?.id === undefined) {
      throw new Error('fake windows.create returned nothing');
    }
    const existing = await chrome.tabs.create({
      windowId: winA.id,
      url: `${APP_URL}#saved`,
      active: false,
    });
    await chrome.windows.update(winB.id, { focused: true });

    await openDashboard();

    const dashboardTabs = [...fake.state.tabs.values()].filter((t) => t.url.startsWith(APP_URL));
    expect(dashboardTabs).toHaveLength(1);
    expect(dashboardTabs[0].id).toBe(existing.id);
    expect(dashboardTabs[0].active).toBe(true);
    expect(fake.state.windows.get(winA.id)?.focused).toBe(true);
    expect(fake.state.windows.get(winB.id)?.focused).toBe(false);
  });

  it('opens a new app tab straight at the requested view', async () => {
    await chrome.windows.create({ url: 'https://a.example/' });

    await openDashboard('#settings');

    const dashboardTabs = [...getChromeFake().state.tabs.values()].filter((t) =>
      t.url.startsWith(APP_URL),
    );
    expect(dashboardTabs.map((t) => t.url)).toEqual([`${APP_URL}#settings`]);
  });

  it('points an open app tab at the requested view and focuses it, without a second tab', async () => {
    const fake = getChromeFake();
    const win = await chrome.windows.create({ url: 'https://a.example/' });
    if (win?.id === undefined) {
      throw new Error('fake windows.create returned nothing');
    }
    const existing = await chrome.tabs.create({
      windowId: win.id,
      url: `${APP_URL}#saved/abc`,
      active: false,
    });

    await openDashboard('#settings');

    const dashboardTabs = [...fake.state.tabs.values()].filter((t) => t.url.startsWith(APP_URL));
    expect(dashboardTabs).toHaveLength(1);
    expect(dashboardTabs[0].id).toBe(existing.id);
    expect(dashboardTabs[0].url).toBe(`${APP_URL}#settings`);
    expect(dashboardTabs[0].active).toBe(true);
  });

  it('leaves an app tab already at that view alone apart from focusing it', async () => {
    const win = await chrome.windows.create({ url: 'https://a.example/' });
    if (win?.id === undefined) {
      throw new Error('fake windows.create returned nothing');
    }
    const existing = await chrome.tabs.create({
      windowId: win.id,
      url: `${APP_URL}#settings`,
      active: false,
    });
    const update = vi.spyOn(chrome.tabs, 'update');

    await openDashboard('#settings');

    expect(update).toHaveBeenCalledWith(existing.id, { active: true });
  });
});
