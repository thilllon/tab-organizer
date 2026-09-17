import { describe, expect, it } from 'vitest';
import { defaultSessionName, ensureUniqueName, slugify } from './naming';

describe('ensureUniqueName', () => {
  it('returns the name unchanged when it is not taken', () => {
    expect(ensureUniqueName('Work', [])).toBe('Work');
    expect(ensureUniqueName('Work', ['Home', 'Work (2)'])).toBe('Work');
  });

  it('appends (2) when the name is taken', () => {
    expect(ensureUniqueName('Work', ['Work'])).toBe('Work (2)');
  });

  it('skips suffixes that are already taken', () => {
    expect(ensureUniqueName('Work', ['Work', 'Work (2)', 'Work (3)'])).toBe('Work (4)');
    expect(ensureUniqueName('Work', ['Work', 'Work (3)'])).toBe('Work (2)');
  });

  it('does not strip an existing suffix from the base name', () => {
    expect(ensureUniqueName('Work (2)', ['Work (2)'])).toBe('Work (2) (2)');
  });

  it('accepts any iterable of names', () => {
    expect(ensureUniqueName('Work', new Set(['Work']))).toBe('Work (2)');
  });
});

describe('defaultSessionName', () => {
  it('formats local date/time with zero padding and plural counts', () => {
    const date = new Date(2026, 7, 29, 14, 3); // local time: 2026-08-29 14:03
    expect(defaultSessionName(date, 3, 87)).toBe('Session 2026-08-29 14:03 · 3 windows · 87 tabs');
  });

  it('uses singular nouns for 1', () => {
    const date = new Date(2026, 0, 5, 9, 7);
    expect(defaultSessionName(date, 1, 1)).toBe('Session 2026-01-05 09:07 · 1 window · 1 tab');
  });

  it('uses plural for 0', () => {
    const date = new Date(2026, 11, 31, 23, 59);
    expect(defaultSessionName(date, 0, 0)).toBe('Session 2026-12-31 23:59 · 0 windows · 0 tabs');
  });
});

describe('slugify', () => {
  it('lowercases and replaces runs of non-alphanumerics with a single dash', () => {
    expect(slugify('Session 2026-08-29 14:03 · 3 windows · 87 tabs')).toBe(
      'session-2026-08-29-14-03-3-windows-87-ta',
    );
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --Hello World!--  ')).toBe('hello-world');
  });

  it('caps at 40 characters without a trailing dash', () => {
    const long = `${'a'.repeat(39)} b`;
    expect(slugify(long)).toBe('a'.repeat(39));
    expect(slugify('x'.repeat(100)).length).toBe(40);
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('···')).toBe('');
  });
});
