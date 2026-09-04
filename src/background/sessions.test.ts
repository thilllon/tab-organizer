import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_ALARM, HISTORY_FIRST_ALARM } from '@/sessions/history';
import { INDEX_KEY, SETTINGS_KEY } from '@/sessions/storage';
import { getChromeFake } from '@/test/chrome-fake';
import { SESSION_SCHEMA_VERSION, type Session, type SessionIndex } from '@/types';
import {
  COMMAND_IDS,
  clearBadge,
  handleMenuOrCommand,
  MENU_IDS,
  registerContextMenus,
  showErrorBadge,
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

function historySummaries(): SessionIndex['sessions'] {
  return (readIndex()?.sessions ?? []).filter((summary) => summary.kind === 'history');
}

function alarmNames(): string[] {
  return [...getChromeFake().state.alarms.keys()].sort();
}

/** An unprotected alarm snapshot as `takeHistorySnapshot` would have stored it earlier. */
function historySession(id: string, createdAt: number): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    kind: 'history',
    name: 'Snapshot',
    origin: 'alarm',
    createdAt,
    updatedAt: createdAt,
    windows: [
      {
        state: 'normal',
        focused: false,
        groups: [],
        tabs: [{ url: `https://${id}.example/`, title: id, pinned: false, active: true }],
      },
    ],
  };
}

/** Loads a fresh copy of the worker module against this test's fake (see AGENTS.md "Testing"). */
async function loadWorker(): Promise<typeof import('@/sessions/storage')> {
  vi.resetModules();
  await import('./sessions');
  return await import('@/sessions/storage');
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

  it('showErrorBadge shows ! on a red background and clears itself after 2 s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = getChromeFake();

    showErrorBadge();
    expect(fake.state.badge.text).toBe('!');
    expect(fake.state.badge.color).toBe('#d93025');

    vi.advanceTimersByTime(2000);
    expect(fake.state.badge.text).toBe('');
  });

  it('a second save 1.5 s later re-arms the clear timer instead of stacking it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = getChromeFake();

    showSavedBadge();
    vi.advanceTimersByTime(1500);
    showSavedBadge();

    vi.advanceTimersByTime(500);
    expect(fake.state.badge.text).toBe('✓');
    vi.advanceTimersByTime(1500);
    expect(fake.state.badge.text).toBe('');
  });
});

