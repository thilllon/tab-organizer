import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import { SESSION_SCHEMA_VERSION, type Session, type WindowSnapshot } from '@/types';
import {
  defaultHistoryName,
  ensureHistoryAlarm,
  HISTORY_ALARM,
  HISTORY_FIRST_ALARM,
  type HistorySnapshotResult,
  promoteRecoveredSnapshot,
  recoveredSnapshotName,
  scheduleFirstSnapshot,
  takeHistorySnapshot,
} from './history';
import { INDEX_KEY, sessionRepo } from './storage';

// Local time 2026-08-29 14:03 so generated names are deterministic.
const NOW = new Date(2026, 7, 29, 14, 3).getTime();
const MINUTE = 60_000;

async function seedWindow(urls: string[]): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0] });
  if (win === undefined || win.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  return win.id;
}

function makeWindow(urls: string[]): WindowSnapshot {
  return {
    state: 'normal',
    focused: false,
    groups: [],
    tabs: urls.map((url, index) => ({ url, title: url, pinned: false, active: index === 0 })),
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: 'id',
    kind: 'history',
    name: 'Snapshot',
    origin: 'alarm',
    createdAt: NOW,
    updatedAt: NOW,
    windows: [makeWindow(['https://a.com/'])],
    ...overrides,
  };
}

