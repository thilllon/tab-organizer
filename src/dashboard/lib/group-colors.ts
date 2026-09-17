import type { TabGroupColor } from '@/types';

export const GROUP_COLOR_CLASS: Record<TabGroupColor, string> = {
  grey: 'bg-gray-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
};

function isTabGroupColor(value: string): value is TabGroupColor {
  return Object.hasOwn(GROUP_COLOR_CLASS, value);
}

export function groupColorClass(color: string): string {
  return isTabGroupColor(color) ? GROUP_COLOR_CLASS[color] : GROUP_COLOR_CLASS.grey;
}