describe('COMMAND_IDS', () => {
  it('matches the ids declared in the manifest', () => {
    // Source of truth: the `commands` block of `defineManifest()` in `vite.config.ts`.
    // Chrome delivers exactly these strings to `commands.onCommand`; keep both sides equal.
    expect(COMMAND_IDS.saveSession).toBe('save-session');
    expect(COMMAND_IDS.openDashboard).toBe('open-dashboard');
    expect(COMMAND_IDS.openDashboard).toBe(MENU_IDS.openDashboard);
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

  it('gives a second save in the same minute a " (2)" suffix instead of a duplicate name', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 7, 29, 14, 3).getTime() });
    await seedWindow(['https://a.example/'], true);

    await handleMenuOrCommand('save-window');
    await handleMenuOrCommand('save-window');
    await handleMenuOrCommand('save-window');

    const names = readIndex()?.sessions.map((s) => s.name) ?? [];
    expect(names.sort()).toEqual([
      'Session 2026-08-29 14:03 · 1 window · 1 tab',
      'Session 2026-08-29 14:03 · 1 window · 1 tab (2)',
      'Session 2026-08-29 14:03 · 1 window · 1 tab (3)',
    ]);
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

  it('save-window with only an extension page open shows the error badge and writes nothing', async () => {
    await seedWindow([DASHBOARD_URL], true);

    await handleMenuOrCommand('save-window');

    expect(sessionKeys()).toHaveLength(0);
    expect(getChromeFake().state.badge.text).toBe('!');
  });

  it('a failed sessionRepo.put shows the error badge, reports the error and does not throw', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedWindow(['https://a.example/'], true);
    getChromeFake().failNext('storage.local.set', 1, 'QUOTA_BYTES exceeded');

    await expect(handleMenuOrCommand('save-window')).resolves.toBeUndefined();

    expect(getChromeFake().state.badge.text).toBe('!');
    expect(errorSpy).toHaveBeenCalledWith('[tab-organizer:sessions]', expect.any(Error));
    expect(sessionKeys()).toHaveLength(0);
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

  it("onInstalled with reason 'update' registers the menus and runs migrateAll then reconcile", async () => {
    vi.resetModules();
    await import('./sessions');
    const { sessionRepo } = await import('@/sessions/storage');
    const fake = getChromeFake();
    const migrateSpy = vi.spyOn(sessionRepo, 'migrateAll');
    const reconcileSpy = vi.spyOn(sessionRepo, 'reconcile');

    fake.fire.installed({ reason: 'update', previousVersion: '6.0.0' });

    await vi.waitFor(() => {
      expect(fake.state.menus).toHaveLength(4);
      expect(migrateSpy).toHaveBeenCalledTimes(1);
      expect(reconcileSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('onStartup clears the badge and reconciles', async () => {
    vi.resetModules();
    await import('./sessions');
    const { sessionRepo } = await import('@/sessions/storage');
    const fake = getChromeFake();
    fake.state.badge.text = '✓';
    const reconcileSpy = vi.spyOn(sessionRepo, 'reconcile');

    fake.fire.startup();

    await vi.waitFor(() => {
      expect(fake.state.badge.text).toBe('');
      expect(reconcileSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('registers no chrome.tabs / windows / tabGroups listeners (AGENTS.md rule)', async () => {
    await loadWorker();

    // The fake exposes these namespaces without events on purpose: a listener registration
    // would throw at import time, so reaching this line already proves the rule holds.
    expect('onCreated' in chrome.tabs).toBe(false);
    expect('onCreated' in chrome.windows).toBe(false);
    expect('onCreated' in chrome.tabGroups).toBe(false);
    expect(chrome.alarms.onAlarm.hasListeners()).toBe(true);
    expect(chrome.action.onClicked.hasListeners()).toBe(true);
    expect(chrome.storage.onChanged.hasListeners()).toBe(true);
  });
});

describe('history wiring (spec §5)', () => {
  it(`the '${HISTORY_ALARM}' alarm takes an origin 'alarm' history snapshot`, async () => {
    await loadWorker();
    const fake = getChromeFake();
    await seedWindow(['https://a.example/', 'https://a.example/2'], true);

    fake.fire.alarm(HISTORY_ALARM);

    await vi.waitFor(() => {
      expect(historySummaries()).toHaveLength(1);
    });
    expect(historySummaries()[0]).toMatchObject({
      kind: 'history',
      origin: 'alarm',
      windowCount: 1,
      tabCount: 2,
    });
    expect(historySummaries()[0].name).toMatch(/^Snapshot /);
    expect(sessionKeys()).toHaveLength(1);
  });

  it(`the one-shot '${HISTORY_FIRST_ALARM}' alarm takes a snapshot too`, async () => {
    await loadWorker();
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.alarm(HISTORY_FIRST_ALARM);

    await vi.waitFor(() => {
      expect(historySummaries()).toHaveLength(1);
    });
    expect(historySummaries()[0].origin).toBe('alarm');
  });

  it('an unrelated alarm is ignored (no capture, no write)', async () => {
    await loadWorker();
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);
    const getAllSpy = vi.spyOn(chrome.windows, 'getAll');

    fake.fire.alarm('someone-elses-alarm');
    // Give a (wrongly) started snapshot every chance to land before asserting nothing did.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(sessionKeys()).toHaveLength(0);
  });

  it('an alarm while history is off stores nothing and never queries windows', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.setSettings({ historyEnabled: false });
    await seedWindow(['https://a.example/'], true);
    const getAllSpy = vi.spyOn(chrome.windows, 'getAll');

    fake.fire.alarm(HISTORY_ALARM);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(sessionKeys()).toHaveLength(0);
  });

  it('a failed alarm snapshot is reported, not thrown, and leaves the badge alone', async () => {
    await loadWorker();
    const fake = getChromeFake();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedWindow(['https://a.example/'], true);
    fake.failNext('storage.local.set', 1, 'QUOTA_BYTES exceeded');

    expect(() => fake.fire.alarm(HISTORY_ALARM)).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[tab-organizer:sessions]', expect.any(Error));
    });
    expect(sessionKeys()).toHaveLength(0);
    // History is silent: only explicit saves drive the action badge.
    expect(fake.state.badge.text).toBe('');
  });

  it("the icon click takes a concurrent origin 'manual' snapshot while history is on", async () => {
    await loadWorker();
    const fake = getChromeFake();
    await seedWindow(['https://a.example/', 'https://b.example/'], true);

    fake.fire.actionClicked();

    await vi.waitFor(() => {
      expect(historySummaries()).toHaveLength(1);
    });
    expect(historySummaries()[0]).toMatchObject({ origin: 'manual', tabCount: 2 });
  });

  it('the icon click takes no snapshot while history is off (windows are not queried)', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.setSettings({ historyEnabled: false });
    await seedWindow(['https://a.example/'], true);
    const getAllSpy = vi.spyOn(chrome.windows, 'getAll');

    fake.fire.actionClicked();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(sessionKeys()).toHaveLength(0);
  });

  it('the icon-click listener returns synchronously and never throws, even when storage fails', async () => {
    await loadWorker();
    const fake = getChromeFake();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedWindow(['https://a.example/'], true);
    fake.failNext('storage.local.set', 1, 'QUOTA_BYTES exceeded');

    // fire.actionClicked runs every listener synchronously: a throwing snapshot listener would
    // surface here and (in Chrome) break the sort listener registered next to it.
    expect(() => fake.fire.actionClicked()).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[tab-organizer:sessions]', expect.any(Error));
    });
    expect(sessionKeys()).toHaveLength(0);
  });

  it('a second icon click with an unchanged layout is deduplicated by the content hash', async () => {
    await loadWorker();
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.actionClicked();
    await vi.waitFor(() => {
      expect(historySummaries()).toHaveLength(1);
    });
    fake.fire.actionClicked();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(historySummaries()).toHaveLength(1);
  });

  it('turning history off through sessionSettings clears both alarms', async () => {
    const { sessionRepo } = await loadWorker();
    await chrome.alarms.create(HISTORY_ALARM, { periodInMinutes: 5 });
    await chrome.alarms.create(HISTORY_FIRST_ALARM, { delayInMinutes: 1 });
    await chrome.alarms.create('unrelated', { delayInMinutes: 3 });

    await sessionRepo.setSettings({ historyEnabled: false });

    await vi.waitFor(() => {
      expect(alarmNames()).toEqual(['unrelated']);
    });
  });

  it('turning history on / changing the interval re-arms the periodic alarm', async () => {
    const { sessionRepo } = await loadWorker();
    await sessionRepo.setSettings({ historyEnabled: false });
    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([]);
    });

    await sessionRepo.setSettings({ historyEnabled: true, historyIntervalMinutes: 30 });

    await vi.waitFor(() => {
      expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 30 });
    });
    expect(alarmNames()).toEqual([HISTORY_ALARM]);

    await sessionRepo.setSettings({ historyIntervalMinutes: 10 });

    await vi.waitFor(() => {
      expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 10 });
    });
    expect(alarmNames()).toEqual([HISTORY_ALARM]);
  });

  it('storage changes to other keys or the sync area do not touch the alarms', async () => {
    const { sessionRepo } = await loadWorker();
    const createSpy = vi.spyOn(chrome.alarms, 'create');
    const clearSpy = vi.spyOn(chrome.alarms, 'clear');

    await sessionRepo.setHistoryMeta({ lastHash: 'abcd1234', lastSnapshotAt: Date.now() });
    await chrome.storage.local.set({ unrelatedLocalKey: 1 });
    // Same key name in the wrong area (SortSettings live in sync; SessionSettings never do).
    await chrome.storage.sync.set({ [SETTINGS_KEY]: { historyEnabled: false }, sortBy: 'url' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(createSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(alarmNames()).toEqual([]);
  });

  it('removing sessionSettings falls back to the defaults (history on) and arms the alarm', async () => {
    const { sessionRepo } = await loadWorker();
    await sessionRepo.setSettings({ historyEnabled: false });
    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([]);
    });

    // Raw removal on purpose: models a future "Delete all session data" wiping the key.
    await chrome.storage.local.remove(SETTINGS_KEY);

    await vi.waitFor(() => {
      expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 5 });
    });
  });

  it('onInstalled (install) arms the periodic alarm after reconcile, with the default interval', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    const reconcileSpy = vi.spyOn(sessionRepo, 'reconcile');
    const createSpy = vi.spyOn(chrome.alarms, 'create');

    fake.fire.installed({ reason: 'install' });

    await vi.waitFor(() => {
      expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 5 });
    });
    expect(alarmNames()).toEqual([HISTORY_ALARM]);
    expect(fake.state.menus).toHaveLength(4);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(reconcileSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createSpy.mock.invocationCallOrder[0],
    );
  });

  it('onInstalled (update) re-asserts the alarm Chrome dropped, replacing without duplicates', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.setSettings({ historyIntervalMinutes: 10 });
    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([HISTORY_ALARM]);
    });
    fake.state.alarms.clear();

    fake.fire.installed({ reason: 'update', previousVersion: '6.0.0' });

    await vi.waitFor(() => {
      expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 10 });
    });
    expect(await chrome.alarms.getAll()).toHaveLength(1);
  });

  it('onInstalled leaves the alarms empty while history is off', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.setSettings({ historyEnabled: false });
    const reconcileSpy = vi.spyOn(sessionRepo, 'reconcile');

    fake.fire.installed({ reason: 'install' });

    await vi.waitFor(() => {
      expect(reconcileSpy).toHaveBeenCalledTimes(1);
      expect(fake.state.menus).toHaveLength(4);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(alarmNames()).toEqual([]);
  });

  it('onStartup promotes the last snapshot, arms the periodic alarm and the one-shot first alarm', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 7, 29, 14, 3).getTime() });
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    const olderAt = new Date(2026, 7, 29, 13, 50).getTime();
    const newestAt = new Date(2026, 7, 29, 13, 58).getTime();
    await sessionRepo.put(historySession('older', olderAt));
    await sessionRepo.put(historySession('newest', newestAt));
    fake.state.badge.text = '✓';

    fake.fire.startup();

    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([HISTORY_FIRST_ALARM, HISTORY_ALARM]);
    });
    expect(fake.state.badge.text).toBe('');
    expect(fake.state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 5 });
    expect(fake.state.alarms.get(HISTORY_FIRST_ALARM)).toEqual({ delayInMinutes: 1 });
    const byId = Object.fromEntries(
      (await sessionRepo.listSummaries()).map((s) => [s.id, [s.origin, s.protected]]),
    );
    expect(byId).toEqual({ newest: ['recovered', true], older: ['alarm', undefined] });
    expect(await sessionRepo.get('newest')).toMatchObject({
      origin: 'recovered',
      protected: true,
      name: 'Previous session (recovered) 2026-08-29 13:58',
    });
  });

  it('onStartup runs reconcile → promote → ensureHistoryAlarm → scheduleFirstSnapshot in order', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.put(historySession('only', Date.now() - 60_000));
    const reconcileSpy = vi.spyOn(sessionRepo, 'reconcile');
    const promoteSpy = vi.spyOn(sessionRepo, 'markRecovered');
    const createSpy = vi.spyOn(chrome.alarms, 'create');

    fake.fire.startup();

    await vi.waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(2);
    });
    expect(createSpy.mock.calls.map((call) => call[0])).toEqual([
      HISTORY_ALARM,
      HISTORY_FIRST_ALARM,
    ]);
    const order = [
      reconcileSpy.mock.invocationCallOrder[0],
      promoteSpy.mock.invocationCallOrder[0],
      createSpy.mock.invocationCallOrder[0],
      createSpy.mock.invocationCallOrder[1],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('onStartup with history off still promotes the recovered snapshot but arms no alarm', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    await sessionRepo.setSettings({ historyEnabled: false });
    await sessionRepo.put(historySession('last', Date.now() - 60_000));
    await chrome.alarms.create(HISTORY_ALARM, { periodInMinutes: 5 });

    fake.fire.startup();

    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([]);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(alarmNames()).toEqual([]);
    expect((await sessionRepo.get('last'))?.origin).toBe('recovered');
  });

  it('onStartup still arms the alarms when the promotion fails (error is reported)', async () => {
    const { sessionRepo } = await loadWorker();
    const fake = getChromeFake();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sessionRepo.put(historySession('gone', Date.now() - 60_000));
    // A dashboard delete racing the startup promotion: the summary is listed but the body
    // is gone by the time markRecovered runs.
    vi.spyOn(sessionRepo, 'markRecovered').mockRejectedValue(new Error('Session not found: gone'));

    fake.fire.startup();

    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([HISTORY_FIRST_ALARM, HISTORY_ALARM]);
    });
    expect(errorSpy).toHaveBeenCalledWith('[tab-organizer:sessions]', expect.any(Error));
  });

  it('the first alarm after startup captures the restored windows as a snapshot', async () => {
    await loadWorker();
    const fake = getChromeFake();

    fake.fire.startup();
    await vi.waitFor(() => {
      expect(alarmNames()).toEqual([HISTORY_FIRST_ALARM, HISTORY_ALARM]);
    });
    // Chrome finished restoring its tabs in the meantime …
    await seedWindow(['https://a.example/', 'https://a.example/2'], true);
    // … and the one-shot alarm fires 1 min later.
    fake.fire.alarm(HISTORY_FIRST_ALARM);

    await vi.waitFor(() => {
      expect(historySummaries()).toHaveLength(1);
    });
    expect(historySummaries()[0]).toMatchObject({ origin: 'alarm', tabCount: 2 });
  });
});
