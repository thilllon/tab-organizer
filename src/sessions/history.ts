import type { Session, SessionId, SessionOrigin, SessionSettings, SessionSummary } from '@/types';
import { captureSession } from './capture';
import { contentHash } from './hash';
import { sessionRepo } from './storage';

/**
 * Automatic history snapshots & crash recovery (spec §5, §12 Phase 3). Pure orchestration over
 * `captureSession()` and `sessionRepo`, plus thin `chrome.alarms` wrappers. Nothing here registers
 * a listener: the service worker (`src/background/sessions.ts`) wires `alarms.onAlarm`,
 * `runtime.onStartup` and `storage.onChanged` to these functions.
 */

/** Periodic alarm; `periodInMinutes` = `SessionSettings.historyIntervalMinutes`. */
export const HISTORY_ALARM = 'history-snapshot';
/** One-shot alarm armed at startup so the first snapshot runs after Chrome restored its tabs. */
export const HISTORY_FIRST_ALARM = 'history-first';
const FIRST_SNAPSHOT_DELAY_MINUTES = 1;

/** Which event produced the snapshot; `'recovered'` and `'import'` are never captured directly. */
export type HistorySnapshotOrigin = Extract<SessionOrigin, 'alarm' | 'manual' | 'startup'>;

export interface HistorySnapshotOptions {
  origin: HistorySnapshotOrigin;
}

export type HistorySnapshotOutcome = 'saved' | 'skipped-empty' | 'skipped-unchanged' | 'disabled';

export interface HistorySnapshotResult {
  outcome: HistorySnapshotOutcome;
  /** Set only when `outcome === 'saved'`. */
  sessionId?: SessionId;
  /** Ids removed by the ring-buffer prune that followed a save (oldest first). */
  pruned: SessionId[];
}

const PROMOTABLE_ORIGINS: ReadonlySet<SessionOrigin> = new Set<SessionOrigin>([
  'alarm',
  'manual',
  'startup',
]);

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Local-time "2026-08-29 14:03" — the same stamp `defaultSessionName()` (naming.ts) uses. */
function formatStamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** "Snapshot 2026-08-29 14:03 · 3 windows · 87 tabs" (history counterpart of `defaultSessionName`). */
export function defaultHistoryName(date: Date, windowCount: number, tabCount: number): string {
  return `Snapshot ${formatStamp(date)} · ${plural(windowCount, 'window')} · ${plural(tabCount, 'tab')}`;
}

/** "Previous session (recovered) 2026-08-29 14:03" — `date` is the snapshot's capture time. */
export function recoveredSnapshotName(date: Date): string {
  return `Previous session (recovered) ${formatStamp(date)}`;
}

function tabCountOf(session: Session): number {
  return session.windows.reduce((count, win) => count + win.tabs.length, 0);
}

/**
 * Capture every normal window and store it as a `kind: 'history'` session, unless history is
 * off, nothing is capturable, or the layout is identical to the last snapshot (`contentHash`
 * vs `historyMeta.lastHash` — titles are excluded from the hash, see hash.ts). After a save the
 * ring buffer is trimmed to `historyMaxSnapshots` unprotected snapshots (saved sessions and
 * protected snapshots are never touched) and `historyMeta` is advanced.
 *
 * The steps run as separate repo calls (each under the Web Lock), not one transaction: two
 * overlapping invocations in the same worker instance could store the same layout twice, which
 * the next prune absorbs. Errors (quota, capture) propagate to the caller.
 */
