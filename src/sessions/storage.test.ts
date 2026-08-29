import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import {
  DEFAULT_SESSION_SETTINGS,
  SESSION_SCHEMA_VERSION,
  type Session,
  type SessionIndex,
  type WindowSnapshot,
} from '@/types';
import { UnknownSchemaVersionError } from './migrate';
import {
  HISTORY_META_KEY,
  INDEX_KEY,
  LOCK_NAME,
  SETTINGS_KEY,
  sessionKey,
  sessionRepo,
  toSummary,
  withLock,
} from './storage';

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
    id: 'id-a',
    kind: 'saved',
    name: 'Session A',
    origin: 'manual',
    createdAt: 1_000,
    updatedAt: 1_000,
    windows: [makeWindow(['https://a.com/', 'https://b.com/'])],
    ...overrides,
  };
}

async function readIndex(): Promise<SessionIndex | undefined> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(INDEX_KEY);
  const value = raw[INDEX_KEY];
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return value as SessionIndex;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: 5_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionKey', () => {
  it('prefixes the id', () => {
    expect(sessionKey('abc')).toBe('session:abc');
  });
});

describe('toSummary', () => {
  it('copies metadata and computes counts', () => {
    const session = makeSession({
      windows: [makeWindow(['https://a.com/']), makeWindow(['https://b.com/', 'https://c.com/'])],
      contentHash: 'deadbeef',
      protected: true,
    });

    expect(toSummary(session, 321)).toEqual({
      id: 'id-a',
      kind: 'saved',
      name: 'Session A',
      origin: 'manual',
      createdAt: 1_000,
      updatedAt: 1_000,
      protected: true,
      contentHash: 'deadbeef',
      windowCount: 2,
      tabCount: 3,
      bytes: 321,
    });
  });

  it('omits protected and contentHash when absent', () => {
    const summary = toSummary(makeSession(), 1);

    expect('protected' in summary).toBe(false);
    expect('contentHash' in summary).toBe(false);
  });
});

describe('LOCK_NAME', () => {
  it('is the cross-context contract between the service worker and the dashboard', () => {
    expect(LOCK_NAME).toBe('tab-organizer:sessions');
  });
});

