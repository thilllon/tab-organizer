import { t, tp } from '@/lib/i18n';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Local-time "2026-08-29 14:03". Numeric on purpose, in every UI language: it sorts, reads the
 * same everywhere and `slugify()` keeps it in export file names.
 */
export function formatNameStamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * Default name for a captured session, in local time and the UI language at capture time:
 * "Session 2026-08-29 14:03 · 3 windows · 87 tabs"
 */
export function defaultSessionName(date: Date, windowCount: number, tabCount: number): string {
  return t(
    'sessionDefaultName',
    formatNameStamp(date),
    tp('windowCount', windowCount),
    tp('tabCount', tabCount),
  );
}

/**
 * `name`, or `name (2)`, `name (3)`, ... - the first that is not in `existingNames`. Two saves in
 * the same minute get the same default name otherwise.
 */
export function ensureUniqueName(name: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  if (!taken.has(name)) {
    return name;
  }
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
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
