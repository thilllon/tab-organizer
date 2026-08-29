import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  countTabs,
  formatRestoreSummary,
  needsRestoreConfirm,
  RESTORE_CONFIRM_THRESHOLD,
} from './restore-summary';

function sessionWithTabs(...counts: number[]): Session {
  return {
    schemaVersion: 1,
    id: 'id',
    kind: 'saved',
    name: 'n',
    origin: 'manual',
    createdAt: 0,
    updatedAt: 0,
    windows: counts.map((count) => ({
      state: 'normal',
      focused: false,
      groups: [],
      tabs: Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: '',
        pinned: false,
        active: i === 0,
      })),
    })),
  };
}

describe('countTabs / needsRestoreConfirm', () => {
  it('sums tabs across windows', () => {
    expect(countTabs(sessionWithTabs(3, 4))).toBe(7);
  });

  it('requires confirmation only above the threshold', () => {
    expect(RESTORE_CONFIRM_THRESHOLD).toBe(100);
    expect(needsRestoreConfirm(sessionWithTabs(100))).toBe(false);
    expect(needsRestoreConfirm(sessionWithTabs(50, 51))).toBe(true);
  });
});

describe('formatRestoreSummary', () => {
  it('reports a clean restore', () => {
    expect(formatRestoreSummary({ restored: 5, skipped: [], errors: [] }, 5)).toBe(
      'Restored 5 of 5 tabs',
    );
  });

  it('reports skipped and failed tabs', () => {
    const result = {
      restored: 410,
      skipped: ['file:///a', 'javascript:void(0)'],
      errors: [{ url: 'https://x', message: 'boom' }],
    };
    expect(formatRestoreSummary(result, 413)).toBe(
      'Restored 410 of 413 tabs · 2 skipped · 1 could not be opened',
    );
  });

  it('uses singular forms', () => {
    expect(formatRestoreSummary({ restored: 0, skipped: ['a'], errors: [] }, 1)).toBe(
      'Restored 0 of 1 tab · 1 skipped',
    );
  });
});
