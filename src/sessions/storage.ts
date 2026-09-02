import {
  DEFAULT_SESSION_SETTINGS,
  SESSION_SCHEMA_VERSION,
  type Session,
  type SessionId,
  type SessionIndex,
  type SessionSettings,
  type SessionSummary,
} from '@/types';
import { migrateIndex, migrateSession, UnknownSchemaVersionError } from './migrate';
import { defaultSessionName } from './naming';

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

  /**
   * Eager migration pass over every stored session body (e.g. on extension update). For schema
   * v1 `migrateSession` is the identity, so nothing is rewritten today; this is forward-looking
   * for a future schema bump. A body that fails migration (unknown schema version, or malformed)
   * is left untouched and not counted — reconcile()/read-time migration handle it from there.
   */
  migrateAll(): Promise<{ migrated: number }> {
    return withLock(async () => {
      const keys = await listStorageKeys();
      const ids = keys
        .map((key) => idFromKey(key))
        .filter((id): id is SessionId => id !== undefined);

      const index = await readIndex();
      const summaries = new Map(index.sessions.map((summary) => [summary.id, summary]));

      let migrated = 0;
      let indexChanged = false;
      for (const id of ids) {
        const raw = await readRawBody(id);
        if (raw === undefined) {
          continue;
        }
        let session: Session;
        try {
          session = migrateSession(raw);
        } catch (err) {
          if (err instanceof UnknownSchemaVersionError || err instanceof TypeError) {
            continue;
          }
          throw err;
        }
        const migratedJson = JSON.stringify(session);
        if (migratedJson === JSON.stringify(raw)) {
          continue;
        }
        await chrome.storage.local.set({ [sessionKey(id)]: session });
        summaries.set(id, toSummary(session, byteLength(migratedJson)));
        migrated += 1;
        indexChanged = true;
      }

      if (indexChanged) {
        await writeIndex([...summaries.values()]);
      }
      return { migrated };
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

  // ---- Phase 3: history snapshots (spec §4 `historyMeta`, §12 Phase 3) -------------------

  /** `historyMeta` — dedupe baseline for `takeHistorySnapshot()`; `undefined` until the first snapshot. */
  getHistoryMeta(): Promise<HistoryMeta | undefined> {
    return readHistoryMeta();
  },

  setHistoryMeta(meta: HistoryMeta): Promise<void> {
    return withLock(async () => {
      await chrome.storage.local.set({ [HISTORY_META_KEY]: meta });
    });
  },

  /**
   * Ring buffer: keeps the newest `max` unprotected `kind: 'history'` sessions and removes the
   * rest, oldest first. Never touches `kind: 'saved'` or protected snapshots. Returns the removed
   * ids (oldest first); the index is rewritten once, under a single lock.
   */
  pruneHistory(max: number): Promise<SessionId[]> {
    return withLock(async () => {
      const index = await readIndex();
      const unprotected = index.sessions.filter(isUnprotectedHistory).sort(oldestFirst);
      const excess = unprotected.length - Math.max(0, Math.floor(max));
      if (excess <= 0) {
        return [];
      }
      const ids = unprotected.slice(0, excess).map((summary) => summary.id);
      await removeBodiesAndIndex(index, ids);
      return ids;
    });
  },

  /** Protected snapshots are exempt from pruning (recovered / user-pinned). `updatedAt` is kept. */
  setProtected(id: SessionId, value: boolean): Promise<void> {
    return updateBody(id, (existing) => ({ ...existing, protected: value }));
  },

  /**
   * Turns a history snapshot into the crash-recovery entry: `origin: 'recovered'`, protected,
   * renamed. `updatedAt` is kept so the snapshot stays in its chronological place in the index.
   */
  markRecovered(id: SessionId, name: string): Promise<void> {
    return updateBody(id, (existing) => ({
      ...existing,
      origin: 'recovered',
      protected: true,
      name,
    }));
  },

  /**
   * "Save as session": copies a (history) session into a brand-new `kind: 'saved'` session with
   * a fresh id, `origin: 'manual'`, `createdAt`/`updatedAt` = now and no `protected` flag. The
   * source is left untouched. Default name: the saved-session form stamped with the source's
   * capture time ("Session 2026-08-29 14:03 · 3 windows · 87 tabs").
   */
  duplicateAsSaved(id: SessionId, name?: string): Promise<Session> {
    return withLock(async () => {
      const source = await readBody(id);
      if (source === undefined) {
        throw new Error(`Session not found: ${id}`);
      }
      const now = Date.now();
      const tabCount = source.windows.reduce((count, win) => count + win.tabs.length, 0);
      const copy: Session = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        id: crypto.randomUUID(),
        kind: 'saved',
        name:
          name ?? defaultSessionName(new Date(source.createdAt), source.windows.length, tabCount),
        origin: 'manual',
        createdAt: now,
        updatedAt: now,
        windows: source.windows,
      };
      if (source.contentHash !== undefined) {
        copy.contentHash = source.contentHash;
      }
      await writeBodyAndIndex(copy);
      return copy;
    });
  },

  /**
   * Deletes every `kind: 'history'` session (only the unprotected ones when `unprotectedOnly`).
   * Saved sessions are never touched. Returns the removed ids.
   */
  removeAllHistory(options: { unprotectedOnly: boolean }): Promise<SessionId[]> {
    return withLock(async () => {
      const index = await readIndex();
      const ids = index.sessions
        .filter((summary) =>
          options.unprotectedOnly ? isUnprotectedHistory(summary) : isHistory(summary),
        )
        .map((summary) => summary.id);
      await removeBodiesAndIndex(index, ids);
      return ids;
    });
  },
};

// ---------------------------------------------------------------------------
// Phase 3 helpers (history snapshots)
// ---------------------------------------------------------------------------

/** `chrome.storage.local` key `historyMeta` (spec §4). */
export interface HistoryMeta {
  /** `contentHash` of the newest history snapshot; identical captures are skipped. */
  lastHash: string;
  /** Epoch ms of that snapshot's write. */
  lastSnapshotAt: number;
}

function normalizeHistoryMeta(value: unknown): HistoryMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.lastHash !== 'string' || typeof value.lastSnapshotAt !== 'number') {
    return undefined;
  }
  return { lastHash: value.lastHash, lastSnapshotAt: value.lastSnapshotAt };
}

