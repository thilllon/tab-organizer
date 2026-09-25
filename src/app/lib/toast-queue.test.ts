import { describe, expect, it } from 'vitest';
import { dropToast, MAX_TOASTS, pushToast, type Toast } from './toast-queue';

const t = (id: number, message = 'Saved'): Toast => ({ id, message });

describe('pushToast', () => {
  it('appends, newest last', () => {
    expect(pushToast([t(1)], t(2))).toEqual([t(1), t(2)]);
  });

  it('caps the stack by dropping the oldest, not by refusing the newest', () => {
    const full = [t(1), t(2), t(3)];
    expect(pushToast(full, t(4))).toEqual([t(2), t(3), t(4)]);
    expect(pushToast(full, t(4))).toHaveLength(MAX_TOASTS);
  });

  it('keeps a repeated message as its own entry', () => {
    // Three flicks of one switch are three confirmations, not one.
    const after = pushToast(pushToast([], t(1, 'Saved')), t(2, 'Saved'));
    expect(after).toHaveLength(2);
  });

  it('honours a caller-supplied cap, and treats a non-positive one as "show nothing"', () => {
    expect(pushToast([t(1), t(2)], t(3), 2)).toEqual([t(2), t(3)]);
    expect(pushToast([t(1)], t(2), 0)).toEqual([]);
  });
});

describe('dropToast', () => {
  it('removes only the matching id', () => {
    expect(dropToast([t(1), t(2), t(3)], 2)).toEqual([t(1), t(3)]);
  });

  it('is a no-op when the cap already evicted that toast', () => {
    // The timer for a toast pushed out by the cap still fires; it must not disturb the rest.
    const list = [t(2), t(3), t(4)];
    expect(dropToast(list, 1)).toEqual(list);
  });
});