function storedSessionIds(): string[] {
  return [...getChromeFake().state.local.keys()]
    .filter((key) => key.startsWith('session:'))
    .map((key) => key.slice('session:'.length));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('names', () => {
  it('defaultHistoryName mirrors defaultSessionName with the Snapshot noun', () => {
    expect(defaultHistoryName(new Date(2026, 7, 29, 14, 3), 3, 87)).toBe(
      'Snapshot 2026-08-29 14:03 · 3 windows · 87 tabs',
    );
    expect(defaultHistoryName(new Date(2026, 0, 5, 9, 7), 1, 1)).toBe(
      'Snapshot 2026-01-05 09:07 · 1 window · 1 tab',
    );
  });

  it('recoveredSnapshotName stamps the capture time', () => {
    expect(recoveredSnapshotName(new Date(2026, 11, 31, 23, 59))).toBe(
      'Previous session (recovered) 2026-12-31 23:59',
    );
  });
});

describe('takeHistorySnapshot', () => {
  it("returns 'disabled' and touches neither windows nor storage when history is off", async () => {
    await sessionRepo.setSettings({ historyEnabled: false });
    await seedWindow(['https://a.com/']);
    const getAllSpy = vi.spyOn(chrome.windows, 'getAll');

    await expect(takeHistorySnapshot({ origin: 'alarm' })).resolves.toEqual({
      outcome: 'disabled',
      pruned: [],
    });

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(storedSessionIds()).toEqual([]);
    await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
  });

  it("returns 'skipped-empty' when nothing is capturable (only empty/own-page windows)", async () => {
    await seedWindow([chrome.runtime.getURL('dashboard.html')]);

    await expect(takeHistorySnapshot({ origin: 'alarm' })).resolves.toEqual({
      outcome: 'skipped-empty',
      pruned: [],
    });

    expect(storedSessionIds()).toEqual([]);
    expect(getChromeFake().state.local.has(INDEX_KEY)).toBe(false);
    await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
  });

  it('stores a history session with the origin, a Snapshot name and a hash, then writes historyMeta', async () => {
    await seedWindow(['https://a.com/', 'https://b.com/']);
    await seedWindow(['https://c.com/']);

    const result = await takeHistorySnapshot({ origin: 'alarm' });

    expect(result.outcome).toBe('saved');
    expect(result.pruned).toEqual([]);
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const body = await sessionRepo.get(result.sessionId ?? '');
    expect(body).toMatchObject({
      kind: 'history',
      origin: 'alarm',
      name: 'Snapshot 2026-08-29 14:03 · 2 windows · 3 tabs',
      createdAt: NOW,
    });
    expect(body?.protected).toBeUndefined();
    expect(body?.contentHash).toMatch(/^[0-9a-f]{8}$/);
    const summaries = await sessionRepo.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ kind: 'history', windowCount: 2, tabCount: 3 });
    await expect(sessionRepo.getHistoryMeta()).resolves.toEqual({
      lastHash: body?.contentHash,
      lastSnapshotAt: NOW,
    });
  });

  it("passes 'manual' and 'startup' origins through", async () => {
    const winId = await seedWindow(['https://a.com/']);

    const manual = await takeHistorySnapshot({ origin: 'manual' });
    await chrome.tabs.create({ windowId: winId, url: 'https://b.com/', active: false });
    const startup = await takeHistorySnapshot({ origin: 'startup' });

    expect((await sessionRepo.get(manual.sessionId ?? ''))?.origin).toBe('manual');
    expect((await sessionRepo.get(startup.sessionId ?? ''))?.origin).toBe('startup');
  });

  it("skips an identical layout with 'skipped-unchanged' and leaves storage alone", async () => {
    await seedWindow(['https://a.com/', 'https://b.com/']);
    const first = await takeHistorySnapshot({ origin: 'alarm' });
    const metaBefore = await sessionRepo.getHistoryMeta();
    vi.setSystemTime(NOW + 5 * MINUTE);
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    const second = await takeHistorySnapshot({ origin: 'alarm' });

    expect(first.outcome).toBe('saved');
    expect(second).toEqual({ outcome: 'skipped-unchanged', pruned: [] });
    expect(setSpy).not.toHaveBeenCalled();
    expect(storedSessionIds()).toEqual([first.sessionId]);
    await expect(sessionRepo.getHistoryMeta()).resolves.toEqual(metaBefore);
  });

  it('a title-only change is still unchanged (titles are excluded from the hash)', async () => {
    const winId = await seedWindow(['https://a.com/']);
    await takeHistorySnapshot({ origin: 'alarm' });
    const tab = [...getChromeFake().state.tabs.values()].find((t) => t.windowId === winId);
    if (tab === undefined) {
      throw new Error('seeded tab missing');
    }
    tab.title = 'A brand new title';

    await expect(takeHistorySnapshot({ origin: 'alarm' })).resolves.toMatchObject({
      outcome: 'skipped-unchanged',
    });
  });

  it('stores a new snapshot after the layout changed and advances historyMeta', async () => {
    const winId = await seedWindow(['https://a.com/']);
    const first = await takeHistorySnapshot({ origin: 'alarm' });
    await chrome.tabs.create({ windowId: winId, url: 'https://b.com/', active: false });
    vi.setSystemTime(NOW + 5 * MINUTE);

    const second = await takeHistorySnapshot({ origin: 'alarm' });

    expect(second.outcome).toBe('saved');
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(storedSessionIds().sort()).toEqual([first.sessionId, second.sessionId].sort());
    const meta = await sessionRepo.getHistoryMeta();
    expect(meta?.lastSnapshotAt).toBe(NOW + 5 * MINUTE);
    expect(meta?.lastHash).toBe((await sessionRepo.get(second.sessionId ?? ''))?.contentHash);
    expect(meta?.lastHash).not.toBe((await sessionRepo.get(first.sessionId ?? ''))?.contentHash);
  });

  it('honours the ring size: prunes the oldest unprotected snapshots beyond historyMaxSnapshots', async () => {
    await sessionRepo.setSettings({ historyMaxSnapshots: 2 });
    const winId = await seedWindow(['https://a.com/']);
    const ids: string[] = [];
    const results: HistorySnapshotResult[] = [];
    for (const [step, url] of ['https://b.com/', 'https://c.com/', 'https://d.com/'].entries()) {
      vi.setSystemTime(NOW + step * MINUTE);
      const result = await takeHistorySnapshot({ origin: 'alarm' });
      results.push(result);
      ids.push(result.sessionId ?? '');
      await chrome.tabs.create({ windowId: winId, url, active: false });
    }
    vi.setSystemTime(NOW + 3 * MINUTE);

    const fourth = await takeHistorySnapshot({ origin: 'alarm' });

    expect(results.map((r) => r.pruned)).toEqual([[], [], [ids[0]]]);
    expect(fourth.pruned).toEqual([ids[1]]);
    expect(storedSessionIds().sort()).toEqual([ids[2], fourth.sessionId].sort());
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual([
      fourth.sessionId,
      ids[2],
    ]);
  });

  it('pruning never touches saved sessions or protected snapshots', async () => {
    await sessionRepo.setSettings({ historyMaxSnapshots: 1 });
    await sessionRepo.put(
      makeSession({ id: 'saved-old', kind: 'saved', origin: 'manual', createdAt: 1 }),
    );
    await sessionRepo.put(makeSession({ id: 'protected-old', protected: true, createdAt: 2 }));
    await sessionRepo.put(makeSession({ id: 'recovered-old', origin: 'recovered', createdAt: 3 }));
    await sessionRepo.setProtected('recovered-old', true);
    const winId = await seedWindow(['https://a.com/']);

    const first = await takeHistorySnapshot({ origin: 'alarm' });
    await chrome.tabs.create({ windowId: winId, url: 'https://b.com/', active: false });
    vi.setSystemTime(NOW + MINUTE);
    const second = await takeHistorySnapshot({ origin: 'alarm' });

    expect(first.pruned).toEqual([]);
    expect(second.pruned).toEqual([first.sessionId]);
    expect(storedSessionIds().sort()).toEqual(
      ['saved-old', 'protected-old', 'recovered-old', second.sessionId].sort(),
    );
  });

  it('propagates a storage failure and leaves historyMeta untouched', async () => {
    await seedWindow(['https://a.com/']);
    getChromeFake().failNext('storage.local.set', 1, 'QUOTA_BYTES exceeded');

    await expect(takeHistorySnapshot({ origin: 'alarm' })).rejects.toThrow('QUOTA_BYTES exceeded');

    expect(storedSessionIds()).toEqual([]);
    await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
  });
});

