import { formatNumber, t, tp } from '@/lib/i18n';
import { LAZY_AUTO_THRESHOLD } from '@/lib/session-restore';
import {
  HISTORY_INTERVAL_MAX_MINUTES,
  HISTORY_INTERVAL_MIN_MINUTES,
  type SessionSettings,
} from '@/types';

/**
 * Pure rules behind the session-settings controls (the Settings dialog's "Sessions"
 * section). The components stay thin: everything that can be wrong about a typed-in value is
 * decided here and unit-tested (AGENTS.md "Testing" - vitest runs without a DOM).
 */

type RestoreLazy = SessionSettings['restoreLazy'];

/**
 * The preset intervals the select offers. Any other whole number of minutes in
 * [HISTORY_INTERVAL_MIN_MINUTES, HISTORY_INTERVAL_MAX_MINUTES] is a "Custom" value the user types.
 */
export const HISTORY_INTERVALS: readonly number[] = [5, 10, 30];

/** The select's value for "type your own"; never a number, so it cannot collide with a preset. */
export const CUSTOM_INTERVAL = 'custom';

export { HISTORY_INTERVAL_MAX_MINUTES, HISTORY_INTERVAL_MIN_MINUTES };
export const RESTORE_LAZY_MODES: readonly RestoreLazy[] = ['auto', 'always', 'never'];

/** Ring-buffer bounds for `historyMaxSnapshots`, mirrored on the number input's min/max. */
export const HISTORY_MAX_MIN = 1;
export const HISTORY_MAX_MAX = 200;

/** Reads a preset option of the interval select back into minutes; `undefined` for "Custom". */
export function parseHistoryInterval(value: string): number | undefined {
  return HISTORY_INTERVALS.find((minutes) => String(minutes) === value);
}

/**
 * Which option the interval select shows: the preset that matches the stored value, or "Custom"
 * when the stored value is not a preset or the user has just chosen to type one.
 */
export function intervalSelectValue(minutes: number, customOpen: boolean): string {
  if (!customOpen && HISTORY_INTERVALS.includes(minutes)) {
    return String(minutes);
  }
  return CUSTOM_INTERVAL;
}

/**
 * Reads the custom interval input. Like `parseSnapshotLimit`: `undefined` for an empty or
 * non-numeric entry (the stored value stays), otherwise whole minutes clamped into
 * [HISTORY_INTERVAL_MIN_MINUTES, HISTORY_INTERVAL_MAX_MINUTES], the same range `normalizeSettings`
 * enforces on what is stored.
 */
export function parseIntervalMinutes(raw: string): number | undefined {
  const text = raw.trim();
  // `Number`, not `parseInt`: a number input also accepts "1e3" and "2.5", which parseInt would
  // cut at the first non-digit (1e3 becoming 1 minute). Rounded like normalizeHistoryInterval.
  const parsed = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(
    HISTORY_INTERVAL_MAX_MINUTES,
    Math.max(HISTORY_INTERVAL_MIN_MINUTES, Math.round(parsed)),
  );
}

export function isRestoreLazy(value: string): value is RestoreLazy {
  return value === 'auto' || value === 'always' || value === 'never';
}

/**
 * Reads the "Keep last N snapshots" input. Returns `undefined` for anything that is not a number
 * - including the empty string mid-edit, which must leave the stored value alone rather than
 * writing a 0 - and clamps everything else into [1, 200]. `Number.parseInt` also swallows the
 * decimal part of "20.7", which is what the ring buffer wants (whole snapshots only).
 */
export function parseSnapshotLimit(raw: string): number | undefined {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(HISTORY_MAX_MAX, Math.max(HISTORY_MAX_MIN, parsed));
}

/** "Every 5 minutes" - the interval select's option text. */
export function intervalLabel(minutes: number): string {
  return tp('settingsIntervalEvery', minutes);
}

/** The lazy-restore select's option text; 'auto' names the threshold `planRestore` applies. */
export function lazyLabel(mode: RestoreLazy): string {
  switch (mode) {
    case 'auto':
      return t('settingsLazyAuto', formatNumber(LAZY_AUTO_THRESHOLD));
    case 'always':
      return t('settingsLazyAlways');
    default:
      return t('settingsLazyNever');
  }
}

/** The grey hint under the interval select: the range a typed-in interval may take. */
export function intervalRangeHint(): string {
  return t(
    'settingsSnapshotIntervalHint',
    formatNumber(HISTORY_INTERVAL_MIN_MINUTES),
    formatNumber(HISTORY_INTERVAL_MAX_MINUTES),
  );
}
