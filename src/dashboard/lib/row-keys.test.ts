import { describe, expect, it } from 'vitest';
import { sessionRowKeyAction } from '@/dashboard/lib/row-keys';

describe('sessionRowKeyAction', () => {
  it('expands and collapses on Enter', () => {
    expect(sessionRowKeyAction('Enter', { editing: false })).toBe('toggle');
  });

  it('opens the delete confirm on Delete', () => {
    expect(sessionRowKeyAction('Delete', { editing: false })).toBe('delete');
  });

  it('ignores every other key so typing and navigation still work', () => {
    for (const key of ['Backspace', ' ', 'a', 'Tab', 'Escape', 'ArrowDown', 'x']) {
      expect(sessionRowKeyAction(key, { editing: false })).toBeUndefined();
    }
  });

  it('does nothing while the rename input is open', () => {
    expect(sessionRowKeyAction('Delete', { editing: true })).toBeUndefined();
    expect(sessionRowKeyAction('Enter', { editing: true })).toBeUndefined();
  });
});
