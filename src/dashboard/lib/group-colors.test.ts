import { describe, expect, it } from 'vitest';
import { GROUP_CHIP_CLASS, GROUP_RAIL_CLASS, groupChipClass, groupRailClass } from './group-colors';

describe('group colour classes', () => {
  it('covers every Chrome tab group colour, in both schemes', () => {
    for (const [color, className] of Object.entries(GROUP_CHIP_CLASS)) {
      expect(groupChipClass(color)).toBe(className);
      // A tint, a text colour, and a dark-mode pair for each — the contrast of these pairings was
      // measured over --card; see the comment on GROUP_CHIP_CLASS.
      expect(className).toMatch(
        /^bg-[a-z]+-500\/15 text-[a-z]+-700 dark:bg-[a-z]+-400\/20 dark:text-[a-z]+-200$/,
      );
    }
    for (const [color, className] of Object.entries(GROUP_RAIL_CLASS)) {
      expect(groupRailClass(color)).toBe(className);
      expect(className).toMatch(/^border-[a-z]+-500\/40$/);
    }
  });

  it('keeps the chip and the rail in step', () => {
    expect(Object.keys(GROUP_CHIP_CLASS)).toEqual(Object.keys(GROUP_RAIL_CLASS));
  });

  it("maps Chrome's grey onto Tailwind's gray", () => {
    expect(groupChipClass('grey')).toContain('gray');
  });

  it('falls back to grey for a colour Chrome has not shipped yet', () => {
    expect(groupChipClass('magenta')).toBe(GROUP_CHIP_CLASS.grey);
    expect(groupRailClass('magenta')).toBe(GROUP_RAIL_CLASS.grey);
  });
});
