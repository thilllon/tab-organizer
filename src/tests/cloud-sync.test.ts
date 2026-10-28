import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLOUD_ACCOUNT_KEY, CLOUD_SYNC_KEY } from '@/lib/cloud-auth';
import { overrideCloudSyncConfig } from '@/lib/cloud-config';
import { encryptRecord, toBase64 } from '@/lib/cloud-crypto';
import {
  handleCloudStorageChange,
  PUSH_MAX_BYTES,
  PUSH_MAX_RECORDS,
  readLocalSettings,
  syncNow,
  type SyncResult,
} from '@/lib/cloud-sync';
import { CLOUD_SYNC_META_KEY, type CloudSyncMeta, readSyncMeta } from '@/lib/cloud-sync-state';
import { t } from '@/lib/i18n';
import { removeTabFromSession } from '@/lib/session-edit';
import { sessionRepo } from '@/lib/session-repo';
import { UI_LANGUAGE_KEY } from '@/lib/ui-language';
import { SESSION_SCHEMA_VERSION, type Session, type WindowSnapshot } from '@/types';

import { createChromeFake } from './chrome-fake';
import { fakeSyncServer, type FakeSyncServer } from './cloud-fetch';

/*
 * Two (or three) simulated devices, each with its own chrome fake, talking to one fake server
 * with the real records semantics. A device's code runs with `globalThis.chrome` pointed at its
 * fake (`on()`), one device at a time, and its `storage.onChanged` events reach the same
 * `handleCloudStorageChange()` the worker calls, so settings and dirty-set tracking run for real.
 */

type ChromeFake = ReturnType<typeof createChromeFake>;

const FAR_FUTURE = 4_000_000_000_000;
const EMAIL = 'a@b.c';

interface Device {
  name: string;
  fake: ChromeFake;
  pending: Promise<unknown>[];
}

let server: FakeSyncServer;
let rawKey: string;

function newRawKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

function makeDevice(name: string, key: string = rawKey): Device {
  const fake = createChromeFake();
  fake.state.local.set(CLOUD_ACCOUNT_KEY, { token: 'tok', expiresAt: FAR_FUTURE, email: EMAIL });
  fake.state.local.set(CLOUD_SYNC_KEY, key);
  const device: Device = { name, fake, pending: [] };
  fake.chrome.storage.onChanged.addListener((changes, areaName) => {
    device.pending.push(handleCloudStorageChange(changes, areaName));
  });
  return device;
}

/** Runs `fn` as `device`, then lets its change listeners finish. */
async function on<T>(device: Device, fn: () => Promise<T>): Promise<T> {
  const previous = globalThis.chrome;
  Object.assign(globalThis, { chrome: device.fake.chrome });
  try {
    const result = await fn();
    while (device.pending.length > 0) {
      await Promise.all(device.pending.splice(0));
    }
    return result;
  } finally {
    Object.assign(globalThis, { chrome: previous });
  }
}

function sync(device: Device, options: { pageSize?: number } = {}): Promise<SyncResult> {
  return on(device, () => syncNow({ fetch: server.fetch, ...options }));
}

function at(ms: number): void {
  vi.setSystemTime(ms);
}

function makeWindow(urls: string[]): WindowSnapshot {
  return {
    state: 'normal',
    focused: false,
    groups: [],
    tabs: urls.map((url, index) => ({ url, title: url, pinned: false, active: index === 0 })),
  };
}

function makeSession(id: string, name: string, overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    kind: 'saved',
    name,
    origin: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    windows: [makeWindow([`https://${id}.example/`, `https://${id}.example/two`])],
    ...overrides,
  };
}

function get(device: Device, id: string): Promise<Session | undefined> {
  return on(device, () => sessionRepo.get(id));
}

async function names(device: Device): Promise<string[]> {
  const summaries = await on(device, () => sessionRepo.listSummaries());
  return summaries.map((summary) => summary.name).sort();
}

function meta(device: Device): Promise<CloudSyncMeta | undefined> {
  return on(device, () => readSyncMeta());
}

function postCount(): number {
  return server.posts.length;
}

let a: Device;
let b: Device;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(1_000_000);
  overrideCloudSyncConfig(() => ({ apiBase: 'https://sync.test', googleClientId: 'cid' }));
  server = fakeSyncServer();
  rawKey = newRawKey();
  a = makeDevice('A');
  b = makeDevice('B');
});

