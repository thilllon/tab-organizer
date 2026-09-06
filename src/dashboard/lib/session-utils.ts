import type { Session, SessionOrigin, SessionSummary, UnreadableSession } from '@/types';

/** Returns a copy of `session` that contains only `windows[windowIndex]`. */
export function pickWindow(session: Session, windowIndex: number): Session {
  const window = session.windows[windowIndex];
  if (windowIndex < 0 || window === undefined) {
    throw new RangeError(`Session ${session.id} has no window at index ${windowIndex}`);
  }
  return { ...session, windows: [window] };
}

/**
 * Splits the index into the two lists the dashboard shows separately: `kind: 'saved'` in the
 * Saved sessions list, `kind: 'history'` in the History section. History snapshots share the
 * index with saved sessions, so the saved list must filter rather than render everything.
 *
 * Order is preserved from the input — `sessionRepo.listSummaries()` returns newest first, and a
 * snapshot's `updatedAt` is not moved by protect/rename, so the History section gets newest-first
 * capture order for free.
 */
export function splitByKind(summaries: readonly SessionSummary[]): {
  saved: SessionSummary[];
  history: SessionSummary[];
} {
  const saved: SessionSummary[] = [];
  const history: SessionSummary[] = [];
  for (const summary of summaries) {
    (summary.kind === 'history' ? history : saved).push(summary);
  }
  return { saved, history };
}

/**
 * What the saved list says instead of a session this build cannot read (spec §3): the store was
 * written by a newer Tab Organizer and the fix is an update, not a repair. The row stays inert
 * (no restore / rename / export / expand) but keeps Delete, so the user is never stuck with an
 * entry they can neither open nor get rid of.
 */
export const UNREADABLE_SESSION_MESSAGE =
  'Saved by a newer version of Tab Organizer — update to open';

/** The version that wrote it, for the row's second line: "schema v2". */
export function unreadableSchemaLabel(unreadable: UnreadableSession): string {
  return `schema v${unreadable.version}`;
}

/** Badge text for a snapshot row: the alarm is the "automatic" one users recognise. */
export function historyOriginLabel(origin: SessionOrigin): string {
  return origin === 'alarm' ? 'auto' : origin;
}

/** Capture time decides which snapshot is newest (protect/rename never move `createdAt`). */
function newestFirst(a: SessionSummary, b: SessionSummary): number {
  return b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/**
 * The recovered banner (spec §12 Phase 3) announces the snapshot `promoteRecoveredSnapshot()`
 * made on the last `runtime.onStartup`. It shows only while that snapshot is the newest one
 * there is: an ordinary snapshot taken after it means the user has been browsing since the
 * restart and no longer needs telling. Dismissing stores its id (sessionStorage
 * `tab-organizer:recovered-dismissed`), which is passed back here as `dismissedId`.
 *
 * Returns the summary to announce — the banner needs its name and id — or `undefined` for "do
 * not show". Ordering of `historySummaries` does not matter.
 */
export function shouldShowRecoveredBanner(
  historySummaries: readonly SessionSummary[],
  dismissedId: string | undefined,
): SessionSummary | undefined {
  const newest = [...historySummaries].sort(newestFirst)[0];
  if (newest === undefined || newest.origin !== 'recovered' || newest.id === dismissedId) {
    return undefined;
  }
  return newest;
}
