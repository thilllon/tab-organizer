import {
  DEFAULT_SESSION_SETTINGS,
  SESSION_SCHEMA_VERSION,
  type Session,
  type SessionId,
  type SessionIndex,
  type SessionSettings,
  type SessionSummary,
} from '@/types';
import { migrateIndex, migrateSession } from './migrate';

export const INDEX_KEY = 'sessionIndex';
export const SETTINGS_KEY = 'sessionSettings';
export const HISTORY_META_KEY = 'historyMeta';
export const LOCK_NAME = 'tab-organizer:sessions';

const SESSION_KEY_PREFIX = 'session:';

export function sessionKey(id: SessionId): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function idFromKey(key: string): string | undefined {
  return key.startsWith(SESSION_KEY_PREFIX) ? key.slice(SESSION_KEY_PREFIX.length) : undefined;
}

// Fallback serialization for runtimes without Web Locks (page-local only).
let fallbackChain: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) {
    const run = fallbackChain.then(fn, fn);
    fallbackChain = run.catch(() => undefined);
    return run;
  }
  return new Promise<T>((resolve, reject) => {
    locks
      .request(LOCK_NAME, async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      })
      .catch(reject);
  });
}

export function toSummary(session: Session, bytes: number): SessionSummary {
  const summary: SessionSummary = {
    id: session.id,
    kind: session.kind,
    name: session.name,
    origin: session.origin,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    windowCount: session.windows.length,
    tabCount: session.windows.reduce((count, win) => count + win.tabs.length, 0),
    bytes,
  };
  if (session.protected !== undefined) {
    summary.protected = session.protected;
  }
  if (session.contentHash !== undefined) {
    summary.contentHash = session.contentHash;
  }
  return summary;
}

function sortNewestFirst(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Byte length (not UTF-16 code units) — matches Chrome's quota accounting. */
function byteLength(json: string): number {
  return new TextEncoder().encode(json).length;
}

async function readIndex(): Promise<SessionIndex> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(INDEX_KEY);
  return migrateIndex(raw[INDEX_KEY]);
}

async function writeIndex(sessions: SessionSummary[]): Promise<void> {
  const index: SessionIndex = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessions: sortNewestFirst(sessions),
  };
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

async function readRawBody(id: SessionId): Promise<unknown> {
  const key = sessionKey(id);
  const raw: Record<string, unknown> = await chrome.storage.local.get(key);
  return raw[key];
}

async function readBody(id: SessionId): Promise<Session | undefined> {
  const record = await readRawBody(id);
  if (record === undefined || record === null) {
    return undefined;
  }
  return migrateSession(record);
}

/** Body first, then index (spec §4). Must be called inside withLock. */
async function writeBodyAndIndex(body: Session): Promise<void> {
  const bytes = byteLength(JSON.stringify(body));
  await chrome.storage.local.set({ [sessionKey(body.id)]: body });
  const index = await readIndex();
  const others = index.sessions.filter((summary) => summary.id !== body.id);
  await writeIndex([...others, toSummary(body, bytes)]);
}

async function listStorageKeys(): Promise<string[]> {
  const area = chrome.storage.local;
  if (typeof area.getKeys === 'function') {
    return area.getKeys();
  }
  const all: Record<string, unknown> = await area.get(null);
  return Object.keys(all);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSettings(value: unknown): SessionSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
  const interval = value.historyIntervalMinutes;
  const max = value.historyMaxSnapshots;
  const lazy = value.restoreLazy;
  return {
    historyEnabled:
      typeof value.historyEnabled === 'boolean'
        ? value.historyEnabled
        : DEFAULT_SESSION_SETTINGS.historyEnabled,
    historyIntervalMinutes:
      interval === 5 || interval === 10 || interval === 30
        ? interval
        : DEFAULT_SESSION_SETTINGS.historyIntervalMinutes,
    historyMaxSnapshots:
      typeof max === 'number' && Number.isInteger(max) && max > 0
        ? max
        : DEFAULT_SESSION_SETTINGS.historyMaxSnapshots,
    restoreLazy:
      lazy === 'auto' || lazy === 'always' || lazy === 'never'
        ? lazy
        : DEFAULT_SESSION_SETTINGS.restoreLazy,
  };
}

async function readSettings(): Promise<SessionSettings> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(raw[SETTINGS_KEY]);
}

export const sessionRepo = {
  async listSummaries(): Promise<SessionSummary[]> {
    const index = await readIndex();
    return sortNewestFirst(index.sessions);
  },

  get(id: SessionId): Promise<Session | undefined> {
    return readBody(id);
  },

  put(session: Session): Promise<void> {
    return withLock(async () => {
      const body: Session = { ...session, updatedAt: Date.now() };
      await writeBodyAndIndex(body);
    });
  },

  rename(id: SessionId, name: string): Promise<void> {
    return withLock(async () => {
      const existing = await readBody(id);
      if (existing === undefined) {
        throw new Error(`Session not found: ${id}`);
      }
      await writeBodyAndIndex({ ...existing, name });
    });
  },

  remove(id: SessionId): Promise<void> {
    return withLock(async () => {
      await chrome.storage.local.remove(sessionKey(id));
      const index = await readIndex();
      await writeIndex(index.sessions.filter((summary) => summary.id !== id));
    });
  },

  removeAll(): Promise<void> {
    return withLock(async () => {
      const keys = await listStorageKeys();
      const bodyKeys = keys.filter((key) => idFromKey(key) !== undefined);
      if (bodyKeys.length > 0) {
        await chrome.storage.local.remove(bodyKeys);
      }
      await chrome.storage.local.remove([INDEX_KEY, HISTORY_META_KEY]);
    });
  },

  reconcile(): Promise<{ reindexed: number; dropped: number }> {
    return withLock(async () => {
      const keys = await listStorageKeys();
      const bodyIds = new Set<string>();
      for (const key of keys) {
        const id = idFromKey(key);
        if (id !== undefined) {
          bodyIds.add(id);
        }
      }

      const index = await readIndex();
      const kept = index.sessions.filter((summary) => bodyIds.has(summary.id));
      const dropped = index.sessions.length - kept.length;
      const indexedIds = new Set(kept.map((summary) => summary.id));

      let reindexed = 0;
      for (const id of bodyIds) {
        if (indexedIds.has(id)) {
          continue;
        }
        const record = await readRawBody(id);
        let session: Session;
        try {
          session = migrateSession(record);
        } catch {
          continue;
        }
        kept.push(toSummary(session, byteLength(JSON.stringify(record))));
        reindexed += 1;
      }

      if (reindexed > 0 || dropped > 0) {
        await writeIndex(kept);
      }
      return { reindexed, dropped };
    });
  },

  getSettings(): Promise<SessionSettings> {
    return readSettings();
  },

  setSettings(patch: Partial<SessionSettings>): Promise<void> {
    return withLock(async () => {
      const current = await readSettings();
      const next: SessionSettings = normalizeSettings({ ...current, ...patch });
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    });
  },
};
