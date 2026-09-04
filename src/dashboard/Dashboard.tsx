import { Layers, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/dashboard/components/EmptyState';
import { HistorySection } from '@/dashboard/components/HistorySection';
import { OpenWindowsPane } from '@/dashboard/components/OpenWindowsPane';
import { ProgressToast } from '@/dashboard/components/ProgressToast';
import { RecoveredBanner } from '@/dashboard/components/RecoveredBanner';
import {
  type PendingRestore,
  RestoreConfirmDialog,
} from '@/dashboard/components/RestoreConfirmDialog';
import { SearchBar } from '@/dashboard/components/SearchBar';
import { SearchResults } from '@/dashboard/components/SearchResults';
import { type RestoreScope, SessionCard } from '@/dashboard/components/SessionCard';
import { SessionSettingsRow } from '@/dashboard/components/SessionSettingsRow';
import { useOpenWindows } from '@/dashboard/hooks/useOpenWindows';
import { useRestore } from '@/dashboard/hooks/useRestore';
import { useSearchCorpus } from '@/dashboard/hooks/useSearchCorpus';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import { openTabInBackground } from '@/dashboard/lib/open-tab';
import { needsRestoreConfirm } from '@/dashboard/lib/restore-summary';
import {
  buildSearchGroups,
  flattenSearchItems,
  NO_HIGHLIGHT,
  nextIndex,
  prevIndex,
  type SearchItem,
  sessionNameMatches,
} from '@/dashboard/lib/search-nav';
import { pickWindow, shouldShowRecoveredBanner, splitByKind } from '@/dashboard/lib/session-utils';
import { RECOVERED_DISMISSED_KEY, readUiState, writeUiState } from '@/dashboard/lib/ui-state';
import { currentWindowTarget, goToTab } from '@/dashboard/lib/window-actions';
import { type CaptureScope, captureSession } from '@/sessions/capture';
import { ensureUniqueName } from '@/sessions/naming';
import type { RestoreTarget } from '@/sessions/restore';
import { DEFAULT_LIMIT_PER_SOURCE, search } from '@/sessions/search';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings, SessionSummary } from '@/types';

const NEW_WINDOWS: RestoreTarget = { kind: 'newWindows' };

const NOTHING_TO_SAVE = {
  window: 'Nothing to save — this window only contains the Sessions dashboard.',
  all: 'Nothing to save — no open window contains anything besides the Sessions dashboard.',
} as const;

function nothingToSave(scope: CaptureScope): string {
  return scope === 'all' ? NOTHING_TO_SAVE.all : NOTHING_TO_SAVE.window;
}

