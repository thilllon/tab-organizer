import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  countTabs,
  formatRestoreSummary,
  needsRestoreConfirm,
  RESTORE_CONFIRM_THRESHOLD,
  splitRestoreErrors,
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

describe('splitRestoreErrors', () => {
  it('treats group/activate/window-state urls as structural, everything else as a tab error', () => {
    const result = {
      restored: 1,
      discarded: 0,
      skipped: [],
      errors: [
        { url: 'https://a', message: 'boom' },
        { url: 'group:Work', message: 'drag lock' },
        { url: 'activate:https://b', message: 'tab closed' },
        { url: 'window-state:minimized', message: 'nope' },
      ],
    };
    expect(splitRestoreErrors(result)).toEqual({
      tabErrors: [{ url: 'https://a', message: 'boom' }],
      structuralProblems: [
        { url: 'group:Work', message: 'drag lock' },
        { url: 'activate:https://b', message: 'tab closed' },
        { url: 'window-state:minimized', message: 'nope' },
      ],
    });
  });

  it('returns empty arrays when there are no errors', () => {
    expect(splitRestoreErrors({ restored: 1, discarded: 0, skipped: [], errors: [] })).toEqual({
      tabErrors: [],
      structuralProblems: [],
    });
  });
});

describe('formatRestoreSummary', () => {
  it('reports a clean restore', () => {
    expect(formatRestoreSummary({ restored: 5, discarded: 0, skipped: [], errors: [] }, 5)).toBe(
      'Restored 5 of 5 tabs',
    );
  });

  it('reports skipped and failed tabs', () => {
    const result = {
      restored: 410,
      discarded: 0,
      skipped: ['file:///a', 'javascript:void(0)'],
      errors: [{ url: 'https://x', message: 'boom' }],
    };
    expect(formatRestoreSummary(result, 413)).toBe(
      'Restored 410 of 413 tabs · 2 skipped · 1 could not be opened',
    );
  });

  it('uses singular forms', () => {
    expect(formatRestoreSummary({ restored: 0, discarded: 0, skipped: ['a'], errors: [] }, 1)).toBe(
      'Restored 0 of 1 tab · 1 skipped',
    );
  });

  it('reports structural (group/window) problems separately from tab errors', () => {
    const result = {
      restored: 10,
      discarded: 0,
      skipped: [],
      errors: [
        { url: 'https://a', message: 'boom' },
        { url: 'group:Work', message: 'drag lock' },
        { url: 'activate:https://b', message: 'tab closed' },
        { url: 'window-state:minimized', message: 'nope' },
      ],
    };
    expect(formatRestoreSummary(result, 11)).toBe(
      'Restored 10 of 11 tabs · 1 could not be opened · 3 group/window problems',
    );
  });

  it('uses the singular form for a single structural problem', () => {
    const result = {
      restored: 10,
      discarded: 0,
      skipped: [],
      errors: [{ url: 'group:Work', message: 'drag lock' }],
    };
    expect(formatRestoreSummary(result, 10)).toBe(
      'Restored 10 of 10 tabs · 1 group/window problem',
    );
  });

  it('calls out lazily restored tabs, before the skipped/failed counts', () => {
    expect(formatRestoreSummary({ restored: 80, discarded: 77, skipped: [], errors: [] }, 80)).toBe(
      'Restored 80 of 80 tabs · 77 tabs will load when clicked',
    );
    expect(
      formatRestoreSummary({ restored: 2, discarded: 1, skipped: ['file:///a'], errors: [] }, 3),
    ).toBe('Restored 2 of 3 tabs · 1 tab will load when clicked · 1 skipped');
  });

  it('keeps the lazy count on a cancelled restore', () => {
    expect(
      formatRestoreSummary({ restored: 25, discarded: 20, skipped: [], errors: [] }, 25, {
        cancelled: true,
      }),
    ).toBe('Restore cancelled — 25 tabs opened · 20 tabs will load when clicked');
  });

  it('reports a cancelled restore as a plain count instead of a fraction', () => {
    expect(
      formatRestoreSummary({ restored: 25, discarded: 0, skipped: [], errors: [] }, 25, {
        cancelled: true,
      }),
    ).toBe('Restore cancelled — 25 tabs opened');
  });

  it('uses the singular form for a cancelled restore of one tab', () => {
    expect(
      formatRestoreSummary({ restored: 1, discarded: 0, skipped: [], errors: [] }, 1, {
        cancelled: true,
      }),
    ).toBe('Restore cancelled — 1 tab opened');
  });
});