describe('promoteRecoveredSnapshot', () => {
  it('returns null when there is no history', async () => {
    await sessionRepo.put(makeSession({ id: 'saved', kind: 'saved', origin: 'manual' }));

    await expect(promoteRecoveredSnapshot()).resolves.toBeNull();

    expect((await sessionRepo.get('saved'))?.origin).toBe('manual');
  });

  it('promotes the newest unprotected alarm snapshot: origin, protected flag and name', async () => {
    await sessionRepo.put(makeSession({ id: 'older', createdAt: NOW - 10 * MINUTE }));
    await sessionRepo.put(makeSession({ id: 'newest', createdAt: NOW - 5 * MINUTE }));
    vi.setSystemTime(NOW + 30 * MINUTE);

    await expect(promoteRecoveredSnapshot()).resolves.toBe('newest');

    const body = await sessionRepo.get('newest');
    expect(body).toMatchObject({
      origin: 'recovered',
      protected: true,
      name: 'Previous session (recovered) 2026-08-29 13:58',
      updatedAt: NOW,
    });
    const summaries = await sessionRepo.listSummaries();
    expect(summaries.find((s) => s.id === 'newest')).toMatchObject({
      origin: 'recovered',
      protected: true,
      name: 'Previous session (recovered) 2026-08-29 13:58',
    });
    expect(await sessionRepo.get('older')).toMatchObject({ origin: 'alarm', name: 'Snapshot' });
  });

  it('is idempotent: a second startup with nothing new promotes nothing', async () => {
    await sessionRepo.put(makeSession({ id: 'older', createdAt: NOW - 10 * MINUTE }));
    await sessionRepo.put(makeSession({ id: 'newest', createdAt: NOW - 5 * MINUTE }));
    await promoteRecoveredSnapshot();

    await expect(promoteRecoveredSnapshot()).resolves.toBeNull();

    const summaries = await sessionRepo.listSummaries();
    expect(summaries.filter((s) => s.origin === 'recovered').map((s) => s.id)).toEqual(['newest']);
    expect((await sessionRepo.get('older'))?.origin).toBe('alarm');
  });

  it('promotes a snapshot captured after the existing recovered one (a later crash)', async () => {
    await sessionRepo.put(
      makeSession({ id: 'first-crash', origin: 'recovered', protected: true, createdAt: NOW }),
    );
    await sessionRepo.put(makeSession({ id: 'later', createdAt: NOW + 20 * MINUTE }));

    await expect(promoteRecoveredSnapshot()).resolves.toBe('later');

    expect((await sessionRepo.get('later'))?.origin).toBe('recovered');
    expect((await sessionRepo.get('first-crash'))?.origin).toBe('recovered');
  });

  it('ignores saved sessions, protected snapshots and imported/recovered origins', async () => {
    await sessionRepo.put(
      makeSession({ id: 'saved', kind: 'saved', origin: 'manual', createdAt: NOW + 4 * MINUTE }),
    );
    await sessionRepo.put(
      makeSession({ id: 'pinned', protected: true, createdAt: NOW + 3 * MINUTE }),
    );
    await sessionRepo.put(makeSession({ id: 'imported', origin: 'import', createdAt: NOW + 2 }));
    await sessionRepo.put(makeSession({ id: 'manual', origin: 'manual', createdAt: NOW + 1 }));
    await sessionRepo.put(makeSession({ id: 'startup', origin: 'startup', createdAt: NOW }));

    await expect(promoteRecoveredSnapshot()).resolves.toBe('manual');

    const origins = Object.fromEntries(
      (await sessionRepo.listSummaries()).map((s) => [s.id, s.origin]),
    );
    expect(origins).toEqual({
      saved: 'manual',
      pinned: 'alarm',
      imported: 'import',
      manual: 'recovered',
      startup: 'startup',
    });
  });

  it('never promotes across untouched restarts when history is off (ring does not fill with protected entries)', async () => {
    await sessionRepo.setSettings({ historyEnabled: false });
    await sessionRepo.put(makeSession({ id: 's1', createdAt: NOW - 3 * MINUTE }));
    await sessionRepo.put(makeSession({ id: 's2', createdAt: NOW - 2 * MINUTE }));
    await sessionRepo.put(makeSession({ id: 's3', createdAt: NOW - MINUTE }));

    const promoted = [
      await promoteRecoveredSnapshot(),
      await promoteRecoveredSnapshot(),
      await promoteRecoveredSnapshot(),
    ];

    expect(promoted).toEqual(['s3', null, null]);
    const protectedIds = (await sessionRepo.listSummaries())
      .filter((s) => s.protected === true)
      .map((s) => s.id);
    expect(protectedIds).toEqual(['s3']);
  });
});