afterEach(() => {
  overrideCloudSyncConfig();
  vi.useRealTimers();
});

describe('two devices converging through the server', () => {
  it('a session created on one device arrives on the other, exactly as saved', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Work')));
    expect(await sync(a)).toEqual({ outcome: 'synced', pulled: 0, pushed: 2 });
    // The session; the settings are the same defaults on both and stay as they are.
    expect(await sync(b)).toMatchObject({ outcome: 'synced', pulled: 1 });
    expect(await get(b, 's1')).toEqual(await get(a, 's1'));
    // Nothing is left to send on either side, and a second round sends nothing.
    const posts = postCount();
    await sync(a);
    await sync(b);
    expect(postCount()).toBe(posts);
    expect((await meta(a))?.dirtySessions).toEqual({});
    expect((await meta(b))?.dirtySessions).toEqual({});
  });

  it.each([
    ['A', 'B'],
    ['B', 'A'],
  ])('an edit and a delete on %s reach %s', async (fromName, toName) => {
    const from = fromName === 'A' ? a : b;
    const to = toName === 'A' ? a : b;
    await on(a, () => sessionRepo.put(makeSession('s1', 'Work')));
    await on(a, () => sessionRepo.put(makeSession('s2', 'Home')));
    await sync(a);
    await sync(b);

    at(2_000_000);
    await on(from, () => sessionRepo.rename('s1', 'Work, renamed'));
    await on(from, () =>
      sessionRepo.update('s2', (session) => removeTabFromSession(session, 0, 1)),
    );
    await sync(from);
    await sync(to);
    expect((await get(to, 's1'))?.name).toBe('Work, renamed');
    expect((await get(to, 's2'))?.windows[0].tabs).toHaveLength(1);
    expect(await get(to, 's1')).toEqual(await get(from, 's1'));

    at(3_000_000);
    await on(from, () => sessionRepo.remove('s1'));
    await sync(from);
    await sync(to);
    expect(await get(to, 's1')).toBeUndefined();
    expect(await names(to)).toEqual(['Home']);
    expect(server.record('session', 's1')).toMatchObject({ deleted: true, ciphertext: '' });
  });

  it('concurrent edits: the newer one wins on both devices, whichever syncs first', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Original')));
    await sync(a);
    await sync(b);

    // B edits first in time but syncs first; A's later edit still wins everywhere.
    at(2_000_000);
    await on(b, () => sessionRepo.rename('s1', 'Older edit (B)'));
    at(3_000_000);
    await on(a, () => sessionRepo.rename('s1', 'Newer edit (A)'));
    await sync(b);
    await sync(a);
    await sync(b);
    expect((await get(a, 's1'))?.name).toBe('Newer edit (A)');
    expect((await get(b, 's1'))?.name).toBe('Newer edit (A)');

    // And the other way round: the newer edit syncs first, the older one is answered stale.
    at(4_000_000);
    await on(a, () => sessionRepo.rename('s1', 'Older edit (A)'));
    at(5_000_000);
    await on(b, () => sessionRepo.rename('s1', 'Newer edit (B)'));
    await sync(b);
    await sync(a);
    await sync(b);
    expect((await get(a, 's1'))?.name).toBe('Newer edit (B)');
    expect((await get(b, 's1'))?.name).toBe('Newer edit (B)');
    expect(await get(a, 's1')).toEqual(await get(b, 's1'));
  });

  it('an edit against a delete: the later of the two wins', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
    await on(a, () => sessionRepo.put(makeSession('s2', 'Two')));
    await sync(a);
    await sync(b);

    // s1: deleted on A after B edited it, so it is deleted everywhere.
    at(2_000_000);
    await on(b, () => sessionRepo.rename('s1', 'One, edited'));
    at(3_000_000);
    await on(a, () => sessionRepo.remove('s1'));
    // s2: deleted on A before B edited it, so B's edit brings it back everywhere.
    at(4_000_000);
    await on(a, () => sessionRepo.remove('s2'));
    at(5_000_000);
    await on(b, () => sessionRepo.rename('s2', 'Two, edited'));

    await sync(b);
    await sync(a);
    await sync(b);
    for (const device of [a, b]) {
      expect(await get(device, 's1')).toBeUndefined();
      expect((await get(device, 's2'))?.name).toBe('Two, edited');
    }
  });

  it('offline, then online again: nothing is lost and the error clears', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Made offline')));
    server.offline = true;
    expect(await sync(a)).toMatchObject({ outcome: 'failed', pushed: 0 });
    const failed = await meta(a);
    expect(failed?.lastError).toBe(t('errorCloudUnreachable'));
    expect(Object.keys(failed?.dirtySessions ?? {})).toEqual(['s1']);
    expect(failed?.settingsDirty).toBe(true);

    // More work piles up while offline.
    at(2_000_000);
    await on(a, () => sessionRepo.rename('s1', 'Renamed offline'));
    await on(a, () => sessionRepo.put(makeSession('s2', 'Second')));
    expect(await sync(a)).toMatchObject({ outcome: 'failed' });

    server.offline = false;
    expect(await sync(a)).toMatchObject({ outcome: 'synced', pushed: 3 });
    expect((await meta(a))?.lastError).toBeUndefined();
    expect((await meta(a))?.lastSyncAt).toBe(2_000_000);
    await sync(b);
    expect(await names(b)).toEqual(['Renamed offline', 'Second']);
  });

  it('a stale push is answered with the current record, which is applied and settles the entry', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Original')));
    await sync(a);
    await sync(b);
    at(2_000_000);
    await on(b, () => sessionRepo.rename('s1', 'B, older'));

    // Between B's pull and its push another device writes a newer copy.
    const newer = { ...makeSession('s1', 'Elsewhere, newer'), updatedAt: 3_000_000 };
    const payload = await encryptRecord(rawKey, newer);
    const realFetch = server.fetch;
    let injected = false;
    const fetchWithRace: typeof fetch = async (input, init) => {
      if (!injected && init?.method === 'POST') {
        injected = true;
        server.inject({
          kind: 'session',
          id: 's1',
          updatedAt: 3_000_000,
          deleted: false,
          ...payload,
        });
      }
      return realFetch(input, init);
    };
    const result = await on(b, () => syncNow({ fetch: fetchWithRace }));
    expect(result.outcome).toBe('synced');
    const answer = server.requests.at(-1);
    expect(answer?.method).toBe('POST');
    expect((await get(b, 's1'))?.name).toBe('Elsewhere, newer');
    expect((await get(b, 's1'))?.updatedAt).toBe(3_000_000);
    expect((await meta(b))?.dirtySessions).toEqual({});
    // Settled: the next sync sends nothing, and A catches up.
    const posts = postCount();
    await sync(b);
    expect(postCount()).toBe(posts);
    await sync(a);
    expect((await get(a, 's1'))?.name).toBe('Elsewhere, newer');
  });

  it('snapshots are never uploaded', async () => {
    await on(a, () =>
      sessionRepo.put(makeSession('h1', 'Snapshot', { kind: 'history', origin: 'alarm' })),
    );
    await on(a, () => sessionRepo.put(makeSession('s1', 'Saved')));
    await sync(a);
    at(2_000_000);
    await on(a, () =>
      sessionRepo.put(makeSession('h2', 'Later snapshot', { kind: 'history', origin: 'alarm' })),
    );
    await on(a, () => sessionRepo.remove('h1'));
    await sync(a);
    expect([...server.records.keys()].sort()).toEqual(['session:s1', 'settings:settings']);
    const sent = server.requests
      .filter((request) => request.method === 'POST')
      .flatMap((request) => (request.body as { records: { id: string }[] }).records);
    expect(sent.map((record) => record.id)).not.toContain('h1');
    expect(sent.map((record) => record.id)).not.toContain('h2');
    await sync(b);
    expect(await names(b)).toEqual(['Saved']);
  });

  it('Keep turns a snapshot into a saved session that syncs from then on', async () => {
    await on(a, () =>
      sessionRepo.put(makeSession('h1', 'Snapshot', { kind: 'history', origin: 'alarm' })),
    );
    await sync(a);
    at(2_000_000);
    // What snapshot-detail.tsx does for Keep: duplicate as saved, then remove the snapshot.
    const kept = await on(a, async () => {
      const saved = await sessionRepo.duplicateAsSaved('h1');
      await sessionRepo.remove('h1');
      return saved;
    });
    await sync(a);
    expect(server.record('session', kept.id)).toMatchObject({ deleted: false });
    expect(server.record('session', 'h1')).toBeUndefined();
    await sync(b);
    expect((await get(b, kept.id))?.kind).toBe('saved');
    expect((await get(b, kept.id))?.windows).toEqual(kept.windows);
  });

  it('settings make a round trip without an echo', async () => {
    // A changes its settings once both devices sync.
    await sync(a);
    await sync(b);
    at(2_000_000);
    await on(a, async () => {
      await chrome.storage.sync.set({ sortBy: 'title', duplicateTabHandling: 'group' });
      await chrome.storage.sync.set({ [UI_LANGUAGE_KEY]: 'ko' });
      await sessionRepo.setSettings({ historyMaxSnapshots: 7, restoreLazy: 'never' });
    });
    expect((await meta(a))?.settingsDirty).toBe(true);
    await sync(a);
    expect((await meta(a))?.settingsDirty).toBe(false);
    const settingsSeq = server.record('settings', 'settings')?.seq;

    await sync(b);
    const onB = await on(b, () => readLocalSettings());
    expect(onB.sort).toMatchObject({ sortBy: 'title', duplicateTabHandling: 'group' });
    expect(onB.uiLanguage).toBe('ko');
    expect(onB.sessionSettings).toMatchObject({ historyMaxSnapshots: 7, restoreLazy: 'never' });
    expect(onB).toEqual(await on(a, () => readLocalSettings()));
    // Applying them did not make B's settings dirty: nothing goes back, on either side.
    expect((await meta(b))?.settingsDirty).toBe(false);
    expect((await meta(b))?.pendingSettings).toBeUndefined();
    const posts = postCount();
    await sync(b);
    await sync(a);
    await sync(b);
    expect(postCount()).toBe(posts);
    expect(server.record('settings', 'settings')?.seq).toBe(settingsSeq);
  });

  it('a joining device takes the settings already on the account', async () => {
    await on(a, () => chrome.storage.sync.set({ sortBy: 'custom' }));
    await sync(a);
    // B has its defaults and has never synced: A's settings win, not B's.
    await sync(b);
    expect((await on(b, () => readLocalSettings())).sort.sortBy).toBe('custom');
    await sync(a);
    expect((await on(a, () => readLocalSettings())).sort.sortBy).toBe('custom');
  });

  it('a record that does not decrypt is skipped, and nothing on the device is lost', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
    await on(a, () => sessionRepo.put(makeSession('s2', 'Two')));
    await sync(a);
    await sync(b);
    at(2_000_000);
    await on(a, () => sessionRepo.rename('s1', 'One, edited'));
    await on(a, () => sessionRepo.rename('s2', 'Two, edited'));
    await sync(a);
    server.tamper('session', 's1');

    expect(await sync(b)).toMatchObject({ outcome: 'synced' });
    // s1 keeps B's copy, s2 is updated, and the run says what happened.
    expect((await get(b, 's1'))?.name).toBe('One');
    expect((await get(b, 's2'))?.name).toBe('Two, edited');
    expect((await meta(b))?.lastError).toBe(t('errorCloudDecrypt'));
    // A device that never had it does not get an empty copy either.
    const c = makeDevice('C');
    expect(await sync(c)).toMatchObject({ outcome: 'synced' });
    expect(await names(c)).toEqual(['Two, edited']);
  });

  it('a device with another key cannot read anything and changes nothing', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Secret')));
    await sync(a);
    const other = makeDevice('Other', newRawKey());
    await on(other, () => sessionRepo.put(makeSession('mine', 'Mine')));
    expect(await sync(other)).toMatchObject({ outcome: 'synced' });
    expect(await names(other)).toEqual(['Mine']);
    expect((await meta(other))?.lastError).toBe(t('errorCloudDecrypt'));
  });

  it('pushes in batches of at most 100 records', async () => {
    await on(a, async () => {
      for (let index = 0; index < 250; index++) {
        await sessionRepo.put(makeSession(`s${index}`, `Session ${index}`));
      }
    });
    expect(await sync(a)).toMatchObject({ outcome: 'synced', pushed: 251 });
    expect(server.posts.map((post) => post.count)).toEqual([100, 100, 51]);
    expect(server.posts.every((post) => post.count <= PUSH_MAX_RECORDS)).toBe(true);
    // Reading them back pages through the feed.
    expect(await sync(b, { pageSize: 40 })).toMatchObject({ outcome: 'synced', pulled: 250 });
    expect(server.requests.filter((request) => request.method === 'GET').length).toBeGreaterThan(6);
    expect((await on(b, () => sessionRepo.listSummaries())).length).toBe(250);
    expect((await meta(b))?.cursor).toBe(251);
  });

  it('pushes in batches of at most 3.5 MiB', async () => {
    // Long random urls (each also its title): each session is about 800 KB once encrypted.
    const bigWindow = (seed: string) =>
      makeWindow(
        Array.from(
          { length: 25 },
          (_, index) =>
            `https://example.com/${seed}/${index}/${toBase64(crypto.getRandomValues(new Uint8Array(9000)))}`,
        ),
      );
    await on(a, async () => {
      for (let index = 0; index < 8; index++) {
        await sessionRepo.put(
          makeSession(`big${index}`, `Big ${index}`, { windows: [bigWindow(`${index}`)] }),
        );
      }
    });
    expect(await sync(a)).toMatchObject({ outcome: 'synced', pushed: 9 });
    expect(server.posts.length).toBeGreaterThan(1);
    expect(server.posts.every((post) => post.bytes <= PUSH_MAX_BYTES)).toBe(true);
    expect(server.posts.reduce((sum, post) => sum + post.count, 0)).toBe(9);
    await sync(b);
    expect((await on(b, () => sessionRepo.listSummaries())).length).toBe(8);
  });

  it('a session too large for the server stays on the device and is named in the error', async () => {
    const huge = makeWindow(
      Array.from(
        { length: 100 },
        (_, index) =>
          `https://example.com/${index}/${toBase64(crypto.getRandomValues(new Uint8Array(9000)))}`,
      ),
    );
    await on(a, () => sessionRepo.put(makeSession('huge', 'Huge', { windows: [huge] })));
    await on(a, () => sessionRepo.put(makeSession('small', 'Small')));
    expect(await sync(a)).toMatchObject({ outcome: 'synced' });
    expect(server.record('session', 'huge')).toBeUndefined();
    expect(server.record('session', 'small')).toBeDefined();
    expect((await meta(a))?.lastError).toBe(t('errorCloudRecordTooLarge'));
    expect(Object.keys((await meta(a))?.dirtySessions ?? {})).toEqual(['huge']);
  });
});

