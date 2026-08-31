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
 */
export function contentHash(windows: WindowSnapshot[]): string {
  const material = windows
    .map((window) =>
      window.tabs
        .map((tab) =>
          [
            tab.url,
            tab.pinned ? 1 : 0,
            tab.groupIndex ?? -1,
            tab.groupIndex !== undefined ? (window.groups[tab.groupIndex]?.title ?? '') : '',
          ].join(''),
        )
        .join(''),
    )
    .join('');
  return fnv1a32(material);
}
