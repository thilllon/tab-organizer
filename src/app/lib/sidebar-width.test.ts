import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from './sidebar-width';

describe('clampSidebarWidth', () => {
  it('keeps the width between the bounds', () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9000)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it('rounds to whole pixels and falls back for a value that is not a number', () => {
    expect(clampSidebarWidth(260.6)).toBe(261);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