describe('syncNow', () => {
  it('is not ready while signed out or without the key, and asks the server nothing', async () => {
    a.fake.state.local.delete(CLOUD_SYNC_KEY);
    expect(await sync(a)).toEqual({ outcome: 'notReady', pulled: 0, pushed: 0 });
    b.fake.state.local.delete(CLOUD_ACCOUNT_KEY);
    expect(await sync(b)).toEqual({ outcome: 'notReady', pulled: 0, pushed: 0 });
    expect(server.requests).toEqual([]);
  });

  it('a 401 signs this device out, keeping every session and the bookkeeping', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'Kept')));
    await sync(a);
    server.token = 'another';
    expect(await sync(a)).toMatchObject({ outcome: 'failed' });
    expect(a.fake.state.local.has(CLOUD_ACCOUNT_KEY)).toBe(false);
    expect(a.fake.state.local.has(CLOUD_SYNC_KEY)).toBe(false);
    expect(a.fake.state.local.has(CLOUD_SYNC_META_KEY)).toBe(true);
    expect(await names(a)).toEqual(['Kept']);
  });

  it('starts over for another account: everything saved is offered again', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
    await sync(a);
    expect((await meta(a))?.dirtySessions).toEqual({});
    a.fake.state.local.set(CLOUD_ACCOUNT_KEY, {
      token: 'tok',
      expiresAt: FAR_FUTURE,
      email: 'someone@else.example',
    });
    server = fakeSyncServer();
    await sync(a);
    expect(server.record('session', 's1')).toBeDefined();
    expect((await meta(a))?.owner).toBe('someone@else.example');
  });

  it('stores the cursor after every page, so an interrupted pull resumes there', async () => {
    await on(a, async () => {
      for (let index = 0; index < 5; index++) {
        await sessionRepo.put(makeSession(`s${index}`, `S${index}`));
      }
    });
    await sync(a);
    const realFetch = server.fetch;
    let gets = 0;
    const failingThirdPage: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        gets += 1;
        if (gets === 3) {
          throw new TypeError('Failed to fetch');
        }
      }
      return realFetch(input, init);
    };
    expect(await on(b, () => syncNow({ fetch: failingThirdPage, pageSize: 2 }))).toMatchObject({
      outcome: 'failed',
    });
    expect((await meta(b))?.cursor).toBe(4);
    expect(await sync(b, { pageSize: 2 })).toMatchObject({ outcome: 'synced' });
    expect((await on(b, () => sessionRepo.listSummaries())).length).toBe(5);
  });

  it('two runs at once on one device never overlap', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
    let active = 0;
    let most = 0;
    const realFetch = server.fetch;
    const counting: typeof fetch = async (input, init) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await realFetch(input, init);
      } finally {
        active -= 1;
      }
    };
    await on(a, () => Promise.all([syncNow({ fetch: counting }), syncNow({ fetch: counting })]));
    expect(most).toBe(1);
    expect(server.record('session', 's1')).toBeDefined();
  });
});

