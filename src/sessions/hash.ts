import type { WindowSnapshot } from '@/types';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over a string's UTF-16 code units, as 8 zero-padded hex chars. */
export function fnv1a32(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Stable fingerprint of a session's tab layout. Titles are deliberately excluded so
 * that a page changing its <title> does not produce a new history snapshot.
 *
 * The material is `JSON.stringify`d rather than concatenated: JSON quotes and escapes every
 * string, so window, tab and field boundaries are self-delimiting. A plain join cannot be --
 * every separator character is legal inside a URL (`file:`/`data:` URLs carry spaces) or inside
 * a group title (arbitrary user text), so moving a tab across a window boundary, or shifting
 * where one field ends and the next begins, would leave the concatenation byte-identical and
 * `takeHistorySnapshot()` would report `'skipped-unchanged'` for a layout the user did change.
 */
export function contentHash(windows: WindowSnapshot[]): string {
  const material = JSON.stringify(
    windows.map((window) =>
      window.tabs.map((tab) => [
        tab.url,
        tab.pinned ? 1 : 0,
        tab.groupIndex ?? -1,
        tab.groupIndex !== undefined ? (window.groups[tab.groupIndex]?.title ?? '') : '',
      ]),
    ),
  );
  return fnv1a32(material);
}
