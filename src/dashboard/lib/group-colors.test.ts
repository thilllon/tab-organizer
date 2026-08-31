import { describe, expect, it } from 'vitest';
import { GROUP_COLOR_CLASS, groupColorClass } from './group-colors';

describe('groupColorClass', () => {
  it('maps every Chrome tab group colour to a Tailwind background class', () => {
    for (const [color, className] of Object.entries(GROUP_COLOR_CLASS)) {
      expect(groupColorClass(color)).toBe(className);
      expect(className).toMatch(/^bg-[a-z]+-500$/);
    }
  });

  it('maps grey to the gray palette', () => {
    expect(groupColorClass('grey')).toBe('bg-gray-500');
  });

  it('falls back to grey for unknown colours', () => {
    expect(groupColorClass('magenta')).toBe('bg-gray-500');
  });
});