describe('withLock', () => {
  it('runs the callback and returns its value', async () => {
    await expect(withLock(async () => 42)).resolves.toBe(42);
  });

  it('propagates rejections', async () => {
    await expect(
      withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('serializes concurrent callbacks', async () => {
    const order: string[] = [];
    const first = withLock(async () => {
      order.push('first:start');
      await Promise.resolve();
      await Promise.resolve();
      order.push('first:end');
    });
    const second = withLock(async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps working after a rejected callback', async () => {
    await withLock(async () => {
      throw new Error('first fails');
    }).catch(() => undefined);

    await expect(withLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('withLock without navigator.locks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes concurrent callbacks via the module-level fallback chain', async () => {
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const { withLock: fallbackWithLock } = await import('./storage');

    const order: string[] = [];
    const first = fallbackWithLock(async () => {
      order.push('first:start');
      await Promise.resolve();
      await Promise.resolve();
      order.push('first:end');
    });
    const second = fallbackWithLock(async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps working after a rejected callback and the rejection reaches its caller', async () => {
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const { withLock: fallbackWithLock } = await import('./storage');

    await expect(
      fallbackWithLock(async () => {
        throw new Error('first fails');
      }),
    ).rejects.toThrow('first fails');

    await expect(fallbackWithLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('sessionRepo.put / get / listSummaries', () => {
  it('writes the body under session:<id> and a summary in the index', async () => {
    const fake = getChromeFake();

    await sessionRepo.put(makeSession());

    const body = fake.state.local.get(sessionKey('id-a'));
    expect(body).toMatchObject({ id: 'id-a', name: 'Session A', updatedAt: 5_000 });
    const index = await readIndex();
    expect(index?.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(index?.sessions).toHaveLength(1);
    expect(index?.sessions[0]).toMatchObject({
      id: 'id-a',
      windowCount: 1,
      tabCount: 2,
      updatedAt: 5_000,
    });
    expect(index?.sessions[0].bytes).toBe(JSON.stringify(body).length);
  });

  it('reports byte-accurate size (UTF-8), not UTF-16 code units, for non-ASCII content', async () => {
    const session = makeSession({
      windows: [makeWindow(['https://a.com/'])],
    });
    session.windows[0].tabs[0].title = '日本語';

    await sessionRepo.put(session);

    const body = getChromeFake().state.local.get(sessionKey('id-a'));
    const utf16Length = JSON.stringify(body).length;
    const index = await readIndex();

    expect(index?.sessions[0].bytes).toBeGreaterThan(utf16Length);
  });

  it('writes the body before the index', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.put(makeSession());

    const writtenKeys = setSpy.mock.calls.map((call) => Object.keys(call[0]));
    expect(writtenKeys).toEqual([[sessionKey('id-a')], [INDEX_KEY]]);
  });

  it('returns the stored session from get and undefined for unknown ids', async () => {
    await sessionRepo.put(makeSession());

    const stored = await sessionRepo.get('id-a');
    expect(stored?.windows[0].tabs.map((t) => t.url)).toEqual(['https://a.com/', 'https://b.com/']);
    await expect(sessionRepo.get('nope')).resolves.toBeUndefined();
  });

  it('lists summaries newest-first by updatedAt', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    vi.setSystemTime(7_000);
    await sessionRepo.put(makeSession({ id: 'id-c', name: 'C' }));

    const names = (await sessionRepo.listSummaries()).map((s) => s.name);

    expect(names).toEqual(['C', 'B', 'A']);
  });

  it('re-saving an existing id replaces its summary and moves it to the top', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    vi.setSystemTime(7_000);
    await sessionRepo.put(
      makeSession({ id: 'id-a', name: 'A2', windows: [makeWindow(['https://x.com/'])] }),
    );

    const summaries = await sessionRepo.listSummaries();

    expect(summaries.map((s) => s.name)).toEqual(['A2', 'B']);
    expect(summaries[0].tabCount).toBe(1);
  });

  it('returns an empty list when nothing is stored', async () => {
    await expect(sessionRepo.listSummaries()).resolves.toEqual([]);
  });

  it('propagates storage errors from put', async () => {
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));

    await expect(sessionRepo.put(makeSession())).rejects.toThrow('QUOTA_BYTES exceeded');
    expect(await readIndex()).toBeUndefined();
  });

  it('does not lose an index entry when two puts run concurrently', async () => {
    await Promise.all([
      sessionRepo.put(makeSession({ id: 'id-a' })),
      sessionRepo.put(makeSession({ id: 'id-b' })),
    ]);

    const ids = (await sessionRepo.listSummaries()).map((s) => s.id).sort();
    expect(ids).toEqual(['id-a', 'id-b']);
  });
});

describe('sessionRepo migration error propagation', () => {
  it('get rejects with UnknownSchemaVersionError for a body from a future schema', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('future'), {
      ...makeSession({ id: 'future' }),
      schemaVersion: 2,
    });

    await expect(sessionRepo.get('future')).rejects.toBeInstanceOf(UnknownSchemaVersionError);
  });

  it('listSummaries rejects with UnknownSchemaVersionError for an index from a future schema', async () => {
    const fake = getChromeFake();
    fake.state.local.set(INDEX_KEY, { schemaVersion: 2, sessions: [] });

    await expect(sessionRepo.listSummaries()).rejects.toBeInstanceOf(UnknownSchemaVersionError);
  });
});

describe('sessionRepo.rename', () => {
  it('updates the name in the body and the index without changing order', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));

    await sessionRepo.rename('id-a', 'Renamed');

    const body = await sessionRepo.get('id-a');
    expect(body?.name).toBe('Renamed');
    expect(body?.updatedAt).toBe(5_000);
    const summaries = await sessionRepo.listSummaries();
    expect(summaries.map((s) => s.name)).toEqual(['B', 'Renamed']);
  });

  it('rejects for an unknown id', async () => {
    await expect(sessionRepo.rename('missing', 'x')).rejects.toThrow('Session not found: missing');
  });
});

describe('sessionRepo.remove / removeAll', () => {
  it('removes the body then the index entry', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.remove('id-a');

    expect(fake.state.local.has(sessionKey('id-a'))).toBe(false);
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-b']);
    expect(removeSpy.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]);
  });

  it('removing an unknown id leaves the index untouched', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));

    await sessionRepo.remove('ghost');

    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-a']);
  });

  it('removeAll deletes every session body, the index and history meta but keeps settings', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    await sessionRepo.setSettings({ restoreLazy: 'never' });
    fake.state.local.set(HISTORY_META_KEY, { lastHash: 'x', lastSnapshotAt: 1 });
    fake.state.local.set('installedVersion', '7.0.0');

    await sessionRepo.removeAll();

    expect([...fake.state.local.keys()].sort()).toEqual(['installedVersion', SETTINGS_KEY]);
  });
});