export async function takeHistorySnapshot(
  opts: HistorySnapshotOptions,
): Promise<HistorySnapshotResult> {
  const settings = await sessionRepo.getSettings();
  if (!settings.historyEnabled) {
    return { outcome: 'disabled', pruned: [] };
  }

  const captured = await captureSession('all');
  if (captured.windows.length === 0) {
    return { outcome: 'skipped-empty', pruned: [] };
  }

  const hash = captured.contentHash ?? contentHash(captured.windows);
  const meta = await sessionRepo.getHistoryMeta();
  if (meta !== undefined && meta.lastHash === hash) {
    return { outcome: 'skipped-unchanged', pruned: [] };
  }

  const session: Session = {
    ...captured,
    kind: 'history',
    origin: opts.origin,
    name: defaultHistoryName(
      new Date(captured.createdAt),
      captured.windows.length,
      tabCountOf(captured),
    ),
    contentHash: hash,
  };
  await sessionRepo.put(session);
  const pruned = await sessionRepo.pruneHistory(settings.historyMaxSnapshots);
  await sessionRepo.setHistoryMeta({ lastHash: hash, lastSnapshotAt: Date.now() });
  return { outcome: 'saved', sessionId: session.id, pruned };
}

function isPromotable(summary: SessionSummary): boolean {
  return (
    summary.kind === 'history' &&
    summary.protected !== true &&
    PROMOTABLE_ORIGINS.has(summary.origin)
  );
}

/**
 * Crash recovery, run from `runtime.onStartup`: the newest unprotected alarm/manual/startup
 * snapshot is the last known layout of the previous browser session, so it becomes
 * `origin: 'recovered'`, `protected: true` (exempt from pruning) and is renamed
 * "Previous session (recovered) <capture time>". Returns its id, or `null` when nothing qualifies.
 *
 * Idempotent: a recovered snapshot is never re-promoted, and only snapshots captured *after* the
 * newest existing recovered one are candidates — otherwise every restart with no new snapshots
 * in between (history off, or an unchanged layout) would promote one more stale snapshot and
 * slowly turn the whole ring into protected entries.
 */
export async function promoteRecoveredSnapshot(): Promise<SessionId | null> {
  const summaries = await sessionRepo.listSummaries();
  const newestRecoveredAt = summaries
    .filter((summary) => summary.kind === 'history' && summary.origin === 'recovered')
    .reduce((latest, summary) => Math.max(latest, summary.createdAt), Number.NEGATIVE_INFINITY);

  const candidate = summaries
    .filter((summary) => isPromotable(summary) && summary.createdAt > newestRecoveredAt)
    .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)[0];
  if (candidate === undefined) {
    return null;
  }

  await sessionRepo.markRecovered(
    candidate.id,
    recoveredSnapshotName(new Date(candidate.createdAt)),
  );
  return candidate.id;
}

/**
 * Re-asserts the periodic alarm from the settings (reads them when not given). Chrome drops all
 * alarms on extension update/reload, so this runs from `onInstalled`/`onStartup` and whenever
 * `sessionSettings` changes. `alarms.create` with an existing name replaces it (no churn); with
 * history off both alarms are cleared so the worker goes back to waking on user actions only.
 */
export async function ensureHistoryAlarm(settings?: SessionSettings): Promise<void> {
  const resolved = settings ?? (await sessionRepo.getSettings());
  if (resolved.historyEnabled) {
    await chrome.alarms.create(HISTORY_ALARM, {
      periodInMinutes: resolved.historyIntervalMinutes,
    });
    return;
  }
  await chrome.alarms.clear(HISTORY_ALARM);
  await chrome.alarms.clear(HISTORY_FIRST_ALARM);
}

/**
 * One-shot `history-first` alarm, 1 minute after startup, so the first post-launch snapshot
 * happens once Chrome has finished restoring its tabs (a capture during restore would record
 * half-loaded windows). No-op while history is off.
 */
export async function scheduleFirstSnapshot(settings?: SessionSettings): Promise<void> {
  const resolved = settings ?? (await sessionRepo.getSettings());
  if (!resolved.historyEnabled) {
    return;
  }
  await chrome.alarms.create(HISTORY_FIRST_ALARM, {
    delayInMinutes: FIRST_SNAPSHOT_DELAY_MINUTES,
  });
}
