import { Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SidebarNav } from '@/app/components/SidebarNav';
import { SidebarResizer } from '@/app/components/SidebarResizer';
import { formatRoute, HOME, parseRoute, type Route, routeSessionId } from '@/app/lib/route';
import { readSidebarWidth, writeSidebarWidth } from '@/app/lib/sidebar-width';
import { OpenTabsView } from '@/app/views/OpenTabsView';
import { type OpenScope, SessionDetail } from '@/app/views/SessionDetail';
import { SettingsView } from '@/app/views/SettingsView';
import { SnapshotDetail } from '@/app/views/SnapshotDetail';
import { Button } from '@/components/ui/button';
import { ImportDialog } from '@/dashboard/components/ImportDialog';
import { ProgressToast } from '@/dashboard/components/ProgressToast';
import { QuotaNotice } from '@/dashboard/components/QuotaNotice';
import {
  type PendingRestore,
  RestoreConfirmDialog,
} from '@/dashboard/components/RestoreConfirmDialog';
import { SearchBar } from '@/dashboard/components/SearchBar';
import { SearchResults } from '@/dashboard/components/SearchResults';
import { UnreadableSessionRow } from '@/dashboard/components/UnreadableSessionRow';
import { useOpenWindows } from '@/dashboard/hooks/useOpenWindows';
import { useRestore } from '@/dashboard/hooks/useRestore';
import { useSearchCorpus } from '@/dashboard/hooks/useSearchCorpus';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';
import { downloadExport } from '@/dashboard/lib/download';
import { errorMessage } from '@/dashboard/lib/errors';
import {
  type CollectProgress,
  collectProgressNotice,
  collectSessionBodies,
  exportAllNotice,
  NOTHING_TO_EXPORT_ALL,
  shouldReportProgress,
  shouldTickProgress,
} from '@/dashboard/lib/export-actions';
import { importedNotice } from '@/dashboard/lib/import-preview';
import { openTabInBackground } from '@/dashboard/lib/open-tab';
import { isQuotaError } from '@/dashboard/lib/quota';
import { needsRestoreConfirm } from '@/dashboard/lib/restore-summary';
import {
  buildSearchGroups,
  flattenSearchItems,
  NO_HIGHLIGHT,
  nextIndex,
  prevIndex,
  resolveActivation,
  type SearchItem,
  sessionNameMatches,
} from '@/dashboard/lib/search-nav';
import { pickWindow, recoveredSnapshot, splitByKind } from '@/dashboard/lib/session-utils';
import { currentWindowTarget, goToTab } from '@/dashboard/lib/window-actions';
import { type CaptureScope, captureSession } from '@/sessions/capture';
import { toJson } from '@/sessions/export';
import { ensureUniqueName } from '@/sessions/naming';
import type { RestoreTarget } from '@/sessions/restore';
import { DEFAULT_LIMIT_PER_SOURCE, search } from '@/sessions/search';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings } from '@/types';

const NEW_WINDOWS: RestoreTarget = { kind: 'newWindows' };

const NOTHING_TO_SAVE = {
  window: 'Nothing to save — this window only holds Tab Organizer.',
  all: 'Nothing to save — no open window holds anything besides Tab Organizer.',
} as const;

function nothingToSave(scope: CaptureScope): string {
  return scope === 'all' ? NOTHING_TO_SAVE.all : NOTHING_TO_SAVE.window;
}

/** The hash route, kept in step with the address bar and the Back button. */
function useRoute(): [Route, (route: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const hash = formatRoute(next);
    if (replace) {
      // Typing in the search box must not stack one history entry per keystroke.
      window.history.replaceState(null, '', hash);
      setRoute(next);
      return;
    }
    if (window.location.hash === hash) {
      setRoute(next);
      return;
    }
    window.location.hash = hash;
  }, []);

  return [route, navigate];
}

/**
 * Tab Organizer's one page: the sidebar lists what you have, the main pane shows what you picked,
 * and Settings is a view in here rather than a second page (Chrome's "Options" opens
 * `app.html#settings`). Everything below is wiring — the session logic lives in `src/sessions/`
 * and the reusable pieces in `src/dashboard/`.
 */
