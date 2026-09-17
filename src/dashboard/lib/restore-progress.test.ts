import { describe, expect, it } from 'vitest';
import {
  formatRate,
  formatWindowLine,
  LAZY_RESTORE_HINT,
  lazyRestoreSummaryHint,
} from '@/dashboard/lib/restore-progress';

describe('formatWindowLine', () => {
  it('counts windows from one', () => {
    expect(formatWindowLine(0, 3)).toBe('Window 1 of 3');
    expect(formatWindowLine(1, 3)).toBe('Window 2 of 3');
    expect(formatWindowLine(2, 3)).toBe('Window 3 of 3');
  });

  it('says nothing for a single-window restore', () => {
    expect(formatWindowLine(0, 1)).toBeUndefined();
    expect(formatWindowLine(0, 0)).toBeUndefined();
  });

  it('never reports a window past the end', () => {
    expect(formatWindowLine(9, 3)).toBe('Window 3 of 3');
    expect(formatWindowLine(-2, 3)).toBe('Window 1 of 3');
  });

  it('survives nonsense input', () => {
    expect(formatWindowLine(Number.NaN, 3)).toBeUndefined();
    expect(formatWindowLine(0, Number.NaN)).toBeUndefined();
  });
});

describe('formatRate', () => {
  it('reports whole tabs per second once the restore is moving', () => {
    expect(formatRate(90, 2000)).toBe('~45 tabs/s');
    expect(formatRate(25, 1000)).toBe('~25 tabs/s');
  });

  it('keeps a decimal for slow restores', () => {
    expect(formatRate(2, 5000)).toBe('~0.4 tabs/s');
  });

  it('uses the singular for exactly one tab a second', () => {
    expect(formatRate(1, 1000)).toBe('~1 tab/s');
  });

  it('waits for a usable sample', () => {
    expect(formatRate(0, 5000)).toBeUndefined();
    expect(formatRate(4, 100)).toBeUndefined();
    expect(formatRate(4, Number.NaN)).toBeUndefined();
  });
});

describe('lazy restore hints', () => {
  it('explains that discarded tabs load when clicked', () => {
    expect(LAZY_RESTORE_HINT).toContain('loads when you click it');
    expect(lazyRestoreSummaryHint(12)).toBe('12 tabs stayed unloaded and will load when clicked.');
    expect(lazyRestoreSummaryHint(1)).toBe('1 tab stayed unloaded and will load when clicked.');
  });

  it('says nothing when nothing was discarded', () => {
    expect(lazyRestoreSummaryHint(0)).toBeUndefined();
  });
});
