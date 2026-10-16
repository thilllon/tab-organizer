import { describe, expect, it } from 'vitest';
import { isIndexChange } from '@/hooks/useSessionIndex';
import { INDEX_KEY } from '@/lib/storage';

describe('isIndexChange', () => {
  it('is true when the session index changed in local storage', () => {
    expect(isIndexChange({ [INDEX_KEY]: { newValue: { sessions: [] } } }, 'local')).toBe(true);
  });

  it('is false for other keys', () => {
    expect(isIndexChange({ 'session:abc': { newValue: {} } }, 'local')).toBe(false);
  });

  it('is false for other storage areas', () => {
    expect(isIndexChange({ [INDEX_KEY]: { newValue: {} } }, 'sync')).toBe(false);
  });
});