describe('interrupted runs and gaps in readiness', () => {
  /** B changes its language and its snapshot interval, and sends them. */
  async function remoteSettingsFromB(): Promise<void> {
    await sync(a);
    await sync(b);
    at(2_000_000);
    await on(b, async () => {
      await chrome.storage.sync.set({ [UI_LANGUAGE_KEY]: 'ko' });
      await sessionRepo.setSettings({ historyIntervalMinutes: 30 });
    });
    await sync(b);
    at(3_000_000);
  }

  async function expectBothHaveBsSettings(): Promise<void> {
    await sync(a);
    await sync(b);
    for (const device of [a, b]) {
      const settings = await on(device, () => readLocalSettings());
      expect(settings.uiLanguage).toBe('ko');
      expect(settings.sessionSettings.historyIntervalMinutes).toBe(30);
    }
  }

  it.each([
    ['right after', true],
    ['just before', false],
  ])(
    'a settings apply cut short %s the language write is finished, never pushed back half done',
    async (_when, written) => {
      await remoteSettingsFromB();
      // A's page reloads as soon as the new language lands (or the worker stops just before
      // writing it): the run ends there.
      const sync = a.fake.chrome.storage.sync;
      const realSet = sync.set.bind(sync);
      vi.spyOn(sync, 'set').mockImplementationOnce((async (items: Record<string, unknown>) => {
        if (written) {
          await realSet(items);
        }
        throw new Error('page reloaded');
      }) as never);
      expect(await on(a, () => syncNow({ fetch: server.fetch }))).toMatchObject({
        outcome: 'failed',
      });
      await expectBothHaveBsSettings();
    },
  );

  it('changes made while the token had expired are sent after signing in again', async () => {
    await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
    await on(a, () => sessionRepo.put(makeSession('s2', 'Two')));
    await sync(a);
    await sync(b);

    at(2_000_000);
    a.fake.state.local.set(CLOUD_ACCOUNT_KEY, { token: 'tok', expiresAt: 1_500_000, email: EMAIL });
    await on(a, () => sessionRepo.rename('s1', 'Renamed while expired'));
    await on(a, () => sessionRepo.remove('s2'));
    expect(await sync(a)).toMatchObject({ outcome: 'notReady' });

    a.fake.state.local.set(CLOUD_ACCOUNT_KEY, {
      token: 'tok',
      expiresAt: FAR_FUTURE,
      email: EMAIL,
    });
    await sync(a);
    await sync(b);
    expect(await names(b)).toEqual(['Renamed while expired']);
    expect(await names(a)).toEqual(['Renamed while expired']);
  });

  it.each([['a 401'], ['signing out']])(
    'a deletion not yet sent survives %s and is sent after signing in again',
    async (how) => {
      await on(a, () => sessionRepo.put(makeSession('s1', 'One')));
      await on(a, () => sessionRepo.put(makeSession('s2', 'Two')));
      await sync(a);
      await sync(b);

      at(2_000_000);
      await on(a, () => sessionRepo.remove('s1'));
      if (how === 'a 401') {
        server.token = 'another';
        expect(await sync(a)).toMatchObject({ outcome: 'failed' });
        server.token = 'tok';
      } else {
        await on(a, () => chrome.storage.local.remove([CLOUD_ACCOUNT_KEY, CLOUD_SYNC_KEY]));
      }
      expect(a.fake.state.local.has(CLOUD_ACCOUNT_KEY)).toBe(false);

      await on(a, () =>
        chrome.storage.local.set({
          [CLOUD_ACCOUNT_KEY]: { token: 'tok', expiresAt: FAR_FUTURE, email: EMAIL },
          [CLOUD_SYNC_KEY]: rawKey,
        }),
      );
      await sync(a);
      await sync(b);
      expect(await names(a)).toEqual(['Two']);
      expect(await names(b)).toEqual(['Two']);
    },
  );
});