describe('ensureHistoryAlarm', () => {
  it('creates the periodic alarm from stored settings (default 5 min)', async () => {
    await ensureHistoryAlarm();

    const alarms = await chrome.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ name: HISTORY_ALARM, periodInMinutes: 5 });
  });

  it('uses the given settings without reading storage', async () => {
    await sessionRepo.setSettings({ historyEnabled: false });
    const getSpy = vi.spyOn(chrome.storage.local, 'get');

    await ensureHistoryAlarm({
      historyEnabled: true,
      historyIntervalMinutes: 30,
      historyMaxSnapshots: 20,
      restoreLazy: 'auto',
    });

    expect(getSpy).not.toHaveBeenCalled();
    expect(getChromeFake().state.alarms.get(HISTORY_ALARM)).toEqual({ periodInMinutes: 30 });
  });

  it('replaces an existing alarm when the interval changes (no duplicate)', async () => {
    await sessionRepo.setSettings({ historyIntervalMinutes: 10 });
    await ensureHistoryAlarm();
    await sessionRepo.setSettings({ historyIntervalMinutes: 30 });

    await ensureHistoryAlarm();

    const alarms = await chrome.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ name: HISTORY_ALARM, periodInMinutes: 30 });
  });

  it('clears both alarms when history is disabled and leaves other alarms alone', async () => {
    await ensureHistoryAlarm();
    await scheduleFirstSnapshot();
    await chrome.alarms.create('unrelated', { delayInMinutes: 3 });
    await sessionRepo.setSettings({ historyEnabled: false });

    await ensureHistoryAlarm();

    expect([...getChromeFake().state.alarms.keys()]).toEqual(['unrelated']);
  });

  it('is a no-op for the alarm list when disabled and nothing was scheduled', async () => {
    await sessionRepo.setSettings({ historyEnabled: false });

    await ensureHistoryAlarm();

    await expect(chrome.alarms.getAll()).resolves.toEqual([]);
  });
});

describe('scheduleFirstSnapshot', () => {
  it('arms a one-shot history-first alarm 1 minute out when history is on', async () => {
    await scheduleFirstSnapshot();

    const alarms = await chrome.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0].name).toBe(HISTORY_FIRST_ALARM);
    expect(alarms[0].periodInMinutes).toBeUndefined();
    expect(alarms[0].scheduledTime).toBe(NOW + MINUTE);
    expect(getChromeFake().state.alarms.get(HISTORY_FIRST_ALARM)).toEqual({ delayInMinutes: 1 });
  });

  it('does nothing when history is off', async () => {
    await sessionRepo.setSettings({ historyEnabled: false });

    await scheduleFirstSnapshot();

    await expect(chrome.alarms.getAll()).resolves.toEqual([]);
  });

  it('honours explicitly passed settings', async () => {
    await scheduleFirstSnapshot({
      historyEnabled: false,
      historyIntervalMinutes: 5,
      historyMaxSnapshots: 20,
      restoreLazy: 'auto',
    });

    await expect(chrome.alarms.getAll()).resolves.toEqual([]);
  });
});
