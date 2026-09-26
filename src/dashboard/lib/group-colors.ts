import type { TabGroupColor } from '@/types';

/*
 * Chrome's own tab-group colours — the one file in the app allowed to name a colour literally.
 * These are *Chrome's* values, shown so a group reads the same here as it does in the tab strip,
 * and they must not follow the app theme: swap the design system and a blue group is still blue.
 * Everything else in the UI resolves through the tokens in src/options/index.css.
 */

/**
 * The group label as a chip: a soft tint behind text in the same hue, rather than white text on a
 * saturated fill.
 *
 * The saturated version is what the design mockup drew, and it cannot be made accessible. Measured
 * against Chrome's nine colours at Tailwind's `-500`, **five of them** — blue, red, pink, purple
 * and orange — clear 4.5:1 with neither white nor near-black text; blue tops out at 3.76:1. Small
 * bold text on a coloured fill is simply the wrong shape for this palette.
 *
 * These pairings were measured instead of guessed, compositing the tint over `--card` in each
 * scheme: the weakest is 4.54:1 (green, light) and 4.99:1 (yellow, dark). `-200` rather than `-300`
 * for dark text because yellow and cyan land at 4.39 and 4.47 with `-300` — just under.
 */
export const GROUP_CHIP_CLASS: Record<TabGroupColor, string> = {
  grey: 'bg-gray-500/15 text-gray-700 dark:bg-gray-400/20 dark:text-gray-200',
  blue: 'bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-200',
  red: 'bg-red-500/15 text-red-700 dark:bg-red-400/20 dark:text-red-200',
  yellow: 'bg-yellow-500/15 text-yellow-700 dark:bg-yellow-400/20 dark:text-yellow-200',
  green: 'bg-green-500/15 text-green-700 dark:bg-green-400/20 dark:text-green-200',
  pink: 'bg-pink-500/15 text-pink-700 dark:bg-pink-400/20 dark:text-pink-200',
  purple: 'bg-purple-500/15 text-purple-700 dark:bg-purple-400/20 dark:text-purple-200',
  cyan: 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/20 dark:text-cyan-200',
  orange: 'bg-orange-500/15 text-orange-700 dark:bg-orange-400/20 dark:text-orange-200',
};

/**
 * The rail down the left of a group's rows, tying them to the chip above. Decorative — the chip
 * already names the group in text — so it carries no contrast requirement of its own.
 */
export const GROUP_RAIL_CLASS: Record<TabGroupColor, string> = {
  grey: 'border-gray-500/40',
  blue: 'border-blue-500/40',
  red: 'border-red-500/40',
  yellow: 'border-yellow-500/40',
  green: 'border-green-500/40',
  pink: 'border-pink-500/40',
  purple: 'border-purple-500/40',
  cyan: 'border-cyan-500/40',
  orange: 'border-orange-500/40',
};

function isTabGroupColor(value: string): value is TabGroupColor {
  return Object.hasOwn(GROUP_CHIP_CLASS, value);
}

export function groupChipClass(color: string): string {
  return isTabGroupColor(color) ? GROUP_CHIP_CLASS[color] : GROUP_CHIP_CLASS.grey;
}

export function groupRailClass(color: string): string {
  return isTabGroupColor(color) ? GROUP_RAIL_CLASS[color] : GROUP_RAIL_CLASS.grey;
}