export function App() {
  const [route, navigate] = useRoute();
  // Dragged by the handle between the columns, kept in localStorage (see sidebar-width.ts).
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const { sessions, loading, error: indexError } = useSessionIndex();
  const openWindows = useOpenWindows();
  const sessionSettings = useSessionSettings();
  const { restore, progress, running, cancel, cancelling, lastResult, cancelled, dismiss } =
    useRestore();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // A write that failed on the storage quota: one fixed sentence plus a way to the meter, rather
  // than Chrome's "Resource::kQuotaBytes quota exceeded" in the error banner (spec §4).
  const [quotaFull, setQuotaFull] = useState(false);
  const [pending, setPending] = useState<PendingRestore | undefined>(undefined);

  // Search (spec §7). `query` is the debounced value SearchBar commits; the typed text never
  // reaches this component, so a keystroke re-renders nothing but the box itself. `searchEpoch`
  // remounts (and so clears) the box when a sidebar click leaves the search view.
  const query = route.view === 'search' ? route.query : '';
  const searching = query !== '';
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [limitPerSource, setLimitPerSource] = useState(DEFAULT_LIMIT_PER_SOURCE);
  const [highlight, setHighlight] = useState(NO_HIGHLIGHT);
  const [pendingActivation, setPendingActivation] = useState<string | undefined>(undefined);
  const { corpus, warming, ensureLoaded } = useSearchCorpus({ summaries: sessions, openWindows });

  const { saved, history } = useMemo(() => splitByKind(sessions), [sessions]);
  const recovered = recoveredSnapshot(history);
  const busy = saving || running;

  const announce = (message: string) => {
    setError(undefined);
    setQuotaFull(false);
    setNotice(message);
  };

  /** Every failed *write*: a full disk becomes the quota notice, everything else a plain error. */
  const reportWriteError = (err: unknown) => {
    if (isQuotaError(err)) {
      setError(undefined);
      setQuotaFull(true);
      return;
    }
    setError(errorMessage(err));
  };

  const go = (next: Route) => {
    setNotice(undefined);
    setError(undefined);
    if (next.view !== 'search' && searching) {
      setSearchEpoch((epoch) => epoch + 1);
    }
    navigate(next);
  };

  const save = async (scope: CaptureScope) => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    setQuotaFull(false);
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
      setNotice(`Saved “${named.name}”. Rename it from its title.`);
      navigate({ view: 'saved', id: named.id });
    } catch (err) {
      reportWriteError(err);
    } finally {
      setSaving(false);
    }
  };

  /** The whole store as one `ExportBundle` (spec §8), read body by body through `sessionRepo`. */
  const exportAll = async () => {
    setError(undefined);
    setNotice(undefined);
    setExporting(true);
    try {
      const summaries = await sessionRepo.listSummaries();
      if (summaries.length === 0) {
        setNotice(NOTHING_TO_EXPORT_ALL);
        return;
      }
      const onProgress = shouldReportProgress(summaries.length)
        ? (collected: CollectProgress) => {
            if (shouldTickProgress(collected)) {
              setNotice(collectProgressNotice(collected));
            }
          }
        : undefined;
      const { sessions: bodies, skipped } = await collectSessionBodies(summaries, onProgress);
      if (bodies.length === 0) {
        setNotice(NOTHING_TO_EXPORT_ALL);
        return;
      }
      downloadExport('backup', 'json', toJson(bodies, Date.now()));
      setNotice(exportAllNotice(bodies.length, skipped.length));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
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
        setNotice('An open is already running.');
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const requestOpen = async (
    session: Session,
    scope: OpenScope,
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

  const results = useMemo(
    () => search(corpus, query, { limitPerSource, includeHistory }),
    [corpus, query, limitPerSource, includeHistory],
  );
  const sessionMatches = useMemo(
    () => (searching ? sessionNameMatches(sessions, results.tokens, { includeHistory }) : []),
    [searching, sessions, results.tokens, includeHistory],
  );
  const groups = useMemo(
    () => (searching ? buildSearchGroups(results, sessionMatches) : []),
    [searching, results, sessionMatches],
  );
  const items = useMemo(() => flattenSearchItems(groups), [groups]);

  // Tier 2 is lazy (spec §7): bodies the idle pre-warm did not reach are read on the first query
  // that needs them, and history bodies only once "Include history" is on.
  useEffect(() => {
    if (!searching) {
      return;
    }
    void ensureLoaded(
      sessions
        .filter(
          (summary) =>
            summary.unreadable === undefined && (includeHistory || summary.kind !== 'history'),
        )
        .map((summary) => summary.id),
    );
  }, [searching, includeHistory, sessions, ensureLoaded]);

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
      // A matching session name goes to that session rather than opening 90 tabs on one Enter.
      go({ view: item.summary.kind === 'history' ? 'auto' : 'saved', id: item.summary.id });
      return;
    }
    const { entry } = item;
    const result =
      entry.tabId !== undefined && entry.windowId !== undefined
        ? await goToTab(entry.tabId, entry.windowId)
        : await openTabInBackground(entry.url);
    if (!result.ok) {
      setError(result.reason);
    }
  };

  // Enter is resolved one render *after* the key press: SearchBar commits the query and requests
  // the activation in the same handler, so anything activated inside that handler would come from
  // the previous render's `items`/`highlight`. `resolveActivation` waits for the results that
  // describe the typed text.
  useEffect(() => {
    if (pendingActivation === undefined) {
      return;
    }
    const decision = resolveActivation({
      typedQuery: pendingActivation,
      committedQuery: query,
      highlight,
      itemCount: items.length,
    });
    if (decision.action === 'wait') {
      return;
    }
    setPendingActivation(undefined);
    if (decision.action === 'activate') {
      void activateItem(items[decision.index]);
    }
  });

  const selected = useMemo(() => {
    const id = routeSessionId(route);
    return id === undefined ? undefined : sessions.find((summary) => summary.id === id);
  }, [route, sessions]);

  // A session deleted in another tab (or by the snapshot ring) leaves its address pointing at
  // nothing; fall back to the list rather than showing an empty pane.
  useEffect(() => {
    if (!loading && selected === undefined && (route.view === 'saved' || route.view === 'auto')) {
      navigate(HOME, true);
    }
  }, [loading, selected, route, navigate]);

  const main = () => {
    if (searching) {
      const found = results.total + sessionMatches.length;
      return (
        <>
          {found === 0 && !includeHistory && (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing in your open tabs or saved sessions.
              <Button
                variant="outline"
                size="sm"
                className="ml-3"
                onClick={() => {
                  setIncludeHistory(true);
                  resetResults();
                }}
              >
                Also search auto-saved
              </Button>
            </div>
          )}
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
        </>
      );
    }
    if (route.view === 'settings') {
      return (
        <SettingsView
          summaries={sessions}
          onNotice={announce}
          onExportAll={() => void exportAll()}
          onImport={() => setImportOpen(true)}
          exporting={exporting}
        />
      );
    }
    if (selected !== undefined && selected.unreadable !== undefined) {
      return (
        <ul className="space-y-2">
          <UnreadableSessionRow
            summary={selected}
            unreadable={selected.unreadable}
            onDeleted={() => navigate(HOME, true)}
          />
        </ul>
      );
    }
    if (route.view === 'saved' && selected !== undefined) {
      return (
        <SessionDetail
          key={selected.id}
          summary={selected}
          restoring={running}
          onOpen={(session, scope) => requestOpen(session, scope)}
          onOpenWindow={(session, windowIndex, scope) => requestOpen(session, scope, windowIndex)}
          onNotice={announce}
          onDeleted={() => navigate(HOME, true)}
        />
      );
    }
    if (route.view === 'auto' && selected !== undefined) {
      return (
        <SnapshotDetail
          key={selected.id}
          summary={selected}
          restoring={running}
          keepLast={sessionSettings.settings.historyMaxSnapshots}
          onOpen={(session) => requestOpen(session, 'newWindows')}
          onNotice={announce}
          onKept={(savedId) => navigate({ view: 'saved', id: savedId }, true)}
          onDeleted={() => navigate(HOME, true)}
        />
      );
    }
    return (
      <OpenTabsView
        openWindows={openWindows}
        busy={busy}
        savedCount={saved.length}
        onSaveAll={() => void save('all')}
        onSaveWindow={(windowId) => void save({ windowId })}
        onOpenSettings={() => go({ view: 'settings' })}
      />
    );
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
        <button
          type="button"
          onClick={() => go(HOME)}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <img src="/img/logo-32.png" alt="" aria-hidden="true" className="size-5 rounded" />
          Tab Organizer
        </button>
        <div className="mx-auto flex max-w-xl flex-1 justify-center">
          <SearchBar
            key={searchEpoch}
            includeHistory={includeHistory}
            showIncludeHistory={false}
            onQueryChange={(next) => {
              if (next === query) {
                return;
              }
              resetResults();
              navigate(next === '' ? HOME : { view: 'search', query: next }, true);
            }}
            onIncludeHistoryChange={(value) => {
              setIncludeHistory(value);
              resetResults();
            }}
            onMove={(direction) =>
              setHighlight((current) =>
                direction === 'next'
                  ? nextIndex(current, items.length)
                  : prevIndex(current, items.length),
              )
            }
            onActivate={setPendingActivation}
          />
        </div>
        <Button
          variant={route.view === 'settings' ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={route.view === 'settings'}
          onClick={() => go(route.view === 'settings' ? HOME : { view: 'settings' })}
        >
          <Settings />
          Settings
        </Button>
      </header>

      <div
        className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[var(--sidebar-width)_10px_minmax(0,1fr)]"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <aside className="min-w-0 lg:sticky lg:top-16 lg:self-start">
          <SidebarNav
            route={route}
            saved={saved}
            history={history}
            windowCount={openWindows.windows.length}
            tabCount={openWindows.windows.reduce((count, win) => count + win.tabs.length, 0)}
            recoveredId={recovered?.id}
            loading={loading}
            onNavigate={go}
          />
        </aside>

        <SidebarResizer
          width={sidebarWidth}
          onResize={setSidebarWidth}
          onCommit={writeSidebarWidth}
        />

        <main className="min-w-0 space-y-3">
          {notice !== undefined && (
            <p role="status" aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-sm">
              {notice}
            </p>
          )}
          {quotaFull && <QuotaNotice onShowStorage={() => go({ view: 'settings' })} />}
          {(error ?? indexError) !== undefined && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error ?? indexError}
            </p>
          )}
          {main()}
        </main>
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(count) => announce(importedNotice(count))}
      />
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
