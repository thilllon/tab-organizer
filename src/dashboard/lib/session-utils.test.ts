import { describe, expect, it } from 'vitest';
import type { Session, WindowSnapshot } from '@/types';
import { pickWindow } from './session-utils';

function makeWindow(url: string): WindowSnapshot {
  return {
    state: 'normal',
    focused: false,
    groups: [],
    tabs: [{ url, title: url, pinned: false, active: true }],
  };
}

const session: Session = {
  schemaVersion: 1,
  id: 'abc',
  kind: 'saved',
  name: 'Fixture',
  origin: 'manual',
  createdAt: 1,
  updatedAt: 2,
  windows: [makeWindow('https://a.example/'), makeWindow('https://b.example/')],
};

describe('pickWindow', () => {
  it('returns a session containing only the requested window', () => {
    const picked = pickWindow(session, 1);
    expect(picked.windows).toEqual([session.windows[1]]);
    expect(picked.id).toBe('abc');
    expect(picked.name).toBe('Fixture');
  });

  it('does not mutate the original session', () => {
    pickWindow(session, 0);
    expect(session.windows).toHaveLength(2);
  });

  it('throws a RangeError for an out-of-range index', () => {
    expect(() => pickWindow(session, 2)).toThrow(RangeError);
    expect(() => pickWindow(session, -1)).toThrow(RangeError);
  });
});