async function readHistoryMeta(): Promise<HistoryMeta | undefined> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(HISTORY_META_KEY);
  return normalizeHistoryMeta(raw[HISTORY_META_KEY]);
}

function isHistory(summary: SessionSummary): boolean {
  return summary.kind === 'history';
}

function isUnprotectedHistory(summary: SessionSummary): boolean {
  return isHistory(summary) && summary.protected !== true;
}

/** Capture time decides age (rename/protect keep `updatedAt`, but `createdAt` never moves). */
function oldestFirst(a: SessionSummary, b: SessionSummary): number {
  return a.createdAt - b.createdAt || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id);
}

/** Read-modify-write of one body and its summary under the lock. Not for use inside withLock. */
function updateBody(id: SessionId, update: (existing: Session) => Session): Promise<void> {
  return withLock(async () => {
    const existing = await readBody(id);
    if (existing === undefined) {
      throw new Error(`Session not found: ${id}`);
    }
    await writeBodyAndIndex(update(existing));
  });
}

/**
 * Delete order: bodies first, then the index (spec §4), then drop `historyMeta` when the
 * snapshot it fingerprints is gone — otherwise the next `takeHistorySnapshot()` would skip a
 * state that no stored snapshot holds any more. Must be called inside withLock.
 */
async function removeBodiesAndIndex(index: SessionIndex, ids: SessionId[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await chrome.storage.local.remove(ids.map((id) => sessionKey(id)));
  const removed = new Set(ids);
  const remaining = index.sessions.filter((summary) => !removed.has(summary.id));
  await writeIndex(remaining);

  const meta = await readHistoryMeta();
  if (meta === undefined) {
    return;
  }
  const stillHeld = remaining.some(
    (summary) => isHistory(summary) && summary.contentHash === meta.lastHash,
  );
  if (!stillHeld) {
    await chrome.storage.local.remove(HISTORY_META_KEY);
  }
}
