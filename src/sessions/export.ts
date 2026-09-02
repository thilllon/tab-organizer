import type {
  ExportBundle,
  ExportFormat,
  GroupSnapshot,
  Session,
  TabSnapshot,
  WindowSnapshot,
} from '@/types';
import { SESSION_SCHEMA_VERSION } from '@/types';
import { contentHash } from './hash';
import { slugify } from './naming';

/**
 * Pure serializers for the dashboard's export / copy actions. No DOM, no chrome.* calls, so
 * the same functions run under vitest (Node) and in the extension page.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export type ExportScope =
  | { session: Session }
  | { session: Session; windowIndex: number }
  | { session: Session; windowIndex: number; groupIndex: number };

function withWindows(session: Session, windows: WindowSnapshot[]): Session {
  const result: Session = { ...session, windows };
  if (session.contentHash !== undefined) {
    result.contentHash = contentHash(windows);
  }
  return result;
}

/** The group's tabs only, with the group re-indexed to 0. Pinned tabs are never grouped. */
function extractGroup(window: WindowSnapshot, groupIndex: number): WindowSnapshot {
  const group = window.groups[groupIndex];
  if (group === undefined) {
    throw new RangeError(`No group at index ${groupIndex}`);
  }
  const tabs = window.tabs
    .filter((tab) => tab.groupIndex === groupIndex)
    .map((tab) => ({ ...tab, groupIndex: 0 }));
  return { ...window, groups: [group], tabs };
}

/** Narrows a session to one window or one group; the whole session is returned as-is. */
export function scopeToSession(scope: ExportScope): Session {
  if (!('windowIndex' in scope)) {
    return scope.session;
  }
  const window = scope.session.windows[scope.windowIndex];
  if (window === undefined) {
    throw new RangeError(`No window at index ${scope.windowIndex}`);
  }
  if (!('groupIndex' in scope)) {
    return withWindows(scope.session, [window]);
  }
  const extracted = extractGroup(window, scope.groupIndex);
  // Sessions never hold empty windows, so a tab-less group yields no window at all.
  return withWindows(scope.session, extracted.tabs.length === 0 ? [] : [extracted]);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface IndexedWindow {
  window: WindowSnapshot;
  number: number; // 1-based, matching "Window N" in the human-readable formats
}

function populatedWindows(session: Session): IndexedWindow[] {
  return session.windows
    .map((window, index) => ({ window, number: index + 1 }))
    .filter(({ window }) => window.tabs.length > 0);
}

interface GroupedTabs {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
}

interface WindowLayout {
  ungrouped: TabSnapshot[];
  groups: GroupedTabs[];
}

/**
 * Ungrouped tabs first (pinned tabs are always ungrouped), then every group that has tabs, in
 * first-appearance order. Markdown headings and bookmark folders cannot express a run of
 * ungrouped tabs *between* two groups, so the strip order is regrouped this way.
 */
function layoutWindow(window: WindowSnapshot): WindowLayout {
  const ungrouped = window.tabs.filter((tab) => tab.groupIndex === undefined);
  const groups = window.groups
    .map((group, index) => ({ group, tabs: window.tabs.filter((tab) => tab.groupIndex === index) }))
    .filter(({ tabs }) => tabs.length > 0);
  return { ungrouped, groups };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Files end with a newline; an empty export stays empty. */
function terminate(body: string): string {
  return body === '' ? '' : `${body}\n`;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function toJson(sessions: Session[], exportedAt: number): string {
  const bundle: ExportBundle = {
    app: 'tab-organizer',
    schemaVersion: SESSION_SCHEMA_VERSION,
    exportedAt,
    sessions,
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Backslash-escapes the characters that would break a `[title](url)` link text. */
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\[\]]/g, (char) => `\\${char}`);
}

// `encodeURIComponent` leaves parentheses alone, so they are mapped by hand.
const MARKDOWN_URL_ESCAPES = new Map<string, string>([
  ['(', '%28'],
  [')', '%29'],
]);

/** Parentheses and whitespace would end a link destination early; percent-encode them. */
function markdownUrl(url: string): string {
  return url.replace(
    /[()\s]/g,
    (char) => MARKDOWN_URL_ESCAPES.get(char) ?? encodeURIComponent(char),
  );
}

function markdownTab(tab: TabSnapshot): string {
  const title = tab.title === '' ? tab.url : tab.title;
  const marker = tab.pinned ? ' (pinned)' : '';
  return `- [${escapeMarkdownText(title)}](${markdownUrl(tab.url)})${marker}`;
}

function markdownWindow({ window, number }: IndexedWindow): string {
  const { ungrouped, groups } = layoutWindow(window);
  const lines = [`### Window ${number}`, ...ungrouped.map(markdownTab)];
  for (const { group, tabs } of groups) {
    lines.push(
      `#### ${group.title === '' ? 'Untitled group' : group.title}`,
      ...tabs.map(markdownTab),
    );
  }
  return lines.join('\n');
}

/**
 * `## session` / `### Window N` / `#### group` / `- [title](url) (pinned)`. Blank lines separate
 * windows (and sessions) only, so pasting the result back splits into the same windows.
 */
export function toMarkdown(sessions: Session[]): string {
  const blocks = sessions.map((session) =>
    [`## ${session.name}`, ...populatedWindows(session).map(markdownWindow)].join('\n\n'),
  );
  return terminate(blocks.join('\n\n'));
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** One URL per line; a blank line between windows and between sessions. */
export function toText(sessions: Session[]): string {
  const blocks = sessions.map((session) =>
    populatedWindows(session)
      .map(({ window }) => window.tabs.map((tab) => tab.url).join('\n'))
      .join('\n\n'),
  );
  return terminate(blocks.filter((block) => block !== '').join('\n\n'));
}

// ---------------------------------------------------------------------------
// Netscape bookmark HTML
// ---------------------------------------------------------------------------

const HTML_ESCAPES = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char);
}

const HTML_HEADER = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<!-- This is an automatically generated file.',
  '     It will be read and overwritten.',
  '     DO NOT EDIT! -->',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
];

