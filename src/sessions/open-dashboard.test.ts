import { describe, expect, it } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import { openDashboard } from './open-dashboard';

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
});
