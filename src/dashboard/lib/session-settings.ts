import type { SessionSettings } from '@/types';

/**
 * Pure rules behind the session-settings controls (dashboard settings row + Options "Sessions"
 * card). The components stay thin: everything that can be wrong about a typed-in value is
 * decided here and unit-tested (AGENTS.md "Testing" — vitest runs without a DOM).
 */

export type HistoryInterval = SessionSettings['historyIntervalMinutes'];
export type RestoreLazy = SessionSettings['restoreLazy'];

/** The intervals the alarm supports (spec §3); anything else falls back in `normalizeSettings`. */
export const HISTORY_INTERVALS: readonly HistoryInterval[] = [5, 10, 30];
export const RESTORE_LAZY_MODES: readonly RestoreLazy[] = ['auto', 'always', 'never'];

/** Ring-buffer bounds for `historyMaxSnapshots`, mirrored on the number input's min/max. */
export const HISTORY_MAX_MIN = 1;
export const HISTORY_MAX_MAX = 200;

/** Reads the interval select's string value back into the union `SessionSettings` stores. */
export function parseHistoryInterval(value: string): HistoryInterval | undefined {
  switch (value) {
    case '5':
      return 5;
    case '10':
      return 10;
    case '30':
      return 30;
    default:
      return undefined;
  }
}

export function isRestoreLazy(value: string): value is RestoreLazy {
  return value === 'auto' || value === 'always' || value === 'never';
}

/**
 * Reads the "Keep last N snapshots" input. Returns `undefined` for anything that is not a number
 * — including the empty string mid-edit, which must leave the stored value alone rather than
 * writing a 0 — and clamps everything else into [1, 200]. `Number.parseInt` also swallows the
 * decimal part of "20.7", which is what the ring buffer wants (whole snapshots only).
 */
export function parseSnapshotLimit(raw: string): number | undefined {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(HISTORY_MAX_MAX, Math.max(HISTORY_MAX_MIN, parsed));
}

/** "Every 5 minutes" — the interval select's option text. */
export function intervalLabel(minutes: HistoryInterval): string {
  return `Every ${minutes} minutes`;
}

/** The lazy-restore select's option text; 'auto' names the threshold `planRestore` applies. */
export function lazyLabel(mode: RestoreLazy): string {
  switch (mode) {
    case 'auto':
      return 'Automatic (over 50 tabs)';
    case 'always':
      return 'Always';
    default:
      return 'Never';
  }
}