export function Dashboard() {
  const { sessions, loading, error: indexError } = useSessionIndex();
  const openWindows = useOpenWindows();
  const { restore, progress, running, cancel, cancelling, lastResult, cancelled, dismiss } =
    useRestore();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingRestore | undefined>(undefined);
  // Which recovered snapshot's banner was dismissed in this tab (sessionStorage, read once).
  const [dismissedRecovered, setDismissedRecovered] = useState(() =>
    readUiState(RECOVERED_DISMISSED_KEY),
  );
  // Focus target after a card deletes itself: the card (and with it the button that had focus)
  // unmounts, which would otherwise drop keyboard focus to <body>. <main> outlives both the list
  // and the empty state that replaces it once the last session is gone.
  const mainRef = useRef<HTMLElement>(null);

  // Unified search (spec §7). `query` is the debounced value SearchBar commits; the typed text
  // never reaches this component, so a keystroke re-renders nothing but the box itself.
  const [query, setQuery] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [limitPerSource, setLimitPerSource] = useState(DEFAULT_LIMIT_PER_SOURCE);
  const [highlight, setHighlight] = useState(NO_HIGHLIGHT);
  const { corpus, warming, ensureLoaded } = useSearchCorpus({ summaries: sessions, openWindows });

  const save = async (scope: CaptureScope) => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const session = await captureSession(scope);
      if (session.windows.length === 0) {
        setNotice(nothingToSave(scope));
        return;
      }
      // Two saves in the same minute would otherwise share the default name.
      const names = (await sessionRepo.listSummaries()).map((summary) => summary.name);
      const named: Session = { ...session, name: ensureUniqueName(session.name, names) };
      await sessionRepo.put(named);
      setNotice(`Saved “${named.name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runRestore = async (
    session: Session,
    target: RestoreTarget,
    lazy?: SessionSettings['restoreLazy'],
  ): Promise<void> => {
    try {
      const outcome = await restore(session, target, lazy);
      if (!outcome.ok) {
        // The header Save buttons and each SessionCard's Restore button are disabled while a
        // restore runs (via `running` / the `restoring` prop); this catches the click that lands
        // before that re-render, straight from the hook rather than from state timing.
        setNotice('A restore is already running.');
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // `windowIndex`, when given, scopes the restore to a single window of `session`. `pickWindow`
  // and `currentWindowTarget` run in here (inside the try) rather than in the JSX callback, so a
  // bad index (RangeError) or a window that cannot be identified lands in the error banner
  // instead of escaping into the click handler.
  const requestRestore = async (
    session: Session,
    scope: RestoreScope,
    windowIndex?: number,
  ): Promise<void> => {
    setError(undefined);
    setNotice(undefined);
    try {
      const target = scope === 'here' ? await currentWindowTarget() : NEW_WINDOWS;
      const scoped = windowIndex === undefined ? session : pickWindow(session, windowIndex);
      if (needsRestoreConfirm(scoped)) {
        const settings = await sessionRepo.getSettings();
        setPending({ session: scoped, target, restoreLazy: settings.restoreLazy });
        return;
      }
      await runRestore(scoped, target);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmRestore = (lazy: SessionSettings['restoreLazy']) => {
    if (pending === undefined) {
      return;
    }
    const { session, target } = pending;
    setPending(undefined);
    void runRestore(session, target, lazy);
  };

  /** Restores a row that only has its index entry (the History rows, the recovered banner). */
  const restoreSummary = async (summary: SessionSummary): Promise<void> => {
    setError(undefined);
    try {
      const session = await sessionRepo.get(summary.id);
      if (session === undefined) {
        setError('This snapshot no longer exists.');
        return;
      }
      await requestRestore(session, 'newWindows');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const dismissRecovered = (summary: SessionSummary) => {
    writeUiState(RECOVERED_DISMISSED_KEY, summary.id);
    setDismissedRecovered(summary.id);
  };

  const focusList = () => {
    mainRef.current?.focus({ preventScroll: true });
  };

  const busy = saving || running;
  // History snapshots share the index with saved sessions: the saved list must filter, and the
  // History section gets the rest (both newest first — see splitByKind).
  const { saved, history } = useMemo(() => splitByKind(sessions), [sessions]);
  const recovered = shouldShowRecoveredBanner(history, dismissedRecovered);
  const searching = query !== '';

  // The only part of search that re-runs per query: the corpus is rebuilt by useSearchCorpus,
  // and only when the live tabs or the stored bodies actually change.
  const results = useMemo(
    () => search(corpus, query, { limitPerSource, includeHistory }),
    [corpus, query, limitPerSource, includeHistory],
  );
  // Tier 1 (spec §7): session names, answered from the index without reading a single body.
  const sessionMatches = useMemo(
    () => (searching ? sessionNameMatches(sessions, results.tokens, { includeHistory }) : []),
    [searching, sessions, results.tokens, includeHistory],
  );
  const groups = useMemo(
    () => (searching ? buildSearchGroups(results, sessionMatches) : []),
    [searching, results, sessionMatches],
  );
  // The flat, ordered row list the arrow keys walk and Enter activates.
  const items = useMemo(() => flattenSearchItems(groups), [groups]);

  // Tier 2 is lazy (spec §7): bodies the idle pre-warm did not reach are read on the first query
  // that needs them, and history bodies only once "Include history" is on.
  useEffect(() => {
    if (!searching) {
      return;
    }
    void ensureLoaded(
      sessions
        .filter((summary) => includeHistory || summary.kind !== 'history')
        .map((summary) => summary.id),
    );
  }, [searching, includeHistory, sessions, ensureLoaded]);

  /** A new query re-ranks everything: back to no highlight and to the default per-source cap. */
  const resetResults = () => {
    setHighlight(NO_HIGHLIGHT);
    setLimitPerSource(DEFAULT_LIMIT_PER_SOURCE);
  };

  const activateItem = async (item: SearchItem | undefined): Promise<void> => {
    if (item === undefined) {
      return;
    }
    setError(undefined);
    if (item.kind === 'session') {
      // Tier-1 rows restore the whole session, through the same useRestore path as every other
      // restore in the dashboard (confirm dialog, progress toast, cancel).
      await restoreSummary(item.summary);
      return;
    }
    const { entry } = item;
    // An open tab is focused where it is; a saved or snapshotted one opens in a background tab
    // (sanitised in open-tab.ts — a stored url is whatever the page had at capture time).
    const result =
      entry.tabId !== undefined && entry.windowId !== undefined
        ? await goToTab(entry.tabId, entry.windowId)
        : await openTabInBackground(entry.url);
    if (!result.ok) {
      setError(result.reason);
    }
  };

  const moveHighlight = (direction: 'next' | 'prev') => {
    setHighlight((current) =>
      direction === 'next' ? nextIndex(current, items.length) : prevIndex(current, items.length),
    );
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-wide text-primary uppercase">Sessions</h1>
        <SearchBar
          includeHistory={includeHistory}
          onQueryChange={(next) => {
            setQuery(next);
            resetResults();
          }}
          onIncludeHistoryChange={(value) => {
            setIncludeHistory(value);
            resetResults();
          }}
          onMove={moveHighlight}
          onActivate={() => void activateItem(items[highlight] ?? items[0])}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void save('window')} disabled={busy}>
            <Save />
            Save this window
          </Button>
          <Button size="sm" onClick={() => void save('all')} disabled={busy}>
            <Layers />
            Save all windows
          </Button>
        </div>
      </header>

      <Separator className="my-4" />

      {recovered !== undefined && (
        <RecoveredBanner
          summary={recovered}
          restoring={running}
          onRestore={(summary) => void restoreSummary(summary)}
          onDismiss={dismissRecovered}
        />
      )}

      <SessionSettingsRow />

      {notice !== undefined && (
        <p role="status" aria-live="polite" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {(error ?? indexError) !== undefined && (
        <p
          role="alert"
          className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error ?? indexError}
        </p>
      )}

      {searching ? (
        <SearchResults
          groups={groups}
          query={query}
          tokens={results.tokens}
          total={results.total + sessionMatches.length}
          highlight={highlight}
          warming={warming}
          onHighlight={setHighlight}
          onActivate={(index) => void activateItem(items[index])}
          onShowMore={() => setLimitPerSource((current) => current + DEFAULT_LIMIT_PER_SOURCE)}
        />
      ) : (
        /* One column below `lg`, then open windows on the left at a third of the width. */
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <OpenWindowsPane
            windows={openWindows.windows}
            currentWindowId={openWindows.currentWindowId}
            loading={openWindows.loading}
            error={openWindows.error}
            onSaveWindow={(windowId) => void save({ windowId })}
            busy={busy}
          />

          {/* tabIndex -1: programmatic focus target only (see mainRef); never in the tab order. */}
          <main ref={mainRef} tabIndex={-1} className="min-w-0 outline-none">
            <h2 className="mb-3 text-sm font-semibold">Saved sessions</h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : saved.length === 0 ? (
              <EmptyState
                onSaveWindow={() => void save('window')}
                onSaveAll={() => void save('all')}
                saving={saving}
                running={running}
              />
            ) : (
              <ul className="space-y-3">
                {saved.map((summary) => (
                  <SessionCard
                    key={summary.id}
                    summary={summary}
                    restoring={running}
                    onRestore={(session, scope) => requestRestore(session, scope)}
                    onRestoreWindow={(session, windowIndex, scope) =>
                      requestRestore(session, scope, windowIndex)
                    }
                    onDeleted={focusList}
                  />
                ))}
              </ul>
            )}

            <HistorySection
              summaries={history}
              restoring={running}
              onRestore={(session) => requestRestore(session, 'newWindows')}
              onNotice={(message) => {
                setError(undefined);
                setNotice(message);
              }}
            />
          </main>
        </div>
      )}

      <RestoreConfirmDialog
        pending={pending}
        onConfirm={confirmRestore}
        onCancel={() => setPending(undefined)}
      />
      <ProgressToast
        progress={progress}
        result={lastResult}
        cancelling={cancelling}
        cancelled={cancelled}
        onCancel={cancel}
        onDismiss={dismiss}
      />
    </div>
  );
}
