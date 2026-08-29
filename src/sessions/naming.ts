function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Default name for a captured session, in local time:
 * "Session 2026-08-29 14:03 · 3 windows · 87 tabs"
 */
export function defaultSessionName(date: Date, windowCount: number, tabCount: number): string {
  const stamp =
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `Session ${stamp} · ${plural(windowCount, 'window')} · ${plural(tabCount, 'tab')}`;
}

/** Lowercase, non-alphanumerics collapsed to `-`, trimmed, at most 40 characters. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
