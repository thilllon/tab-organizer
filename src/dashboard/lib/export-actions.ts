import { errorMessage } from '@/dashboard/lib/errors';
import { pluralize } from '@/dashboard/lib/format';
import type { ExportScope } from '@/sessions/export';
import { sessionRepo } from '@/sessions/storage';
import type { ExportFormat, Session, SessionId, SessionSummary } from '@/types';

/**
 * Everything the export menu and the header's "Export all" decide, kept out of the components:
 * which items the menu shows, what a scope is called, what the confirmation says, and how the
 * bodies of a whole backup are collected. Serialization itself lives in `src/sessions/export.ts`.
 */

export interface ExportFormatItem {
  format: ExportFormat;
  /** Menu item text; also what the QA script looks for. */
  label: string;
}

export const EXPORT_FORMAT_ITEMS: readonly ExportFormatItem[] = [
  { format: 'json', label: 'Export as JSON' },
  { format: 'markdown', label: 'Export as Markdown' },
  { format: 'text', label: 'Export as text' },
  { format: 'html', label: 'Export as HTML bookmarks' },
  { format: 'csv', label: 'Export as CSV' },
];

/** How a format is named inside a sentence ("Exported “Work” as HTML bookmarks."). */
const FORMAT_NAMES: Record<ExportFormat, string> = {
  json: 'JSON',
  markdown: 'Markdown',
  text: 'text',
  html: 'HTML bookmarks',
  csv: 'CSV',
};

export function formatName(format: ExportFormat): string {
  return FORMAT_NAMES[format];
}

/**
 * The optional indices the menu carries as props, as the discriminated `ExportScope` union
 * `scopeToSession()` expects. A `groupIndex` without a `windowIndex` is meaningless and is
 * treated as the whole session.
 */
export function buildExportScope(
  session: Session,
  windowIndex?: number,
  groupIndex?: number,
): ExportScope {
  if (windowIndex === undefined) {
    return { session };
  }
  if (groupIndex === undefined) {
    return { session, windowIndex };
  }
  return { session, windowIndex, groupIndex };
}

/**
 * What the export is called in the filename and in the confirmation: the session name, narrowed
 * by "Window N" or by the group's title. An out-of-range index falls back to the session name —
 * a stale click must not throw on the way to a notice.
 */
export function exportScopeName(
  session: Session,
  windowIndex?: number,
  groupIndex?: number,
): string {
  if (windowIndex === undefined || session.windows[windowIndex] === undefined) {
    return session.name;
  }
  if (groupIndex === undefined) {
    return `${session.name} — Window ${windowIndex + 1}`;
  }
  const group = session.windows[windowIndex].groups[groupIndex];
  if (group === undefined) {
    return `${session.name} — Window ${windowIndex + 1}`;
  }
  return `${session.name} — ${group.title === '' ? 'Untitled group' : group.title}`;
}

export function exportedNotice(name: string, format: ExportFormat): string {
  return `Exported “${name}” as ${formatName(format)}.`;
}

export function copiedLinksNotice(count: number): string {
  return `Copied ${pluralize(count, 'link')}.`;
}

export function copiedMarkdownNotice(count: number): string {
  return `Copied ${pluralize(count, 'link')} as Markdown.`;
}

/** Nothing was in scope — an empty group, or a window whose tabs were all removed. */
export const NOTHING_TO_EXPORT = 'Nothing to export — this selection has no tabs.';

// ---------------------------------------------------------------------------
// Export all (JSON backup)
// ---------------------------------------------------------------------------

export interface CollectProgress {
  loaded: number;
  total: number;
}

export interface CollectedBodies {
  /** The bodies that could be read, in the order their summaries were given. */
  sessions: Session[];
  /** Ids whose body is gone or unreadable (deleted mid-pass, or a newer schema version). */
  skipped: SessionId[];
}

/** Above this many sessions the collection is slow enough to be worth announcing. */
export const PROGRESS_NOTICE_THRESHOLD = 20;

export function shouldReportProgress(total: number): boolean {
  return total > PROGRESS_NOTICE_THRESHOLD;
}

export function collectProgressNotice(progress: CollectProgress): string {
  return `Collecting sessions… ${progress.loaded} of ${progress.total}.`;
}

/** A notice per body would re-render the whole dashboard for every read; tick in batches. */
export const PROGRESS_TICK_SIZE = 10;

export function shouldTickProgress(progress: CollectProgress): boolean {
  return progress.loaded % PROGRESS_TICK_SIZE === 0 || progress.loaded === progress.total;
}

export function exportAllNotice(exported: number, skipped: number): string {
  const sentence = `Exported ${pluralize(exported, 'session')} as JSON.`;
  return skipped === 0
    ? sentence
    : `${sentence} ${pluralize(skipped, 'session')} could not be read.`;
}

export const NOTHING_TO_EXPORT_ALL = 'Nothing to export — there are no saved sessions yet.';

/**
 * Reads every body in `summaries` through `sessionRepo.get()` — saved sessions and history
 * snapshots alike — so the header's "Export all" can put them in one `ExportBundle`.
 *
 * Sequential on purpose: a backup of hundreds of sessions is read one body at a time so the page
 * never holds a burst of parallel reads, and `onProgress` can drive an honest counter. A body
 * that has vanished or cannot be migrated costs itself only: it is listed in `skipped` and the
 * backup still contains everything else.
 */
export async function collectSessionBodies(
  summaries: readonly SessionSummary[],
  onProgress?: (progress: CollectProgress) => void,
): Promise<CollectedBodies> {
  const sessions: Session[] = [];
  const skipped: SessionId[] = [];
  const total = summaries.length;
  let loaded = 0;
  for (const summary of summaries) {
    try {
      const session = await sessionRepo.get(summary.id);
      if (session === undefined) {
        skipped.push(summary.id);
      } else {
        sessions.push(session);
      }
    } catch (err) {
      console.warn('[tab-organizer:sessions] export skipped', summary.id, errorMessage(err));
      skipped.push(summary.id);
    }
    loaded += 1;
    onProgress?.({ loaded, total });
  }
  return { sessions, skipped };
}
