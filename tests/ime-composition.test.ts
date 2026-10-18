import { describe, expect, it } from 'vitest';

import { isComposingEnter } from '@/lib/ime-composition';

describe('isComposingEnter', () => {
  it('is true while the IME reports a composition', () => {
    expect(isComposingEnter({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true);
  });

  it('is true for the legacy keyCode 229 even when isComposing is false', () => {
    expect(isComposingEnter({ nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true);
  });

  it('is false for a plain Enter', () => {
    expect(isComposingEnter({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  });
});