describe('sessionRepo.reconcile', () => {
  it('re-indexes orphan bodies (interrupted write: body saved, index not)', async () => {
    const fake = getChromeFake();
    const orphan = makeSession({ id: 'orphan', name: 'Orphan', updatedAt: 9_000 });
    fake.state.local.set(sessionKey('orphan'), orphan);
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
    const summaries = await sessionRepo.listSummaries();
    expect(summaries.map((s) => s.id)).toEqual(['orphan', 'id-a']);
    expect(summaries[0].bytes).toBe(JSON.stringify(orphan).length);
  });

  it('drops dangling index entries whose body is missing', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    fake.state.local.delete(sessionKey('id-b'));

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 0, dropped: 1 });
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-a']);
  });

  it('leaves bodies that fail migration alone', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('future'), {
      ...makeSession({ id: 'future' }),
      schemaVersion: 2,
    });
    fake.state.local.set(sessionKey('junk'), 'not an object');

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 0, dropped: 0 });
    expect(fake.state.local.has(sessionKey('future'))).toBe(true);
    expect(fake.state.local.has(sessionKey('junk'))).toBe(true);
    await expect(sessionRepo.listSummaries()).resolves.toEqual([]);
  });

  it('does not write the index when nothing changed', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.reconcile();

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('falls back to get(null) when getKeys is unavailable', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('orphan'), makeSession({ id: 'orphan' }));
    const area: { getKeys?: unknown } = chrome.storage.local;
    area.getKeys = undefined;

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
  });
});

describe('sessionRepo settings', () => {
  it('returns defaults when nothing is stored', async () => {
    await expect(sessionRepo.getSettings()).resolves.toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('merges a patch and persists it under sessionSettings', async () => {
    const fake = getChromeFake();

    await sessionRepo.setSettings({ historyEnabled: false, restoreLazy: 'always' });

    expect(fake.state.local.get(SETTINGS_KEY)).toEqual({
      ...DEFAULT_SESSION_SETTINGS,
      historyEnabled: false,
      restoreLazy: 'always',
    });
    await expect(sessionRepo.getSettings()).resolves.toMatchObject({ historyEnabled: false });
  });

  it('replaces invalid stored values with defaults field by field', async () => {
    const fake = getChromeFake();
    fake.state.local.set(SETTINGS_KEY, {
      historyEnabled: 'yes',
      historyIntervalMinutes: 7,
      historyMaxSnapshots: -3,
      restoreLazy: 'sometimes',
    });

    await expect(sessionRepo.getSettings()).resolves.toEqual(DEFAULT_SESSION_SETTINGS);
  });
});
