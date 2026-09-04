import { describe, expect, it } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import { closeTab, closeWindow, currentWindowTarget, goToTab } from './window-actions';

describe('goToTab', () => {
  it('activates the tab and focuses its window', async () => {
    const fake = getChromeFake();
    const other = await chrome.windows.create({ url: 'https://other.example/' });
    const target = await chrome.tabs.create({
      windowId: 1,
      url: 'https://target.example/',
      active: false,
    });
    if (other?.id === undefined || target.id === undefined) {
      throw new Error('expected ids');
    }

    expect(await goToTab(target.id, 1)).toEqual({ ok: true });

    expect(fake.state.tabs.get(target.id)?.active).toBe(true);
    expect(fake.state.windows.get(1)?.focused).toBe(true);
    expect(fake.state.windows.get(other.id)?.focused).toBe(false);
  });

  it('reports a tab that is already gone instead of throwing', async () => {
    expect(await goToTab(4242, 1)).toEqual({ ok: false, reason: 'No tab with id: 4242.' });
  });
});

describe('closeTab', () => {
  it('removes the tab', async () => {
    const fake = getChromeFake();
    const keep = await chrome.tabs.create({ url: 'https://keep.example/', active: false });
    const doomed = await chrome.tabs.create({ url: 'https://doomed.example/', active: false });
    if (doomed.id === undefined) {
      throw new Error('expected id');
    }

    expect(await closeTab(doomed.id)).toEqual({ ok: true });

    expect(fake.state.tabs.has(doomed.id)).toBe(false);
    expect(fake.state.tabs.has(keep.id ?? -1)).toBe(true);
  });

  it('reports a rejection as { ok: false }', async () => {
    expect(await closeTab(4242)).toEqual({ ok: false, reason: 'No tab with id: 4242.' });
  });
});

describe('closeWindow', () => {
  it('removes the window and every tab in it', async () => {
    const fake = getChromeFake();
    const win = await chrome.windows.create({ url: 'https://a.example/' });
    if (win?.id === undefined) {
      throw new Error('expected window');
    }
    await chrome.tabs.create({ windowId: win.id, url: 'https://b.example/', active: false });

    expect(await closeWindow(win.id)).toEqual({ ok: true });

    expect(fake.state.windows.has(win.id)).toBe(false);
    expect([...fake.state.tabs.values()].some((tab) => tab.windowId === win.id)).toBe(false);
  });

  it('reports a rejection as { ok: false }', async () => {
    expect(await closeWindow(4242)).toEqual({ ok: false, reason: 'No window with id: 4242.' });
  });
});

describe('currentWindowTarget', () => {
  it('targets the window the dashboard is in', async () => {
    const win = await chrome.windows.create({ url: 'https://a.example/', focused: true });

    expect(await currentWindowTarget()).toEqual({ kind: 'window', windowId: win?.id });
  });
});
