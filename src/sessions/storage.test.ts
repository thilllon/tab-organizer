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

  it('does not write the body when the index cannot be read (no permanent orphan)', async () => {
    const fake = getChromeFake();
    fake.state.local.set(INDEX_KEY, { schemaVersion: 2, sessions: [] });
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await expect(sessionRepo.put(makeSession())).rejects.toBeInstanceOf(UnknownSchemaVersionError);

    expect(setSpy).not.toHaveBeenCalled();
    expect(fake.state.local.has(sessionKey('id-a'))).toBe(false);
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

describe('sessionRepo.update', () => {
  it('rewrites the body and re-derives the summary counts and bytes', async () => {
    await sessionRepo.put(
      makeSession({
        id: 'id-a',
        windows: [makeWindow(['https://a.com/', 'https://b.com/']), makeWindow(['https://c.com/'])],
      }),
    );
    const before = (await sessionRepo.listSummaries())[0];

    const written = await sessionRepo.update('id-a', (session) => ({
      ...session,
      windows: session.windows.slice(0, 1),
    }));

    expect(written?.windows).toHaveLength(1);
    expect((await sessionRepo.get('id-a'))?.windows).toHaveLength(1);
    const after = (await sessionRepo.listSummaries())[0];
    expect(after.windowCount).toBe(1);
    expect(after.tabCount).toBe(2);
    expect(after.bytes).toBeLessThan(before.bytes);
  });

  it('leaves updatedAt to the mutate function, keeping the list order', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    vi.setSystemTime(9_000);

    await sessionRepo.update('id-a', (session) => ({ ...session, name: 'A edited' }));

    expect((await sessionRepo.get('id-a'))?.updatedAt).toBe(5_000);
    expect((await sessionRepo.listSummaries()).map((s) => s.name)).toEqual(['B', 'A edited']);
  });

  it('deletes the session, body and index entry, when mutate returns null', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));

    expect(await sessionRepo.update('id-a', () => null)).toBeNull();

    expect(fake.state.local.has(sessionKey('id-a'))).toBe(false);
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-b']);
  });

  it('writes the body before the index', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.update('id-a', (session) => ({ ...session, name: 'Edited' }));

    expect(setSpy.mock.calls.map(([items]) => Object.keys(items)[0])).toEqual([
      sessionKey('id-a'),
      INDEX_KEY,
    ]);
  });

  it('runs under the sessions lock', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    const requestSpy = vi.spyOn(navigator.locks, 'request');

    await sessionRepo.update('id-a', (session) => session);

    expect(requestSpy.mock.calls[0][0]).toBe(LOCK_NAME);
  });

  it('rejects for an unknown id', async () => {
    await expect(sessionRepo.update('missing', (session) => session)).rejects.toThrow(
      'Session not found: missing',
    );
  });

  it('refuses a mutate that changes the session id', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));

    await expect(
      sessionRepo.update('id-a', (session) => ({ ...session, id: 'id-other' })),
    ).rejects.toThrow('update() must not change the session id');
    expect((await sessionRepo.get('id-a'))?.id).toBe('id-a');
    expect(await sessionRepo.get('id-other')).toBeUndefined();
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

  it('does not remove the body when the index cannot be read', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    fake.state.local.set(INDEX_KEY, { schemaVersion: 2, sessions: [] });
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');

    await expect(sessionRepo.remove('id-a')).rejects.toBeInstanceOf(UnknownSchemaVersionError);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(fake.state.local.has(sessionKey('id-a'))).toBe(true);
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

  it('removeAll takes the lock and removes bodies before the index', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    const requestSpy = vi.spyOn(navigator.locks, 'request');
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');

    await sessionRepo.removeAll();

    expect(requestSpy.mock.calls[0][0]).toBe(LOCK_NAME);
    // Bodies first, then the index + historyMeta (spec §4 delete order).
    expect(removeSpy.mock.calls[0][0]).toEqual([sessionKey('id-a')]);
    expect(removeSpy.mock.calls[1][0]).toEqual([INDEX_KEY, HISTORY_META_KEY]);
  });

  it('removeAll removes every session body on a runtime without getKeys()', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b', kind: 'history' }));
    await sessionRepo.setSettings({ historyEnabled: false });
    fake.state.local.set(HISTORY_META_KEY, { lastHash: 'x', lastSnapshotAt: 1 });
    // Chrome < 130: reconcile() and removeAll() share the guarded get(null) fallback.
    const area: { getKeys?: unknown } = chrome.storage.local;
    area.getKeys = undefined;

    await sessionRepo.removeAll();

    expect([...fake.state.local.keys()]).toEqual([SETTINGS_KEY]);
    expect(await sessionRepo.listSummaries()).toEqual([]);
    expect(await sessionRepo.getSettings()).toEqual({
      ...DEFAULT_SESSION_SETTINGS,
      historyEnabled: false,
    });
  });

  it('removeAll leaves a store that has never been written alone', async () => {
    const fake = getChromeFake();

    await sessionRepo.removeAll();

    expect([...fake.state.local.keys()]).toEqual([]);
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

  it('skips a body with a malformed nested window instead of aborting the whole pass', async () => {
    const fake = getChromeFake();
    // Passes migrateSession's shallow checks (`windows` is an array) but blows up in toSummary.
    fake.state.local.set(sessionKey('bad'), { ...makeSession({ id: 'bad' }), windows: [null] });
    const orphan = makeSession({ id: 'orphan', name: 'Orphan' });
    fake.state.local.set(sessionKey('orphan'), orphan);

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['orphan']);
    expect(fake.state.local.has(sessionKey('bad'))).toBe(true);
  });

  it('keeps the existing index entry of an indexed body that no longer migrates', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    fake.state.local.set(sessionKey('id-a'), { ...makeSession({ id: 'id-a' }), schemaVersion: 2 });

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 0, dropped: 0 });
    expect((await sessionRepo.listSummaries()).map((s) => s.name)).toEqual(['A']);
  });

  it('re-derives an index entry whose body was renamed (rename interrupted before the index write)', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    const body = await sessionRepo.get('id-a');
    const renamed = { ...body, name: 'A renamed' };
    fake.state.local.set(sessionKey('id-a'), renamed);

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
    const summary = (await sessionRepo.listSummaries()).find((s) => s.id === 'id-a');
    expect(summary?.name).toBe('A renamed');
    expect(summary?.bytes).toBe(JSON.stringify(renamed).length);
  });

  it('re-derives a stale entry even when the new name has the same byte length', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    fake.state.local.set(sessionKey('id-a'), { ...(await sessionRepo.get('id-a')), name: 'B' });

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
    expect((await sessionRepo.listSummaries()).map((s) => s.name)).toEqual(['B']);
  });

  it('does not write the index when nothing changed', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.rename('id-a', 'Renamed');
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

describe('sessionRepo.migrateAll', () => {
  // migrateSession() is the identity function for schema v1 (it returns the very same object
  // reference when the record already validates), so there is no way to construct a
  // differing-but-valid v1 body through the real migrateSession today. These tests therefore
  // cover the no-op path and the skip-on-unknown-version path; the rewrite-and-reindex branch is
  // exercised only by code inspection until a v2 schema exists to migrate from.

  it('does not rewrite or touch storage.local.set when every body is already current', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    const result = await sessionRepo.migrateAll();

    expect(result).toEqual({ migrated: 0 });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('treats a body missing optional protected/contentHash fields as already current', async () => {
    const fake = getChromeFake();
    const minimal = makeSession({ id: 'minimal' });
    fake.state.local.set(sessionKey('minimal'), minimal);

    const result = await sessionRepo.migrateAll();

    expect(result).toEqual({ migrated: 0 });
  });

  it('skips a body from a future schema version without throwing', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('future'), {
      ...makeSession({ id: 'future' }),
      schemaVersion: 2,
    });
    await sessionRepo.put(makeSession({ id: 'id-a' }));

    const result = await sessionRepo.migrateAll();

    expect(result).toEqual({ migrated: 0 });
    expect(fake.state.local.has(sessionKey('future'))).toBe(true);
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

describe('sessionRepo history (Phase 3)', () => {
  function makeHistory(overrides: Partial<Session> = {}): Session {
    return makeSession({ kind: 'history', origin: 'alarm', name: 'Snapshot', ...overrides });
  }

  /** Seeds sessions in the given order; `createdAt` decides age, `updatedAt` is set by put(). */
  async function seed(...sessions: Session[]): Promise<void> {
    for (const session of sessions) {
      await sessionRepo.put(session);
    }
  }

  function bodyIds(): string[] {
    return [...getChromeFake().state.local.keys()]
      .filter((key) => key.startsWith('session:'))
      .map((key) => key.slice('session:'.length))
      .sort();
  }

  describe('getHistoryMeta / setHistoryMeta', () => {
    it('is undefined until written, then round-trips', async () => {
      await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();

      await sessionRepo.setHistoryMeta({ lastHash: 'deadbeef', lastSnapshotAt: 5_000 });

      expect(getChromeFake().state.local.get(HISTORY_META_KEY)).toEqual({
        lastHash: 'deadbeef',
        lastSnapshotAt: 5_000,
      });
      await expect(sessionRepo.getHistoryMeta()).resolves.toEqual({
        lastHash: 'deadbeef',
        lastSnapshotAt: 5_000,
      });
    });

    it('treats a malformed stored value as absent', async () => {
      const fake = getChromeFake();
      fake.state.local.set(HISTORY_META_KEY, { lastHash: 42 });
      await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
      fake.state.local.set(HISTORY_META_KEY, 'junk');
      await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
    });
  });

  describe('pruneHistory', () => {
    it('removes the oldest unprotected snapshots beyond max and returns their ids oldest first', async () => {
      await seed(
        makeHistory({ id: 'h3', createdAt: 3_000 }),
        makeHistory({ id: 'h1', createdAt: 1_000 }),
        makeHistory({ id: 'h4', createdAt: 4_000 }),
        makeHistory({ id: 'h2', createdAt: 2_000 }),
      );

      await expect(sessionRepo.pruneHistory(2)).resolves.toEqual(['h1', 'h2']);

      expect(bodyIds()).toEqual(['h3', 'h4']);
      expect((await sessionRepo.listSummaries()).map((s) => s.id).sort()).toEqual(['h3', 'h4']);
    });

    it('never touches saved sessions or protected snapshots, whatever their age', async () => {
      await seed(
        makeSession({ id: 'saved', createdAt: 1 }),
        makeHistory({ id: 'pinned', protected: true, createdAt: 2 }),
        makeHistory({ id: 'recovered', origin: 'recovered', protected: true, createdAt: 3 }),
        makeHistory({ id: 'h1', createdAt: 1_000 }),
        makeHistory({ id: 'h2', createdAt: 2_000 }),
      );

      await expect(sessionRepo.pruneHistory(1)).resolves.toEqual(['h1']);

      expect(bodyIds()).toEqual(['h2', 'pinned', 'recovered', 'saved']);
    });

    it('does not write when nothing exceeds max', async () => {
      await seed(makeHistory({ id: 'h1' }), makeHistory({ id: 'h2', createdAt: 2_000 }));
      const setSpy = vi.spyOn(chrome.storage.local, 'set');
      const removeSpy = vi.spyOn(chrome.storage.local, 'remove');

      await expect(sessionRepo.pruneHistory(2)).resolves.toEqual([]);

      expect(setSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('removes bodies before rewriting the index, in one remove call', async () => {
      await seed(makeHistory({ id: 'h1', createdAt: 1_000 }), makeHistory({ id: 'h2' }));
      const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
      const setSpy = vi.spyOn(chrome.storage.local, 'set');

      await sessionRepo.pruneHistory(0);

      expect(removeSpy).toHaveBeenCalledWith([sessionKey('h1'), sessionKey('h2')]);
      expect(removeSpy.mock.invocationCallOrder[0]).toBeLessThan(
        setSpy.mock.invocationCallOrder[0],
      );
      expect(await readIndex()).toMatchObject({ sessions: [] });
    });

    it('drops historyMeta when the snapshot it fingerprints is pruned, keeps it otherwise', async () => {
      await seed(
        makeHistory({ id: 'h1', createdAt: 1_000, contentHash: 'aaaa0001' }),
        makeHistory({ id: 'h2', createdAt: 2_000, contentHash: 'aaaa0002' }),
      );
      await sessionRepo.setHistoryMeta({ lastHash: 'aaaa0002', lastSnapshotAt: 2_000 });

      await sessionRepo.pruneHistory(1);
      await expect(sessionRepo.getHistoryMeta()).resolves.toEqual({
        lastHash: 'aaaa0002',
        lastSnapshotAt: 2_000,
      });

      await sessionRepo.pruneHistory(0);
      await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
    });
  });

  describe('setProtected', () => {
    it('rewrites the body and the index summary, keeping updatedAt', async () => {
      await seed(makeHistory({ id: 'h1' }));
      vi.setSystemTime(9_000);

      await sessionRepo.setProtected('h1', true);

      expect(await sessionRepo.get('h1')).toMatchObject({ protected: true, updatedAt: 5_000 });
      expect((await sessionRepo.listSummaries())[0]).toMatchObject({ id: 'h1', protected: true });

      await sessionRepo.setProtected('h1', false);

      expect((await sessionRepo.get('h1'))?.protected).toBe(false);
      expect((await sessionRepo.listSummaries())[0].protected).toBe(false);
    });

    it('rejects for an unknown id', async () => {
      await expect(sessionRepo.setProtected('ghost', true)).rejects.toThrow(
        'Session not found: ghost',
      );
    });
  });

  describe('markRecovered', () => {
    it('sets origin recovered, protected and the name in body and index, keeping updatedAt', async () => {
      await seed(makeHistory({ id: 'h1' }));
      vi.setSystemTime(9_000);

      await sessionRepo.markRecovered('h1', 'Previous session (recovered) 2026-08-29 14:03');

      const expected = {
        origin: 'recovered',
        protected: true,
        name: 'Previous session (recovered) 2026-08-29 14:03',
        updatedAt: 5_000,
      };
      expect(await sessionRepo.get('h1')).toMatchObject(expected);
      expect((await sessionRepo.listSummaries())[0]).toMatchObject(expected);
    });

    it('rejects for an unknown id', async () => {
      await expect(sessionRepo.markRecovered('ghost', 'x')).rejects.toThrow(
        'Session not found: ghost',
      );
    });
  });

  describe('duplicateAsSaved', () => {
    it('creates a fresh saved session from a history snapshot and leaves the source untouched', async () => {
      const source = makeHistory({
        id: 'h1',
        protected: true,
        contentHash: 'cafe0001',
        createdAt: new Date(2026, 7, 29, 14, 3).getTime(),
        windows: [makeWindow(['https://a.com/']), makeWindow(['https://b.com/', 'https://c.com/'])],
      });
      await seed(source);
      vi.setSystemTime(9_000);

      const copy = await sessionRepo.duplicateAsSaved('h1');

      expect(copy.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(copy.id).not.toBe('h1');
      expect(copy).toMatchObject({
        schemaVersion: SESSION_SCHEMA_VERSION,
        kind: 'saved',
        origin: 'manual',
        name: 'Session 2026-08-29 14:03 · 2 windows · 3 tabs',
        createdAt: 9_000,
        updatedAt: 9_000,
        contentHash: 'cafe0001',
        windows: source.windows,
      });
      expect('protected' in copy).toBe(false);
      expect(await sessionRepo.get(copy.id)).toEqual(copy);
      expect(await sessionRepo.get('h1')).toMatchObject({
        kind: 'history',
        origin: 'alarm',
        protected: true,
        updatedAt: 5_000,
      });
      const summaries = await sessionRepo.listSummaries();
      expect(summaries.map((s) => s.id)).toEqual([copy.id, 'h1']);
      expect(summaries[0]).toMatchObject({ kind: 'saved', windowCount: 2, tabCount: 3 });
    });

    it('uses the given name and omits contentHash when the source has none', async () => {
      await seed(makeHistory({ id: 'h1' }));

      const copy = await sessionRepo.duplicateAsSaved('h1', 'Work tabs');

      expect(copy.name).toBe('Work tabs');
      expect('contentHash' in copy).toBe(false);
    });

    it('rejects for an unknown id', async () => {
      await expect(sessionRepo.duplicateAsSaved('ghost')).rejects.toThrow(
        'Session not found: ghost',
      );
    });
  });

  describe('removeAllHistory', () => {
    beforeEach(async () => {
      await seed(
        makeSession({ id: 'saved', contentHash: 'aaaa0000' }),
        makeHistory({ id: 'h1', createdAt: 1_000, contentHash: 'aaaa0001' }),
        makeHistory({ id: 'pinned', protected: true, createdAt: 2_000, contentHash: 'aaaa0002' }),
        makeHistory({ id: 'h3', createdAt: 3_000, contentHash: 'aaaa0003' }),
      );
    });

    it('unprotectedOnly keeps saved sessions and protected snapshots', async () => {
      await sessionRepo.setHistoryMeta({ lastHash: 'aaaa0003', lastSnapshotAt: 3_000 });

      const removed = await sessionRepo.removeAllHistory({ unprotectedOnly: true });

      expect([...removed].sort()).toEqual(['h1', 'h3']);
      expect(bodyIds()).toEqual(['pinned', 'saved']);
      expect((await sessionRepo.listSummaries()).map((s) => s.id).sort()).toEqual([
        'pinned',
        'saved',
      ]);
      await expect(sessionRepo.getHistoryMeta()).resolves.toBeUndefined();
    });

    it('otherwise removes every history snapshot, protected included, but never saved sessions', async () => {
      const removed = await sessionRepo.removeAllHistory({ unprotectedOnly: false });

      expect([...removed].sort()).toEqual(['h1', 'h3', 'pinned']);
      expect(bodyIds()).toEqual(['saved']);
      expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['saved']);
    });

    it('keeps historyMeta while the snapshot it fingerprints survives', async () => {
      await sessionRepo.setHistoryMeta({ lastHash: 'aaaa0002', lastSnapshotAt: 2_000 });

      await sessionRepo.removeAllHistory({ unprotectedOnly: true });

      await expect(sessionRepo.getHistoryMeta()).resolves.toEqual({
        lastHash: 'aaaa0002',
        lastSnapshotAt: 2_000,
      });
    });

    it('does not write when there is nothing to remove', async () => {
      await sessionRepo.removeAllHistory({ unprotectedOnly: false });
      const setSpy = vi.spyOn(chrome.storage.local, 'set');
      const removeSpy = vi.spyOn(chrome.storage.local, 'remove');

      await expect(sessionRepo.removeAllHistory({ unprotectedOnly: false })).resolves.toEqual([]);

      expect(setSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });
});
