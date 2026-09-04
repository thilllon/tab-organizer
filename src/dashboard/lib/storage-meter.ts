import { formatBytes, pluralize } from '@/dashboard/lib/format';
import type { SessionSummary } from '@/types';

/**
 * The numbers behind the dashboard's `StorageMeter` (spec §4 "Quota errors" / §12 Phase 6).
 *
 * `chrome.storage.local.getBytesInUse()` gives one total for everything the extension stores;
 * the split between saved sessions and automatic snapshots comes from the index's per-session
 * `bytes` field, which `sessionRepo` derives from the body it actually wrote. The two are
 * measured differently (Chrome counts the key too, `bytes` is the body's JSON length), so
 * `other` absorbs the difference along with the settings and `historyMeta` — it is never
 * negative and is never presented as "unknown data".
 *
 * Everything here is pure so it can be unit-tested without a DOM (AGENTS.md "Testing").
 */

export interface StorageBreakdown {
  /** Everything the extension has in `chrome.storage.local`, per `getBytesInUse()`. */
  total: number;
  /** Sum of `bytes` over `kind: 'saved'` index entries. */
  saved: number;
  /** Sum of `bytes` over `kind: 'history'` index entries. */
  snapshots: number;
  /** Whatever the two above do not account for (settings, metadata, key overhead); >= 0. */
  other: number;
  savedCount: number;
  snapshotCount: number;
}

/** Percentages for the thin bar; they sum to 100 (or to 0 when nothing is stored). */
export interface StorageSegments {
  saved: number;
  snapshots: number;
  other: number;
}

/**
 * Snapshots are only called out once they are both the bulk of the store and big enough to be
 * worth acting on — a 40 KB store where snapshots happen to be 90% of it is not a problem.
 */
export const SNAPSHOT_HINT_MIN_BYTES = 1024 * 1024;

export function summarizeStorage(
  summaries: Pick<SessionSummary, 'kind' | 'bytes'>[],
  totalBytes: number,
): StorageBreakdown {
  let saved = 0;
  let snapshots = 0;
  let savedCount = 0;
  let snapshotCount = 0;
  for (const summary of summaries) {
    const bytes = Number.isFinite(summary.bytes) ? Math.max(0, summary.bytes) : 0;
    if (summary.kind === 'history') {
      snapshots += bytes;
      snapshotCount += 1;
    } else {
      saved += bytes;
      savedCount += 1;
    }
  }
  const total = Math.max(0, Number.isFinite(totalBytes) ? totalBytes : 0);
  return {
    total: Math.max(total, saved + snapshots),
    saved,
    snapshots,
    other: Math.max(0, total - saved - snapshots),
    savedCount,
    snapshotCount,
  };
}

/** "4.6 MB stored on this device" — the meter's headline. */
export function storageTotalLine(breakdown: StorageBreakdown): string {
  return `${formatBytes(breakdown.total)} stored on this device`;
}

/** "1.2 MB in 3 saved sessions · 3.4 MB in 12 snapshots" — the split under the headline. */
export function storageDetailLine(breakdown: StorageBreakdown): string {
  return [
    `${formatBytes(breakdown.saved)} in ${pluralize(breakdown.savedCount, 'saved session')}`,
    `${formatBytes(breakdown.snapshots)} in ${pluralize(breakdown.snapshotCount, 'snapshot')}`,
  ].join(' · ');
}

/**
 * The pruning hint (spec §12 Phase 6): shown only when the automatic snapshots are both over
 * `SNAPSHOT_HINT_MIN_BYTES` and larger than everything else put together, so it appears when
 * lowering "Keep last N snapshots" would actually free something.
 */
export function snapshotHint(breakdown: StorageBreakdown): string | undefined {
  if (breakdown.snapshots < SNAPSHOT_HINT_MIN_BYTES) {
    return undefined;
  }
  if (breakdown.snapshots <= breakdown.saved + breakdown.other) {
    return undefined;
  }
  return `Automatic snapshots use ${formatBytes(breakdown.snapshots)} — lower "Keep last N snapshots" or delete unprotected snapshots.`;
}

/**
 * Bar widths in percent. Rounded to one decimal and with the remainder given to `other`, so the
 * three segments always add up to exactly 100 and the bar has no sliver of background showing.
 */
export function storageSegments(breakdown: StorageBreakdown): StorageSegments {
  if (breakdown.total <= 0) {
    return { saved: 0, snapshots: 0, other: 0 };
  }
  const percent = (bytes: number): number => Math.round((bytes / breakdown.total) * 1000) / 10;
  const saved = percent(breakdown.saved);
  const snapshots = percent(breakdown.snapshots);
  const other = Math.max(0, Math.round((100 - saved - snapshots) * 10) / 10);
  return { saved, snapshots, other };
}

/** `id` of the meter's container; the quota notices scroll to it. */
export const STORAGE_METER_ID = 'storage-meter';

/**
 * Scrolls the storage meter into view and parks focus on it, for the "Show storage use" button
 * on a quota notice. `delayMs` lets a caller wait out a dialog's close animation — Radix locks
 * body scrolling while a dialog is open, so scrolling immediately would do nothing.
 *
 * DOM-only, hence untested: the rules that decide *what* the meter says are the pure functions
 * above.
 */
export function revealStorageMeter(delayMs = 0): void {
  if (typeof document === 'undefined') {
    return;
  }
  const run = (): void => {
    const element = document.getElementById(STORAGE_METER_ID);
    if (element === null) {
      return;
    }
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.focus({ preventScroll: true });
  };
  if (delayMs <= 0) {
    run();
    return;
  }
  setTimeout(run, delayMs);
}
