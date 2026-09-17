import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });

  it('falls back to a generic message for empty values', () => {
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage(new Error(''))).toBe('Unknown error');
  });
});
