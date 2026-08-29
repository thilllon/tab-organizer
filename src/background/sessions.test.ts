import { afterEach, describe, expect, it, vi } from 'vitest';
import { INDEX_KEY } from '@/sessions/storage';
import { getChromeFake } from '@/test/chrome-fake';
import type { SessionIndex } from '@/types';
import {
  clearBadge,
  handleMenuOrCommand,
  MENU_IDS,
  registerContextMenus,
  showSavedBadge,
} from './sessions';

const DASHBOARD_URL = 'chrome-extension://fakeextid/dashboard.html';

async function seedWindow(urls: string[], focused: boolean): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0] });
  if (win === undefined || win.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  await chrome.windows.update(win.id, { focused });
  return win.id;
}

function sessionKeys(): string[] {
  return [...getChromeFake().state.local.keys()].filter((key) => key.startsWith('session:'));
}

function readIndex(): SessionIndex | undefined {
  const raw = getChromeFake().state.local.get(INDEX_KEY);
  return raw as SessionIndex | undefined;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registerContextMenus', () => {
  it('is idempotent: removeAll then exactly 3 items + 1 separator', async () => {
    await registerContextMenus();
    await registerContextMenus();

    const menus = getChromeFake().state.menus;
    expect(menus).toHaveLength(4);
    expect(menus.map((m) => m.id)).toEqual([
      MENU_IDS.saveWindow,
      MENU_IDS.saveAll,
      'sessions-separator',
      MENU_IDS.openDashboard,
    ]);
    expect(menus.filter((m) => m.type !== 'separator').map((m) => m.title)).toEqual([
      'Save this window as session',
      'Save all windows as session',
      'Open Sessions',
    ]);
    for (const menu of menus) {
      expect(menu.contexts).toEqual(['action']);
    }
  });
});

describe('badge', () => {
  it('showSavedBadge shows ✓ and clears itself after 2 s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = getChromeFake();

    showSavedBadge();
    expect(fake.state.badge.text).toBe('✓');
    expect(fake.state.badge.color).toBe('#16a34a');

    vi.advanceTimersByTime(1999);
    expect(fake.state.badge.text).toBe('✓');
    vi.advanceTimersByTime(1);
    expect(fake.state.badge.text).toBe('');
  });

  it('clearBadge empties the badge text', () => {
    const fake = getChromeFake();
    fake.state.badge.text = '✓';
    clearBadge();
    expect(fake.state.badge.text).toBe('');
  });
});

describe('handleMenuOrCommand', () => {
  it("'save-window' writes one session:* key plus the index and sets the badge", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/', 'https://b.example/2', 'https://b.example/3'], true);

    await handleMenuOrCommand('save-window');

    const keys = sessionKeys();
    expect(keys).toHaveLength(1);
    const index = readIndex();
    expect(index?.sessions).toHaveLength(1);
    expect(index?.sessions[0].id).toBe(keys[0].slice('session:'.length));
    expect(index?.sessions[0].windowCount).toBe(1);
    expect(index?.sessions[0].tabCount).toBe(3);
    expect(getChromeFake().state.badge.text).toBe('✓');
  });

  it("'save-session' (keyboard command) behaves like 'save-window'", async () => {
    await seedWindow(['https://a.example/'], true);
    await handleMenuOrCommand('save-session');
    expect(sessionKeys()).toHaveLength(1);
    expect(readIndex()?.sessions[0].windowCount).toBe(1);
  });

  it("'save-all' captures every window", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    await handleMenuOrCommand('save-all');

    expect(sessionKeys()).toHaveLength(1);
    expect(readIndex()?.sessions[0].windowCount).toBe(2);
    expect(readIndex()?.sessions[0].tabCount).toBe(3);
  });

  it("'open-dashboard' focuses an existing dashboard tab instead of creating a second", async () => {
    const fake = getChromeFake();
    const winA = await seedWindow(['https://a.example/', DASHBOARD_URL], false);
    await seedWindow(['https://b.example/'], true);
    const tabsBefore = fake.state.tabs.size;

    await handleMenuOrCommand('open-dashboard');

    expect(fake.state.tabs.size).toBe(tabsBefore);
    const dashboard = [...fake.state.tabs.values()].find((t) => t.url === DASHBOARD_URL);
    expect(dashboard?.active).toBe(true);
    expect(fake.state.windows.get(winA)?.focused).toBe(true);
    expect(fake.state.badge.text).toBe('');
  });

  it('ignores unknown ids', async () => {
    await handleMenuOrCommand('nope');
    expect(sessionKeys()).toHaveLength(0);
    expect(getChromeFake().state.tabs.size).toBe(0);
  });
});

describe('listener wiring', () => {
  it('a context-menu click on save-window saves a session', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.menuClicked(MENU_IDS.saveWindow);

    await vi.waitFor(() => {
      expect(sessionKeys()).toHaveLength(1);
    });
  });

  it('the save-session command saves a session', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.command('save-session');

    await vi.waitFor(() => {
      expect(sessionKeys()).toHaveLength(1);
    });
  });

  it('onInstalled registers the menus', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();

    fake.fire.installed({ reason: 'install' });

    await vi.waitFor(() => {
      expect(fake.state.menus).toHaveLength(4);
    });
  });
});