/** Netscape ADD_DATE values are Unix seconds. */
function toUnixSeconds(epochMs: number): number {
  return Math.floor(epochMs / 1000);
}

function indent(depth: number): string {
  return '    '.repeat(depth);
}

function htmlLink(tab: TabSnapshot, addDate: number, depth: number): string {
  return `${indent(depth)}<DT><A HREF="${escapeHtml(tab.url)}" ADD_DATE="${addDate}">${escapeHtml(tab.title)}</A>`;
}

/** `<DT><H3>` naming a folder, followed by the `<DL><p>` … `</DL><p>` that holds its children. */
function htmlFolder(title: string, dates: string, depth: number, children: string[]): string[] {
  return [
    `${indent(depth)}<DT><H3 ${dates}>${escapeHtml(title)}</H3>`,
    `${indent(depth)}<DL><p>`,
    ...children,
    `${indent(depth)}</DL><p>`,
  ];
}

function htmlWindow({ window, number }: IndexedWindow, addDate: number, depth: number): string[] {
  const { ungrouped, groups } = layoutWindow(window);
  const children = ungrouped.map((tab) => htmlLink(tab, addDate, depth + 1));
  for (const { group, tabs } of groups) {
    children.push(
      ...htmlFolder(
        group.title,
        `ADD_DATE="${addDate}"`,
        depth + 1,
        tabs.map((tab) => htmlLink(tab, addDate, depth + 2)),
      ),
    );
  }
  return htmlFolder(`Window ${number}`, `ADD_DATE="${addDate}"`, depth, children);
}

function htmlSession(session: Session, depth: number): string[] {
  const addDate = toUnixSeconds(session.createdAt);
  const dates = `ADD_DATE="${addDate}" LAST_MODIFIED="${toUnixSeconds(session.updatedAt)}"`;
  const children = populatedWindows(session).flatMap((entry) =>
    htmlWindow(entry, addDate, depth + 1),
  );
  return htmlFolder(session.name, dates, depth, children);
}

/**
 * Netscape bookmark file (what Chrome's bookmark manager imports/exports): a folder per
 * session, per window and per group. Group colour, collapsed state and pinning have no
 * bookmark equivalent and are dropped.
 */
export function toHtml(sessions: Session[]): string {
  const lines = [
    ...HTML_HEADER,
    '<DL><p>',
    ...sessions.flatMap((session) => htmlSession(session, 1)),
    '</DL><p>',
  ];
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180: fields holding a comma, quote or line break are quoted; quotes are doubled. */
export function csvEscape(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export const CSV_HEADER = 'session,window,group,index,pinned,title,url';

/** One row per tab in strip order. `window` and `index` are 1-based like "Window N". */
export function toCsv(sessions: Session[]): string {
  const rows = [CSV_HEADER];
  for (const session of sessions) {
    for (const [windowIndex, window] of session.windows.entries()) {
      for (const [tabIndex, tab] of window.tabs.entries()) {
        const group =
          tab.groupIndex === undefined ? '' : (window.groups[tab.groupIndex]?.title ?? '');
        const fields = [
          session.name,
          String(windowIndex + 1),
          group,
          String(tabIndex + 1),
          String(tab.pinned),
          tab.title,
          tab.url,
        ];
        rows.push(fields.map(csvEscape).join(','));
      }
    }
  }
  return `${rows.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Format table
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<ExportFormat, string> = {
  json: 'json',
  markdown: 'md',
  text: 'txt',
  html: 'html',
  csv: 'csv',
};

const MIME_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  markdown: 'text/markdown',
  text: 'text/plain',
  html: 'text/html',
  csv: 'text/csv',
};

export function extensionFor(format: ExportFormat): string {
  return EXTENSIONS[format];
}

export function mimeTypeFor(format: ExportFormat): string {
  return MIME_TYPES[format];
}

/** `tab-organizer-<slug>-<yyyyMMdd-HHmm>.<ext>` in local time; the slug is omitted when empty. */
export function exportFilename(base: string, format: ExportFormat, date: Date): string {
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  const slug = slugify(base);
  const middle = slug === '' ? '' : `${slug}-`;
  return `tab-organizer-${middle}${stamp}.${extensionFor(format)}`;
}

export function serialize(format: ExportFormat, sessions: Session[], exportedAt: number): string {
  switch (format) {
    case 'json': {
      return toJson(sessions, exportedAt);
    }
    case 'markdown': {
      return toMarkdown(sessions);
    }
    case 'text': {
      return toText(sessions);
    }
    case 'html': {
      return toHtml(sessions);
    }
    case 'csv': {
      return toCsv(sessions);
    }
  }
}
