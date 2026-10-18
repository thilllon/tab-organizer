import { describe, expect, it } from 'vitest';

import { isBodyChange } from '@/hooks/use-session-body';
import { sessionKey } from '@/lib/session-repo';

describe('isBodyChange', () => {
  it('is true when the body of the given session changed in local storage', () => {
    expect(isBodyChange({ [sessionKey('abc')]: { newValue: {} } }, 'local', 'abc')).toBe(true);
  });

  it('is false for another session or another area', () => {
    expect(isBodyChange({ [sessionKey('xyz')]: { newValue: {} } }, 'local', 'abc')).toBe(false);
    expect(isBodyChange({ [sessionKey('abc')]: { newValue: {} } }, 'sync', 'abc')).toBe(false);
  });
});
