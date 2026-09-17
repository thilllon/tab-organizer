import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_SETTINGS } from '@/types';
import {
  HISTORY_INTERVALS,
  HISTORY_MAX_MAX,
  HISTORY_MAX_MIN,
  intervalLabel,
  isRestoreLazy,
  lazyLabel,
  parseHistoryInterval,
  parseSnapshotLimit,
  RESTORE_LAZY_MODES,
} from './session-settings';

describe('option lists', () => {
  it('offer the intervals and lazy modes the settings type allows', () => {
    expect(HISTORY_INTERVALS).toEqual([5, 10, 30]);
    expect(RESTORE_LAZY_MODES).toEqual(['auto', 'always', 'never']);
  });

  it('include the defaults, so the selects always have a matching option', () => {
    expect(HISTORY_INTERVALS).toContain(DEFAULT_SESSION_SETTINGS.historyIntervalMinutes);
    expect(RESTORE_LAZY_MODES).toContain(DEFAULT_SESSION_SETTINGS.restoreLazy);
  });

  it('bracket the default snapshot limit', () => {
    expect(DEFAULT_SESSION_SETTINGS.historyMaxSnapshots).toBeGreaterThanOrEqual(HISTORY_MAX_MIN);
    expect(DEFAULT_SESSION_SETTINGS.historyMaxSnapshots).toBeLessThanOrEqual(HISTORY_MAX_MAX);
  });
});

describe('parseHistoryInterval', () => {
  it('reads the three supported values back as numbers', () => {
    expect(parseHistoryInterval('5')).toBe(5);
    expect(parseHistoryInterval('10')).toBe(10);
    expect(parseHistoryInterval('30')).toBe(30);
  });

  it('returns undefined for anything else', () => {
    expect(parseHistoryInterval('7')).toBeUndefined();
    expect(parseHistoryInterval('')).toBeUndefined();
    expect(parseHistoryInterval('5 minutes')).toBeUndefined();
  });
});

describe('isRestoreLazy', () => {
  it('accepts the three modes', () => {
    expect(isRestoreLazy('auto')).toBe(true);
    expect(isRestoreLazy('always')).toBe(true);
    expect(isRestoreLazy('never')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRestoreLazy('sometimes')).toBe(false);
    expect(isRestoreLazy('')).toBe(false);
  });
});

describe('parseSnapshotLimit', () => {
  it('reads a plain integer', () => {
    expect(parseSnapshotLimit('20')).toBe(20);
    expect(parseSnapshotLimit(' 7 ')).toBe(7);
  });

  it('clamps to the supported range', () => {
    expect(parseSnapshotLimit('0')).toBe(HISTORY_MAX_MIN);
    expect(parseSnapshotLimit('-4')).toBe(HISTORY_MAX_MIN);
    expect(parseSnapshotLimit('9999')).toBe(HISTORY_MAX_MAX);
  });

  it('truncates a fractional entry to whole snapshots', () => {
    expect(parseSnapshotLimit('20.7')).toBe(20);
  });

  it('returns undefined for an empty or non-numeric entry', () => {
    expect(parseSnapshotLimit('')).toBeUndefined();
    expect(parseSnapshotLimit('   ')).toBeUndefined();
    expect(parseSnapshotLimit('many')).toBeUndefined();
  });
});

describe('labels', () => {
  it('names each interval', () => {
    expect(intervalLabel(5)).toBe('Every 5 minutes');
    expect(intervalLabel(30)).toBe('Every 30 minutes');
  });

  it('names each lazy-restore mode', () => {
    expect(lazyLabel('auto')).toBe('Automatic (over 50 tabs)');
    expect(lazyLabel('always')).toBe('Always');
    expect(lazyLabel('never')).toBe('Never');
  });
});
