import { describe, expect, it } from 'vitest';

import { nothingToSaveNotice } from '@/lib/save-notice';

describe('nothingToSaveNotice', () => {
  it('words the current-window save', () => {
    expect(nothingToSaveNotice('window')).toBe('Nothing to save: this window only holds Tabinet.');
  });

  it('words the all-windows save', () => {
    expect(nothingToSaveNotice('all')).toBe(
      'Nothing to save: no open window holds anything besides Tabinet.',
    );
  });

  it('treats one chosen window like the current one', () => {
    expect(nothingToSaveNotice({ windowId: 7 })).toBe(
      'Nothing to save: this window only holds Tabinet.',
    );
  });

  it('words a selection of tabs that are gone', () => {
    expect(nothingToSaveNotice({ tabIds: [1, 2] })).toBe(
      'Nothing to save: the selected tabs are no longer open.',
    );
  });
});
