import type { SessionSummary } from '@/types';

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSessionMeta(
  summary: Pick<SessionSummary, 'windowCount' | 'tabCount' | 'bytes'>,
): string {
  return [
    pluralize(summary.windowCount, 'window'),
    pluralize(summary.tabCount, 'tab'),
    formatBytes(summary.bytes),
  ].join(' · ');
}

export function hostnameOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return parsed.hostname;
  }
  // chrome://extensions/ -> "chrome://extensions", about:blank -> "about:blank". A non-http(s)
  // scheme parses its authority as `hostname` too (e.g. "extensions"), so branch on protocol
  // rather than on `hostname.length` and fall back to the trimmed input url.
  return url.replace(/\/+$/, '');
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
