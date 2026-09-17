import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpenWindowsState } from '@/dashboard/hooks/useOpenWindows';
import { errorMessage } from '@/dashboard/lib/errors';
import { SearchCorpusCache, scheduleIdle, selectPrewarmIds } from '@/dashboard/lib/search-corpus';
import { entriesFromOpenWindows, type SearchEntry } from '@/sessions/search';
import type { SessionId, SessionSummary } from '@/types';

export interface UseSearchCorpusOptions {
  /** The session index (`useSessionIndex`), newest first: what to pre-warm and what to keep. */
  summaries: readonly SessionSummary[];
  /**
   * The live pane's state (`useOpenWindows`). Its snapshot is the corpus's refresh signal: the
   * tab/window/group listeners it already registered in this page are what make the open tabs
   * update, so search never needs a second set of listeners.
   */
  openWindows: Pick<OpenWindowsState, 'windows' | 'loading'>;
}

export interface SearchCorpusState {
  /** Open tabs first, then the cached saved / history entries in index order. */
  corpus: SearchEntry[];
  /** True while the idle pre-warm is still reading bodies — the result counts are not final. */
  warming: boolean;
  /** Loads the bodies a query needs that the pre-warm did not reach (spec §7: lazy on first use). */
  ensureLoaded(ids: readonly SessionId[]): Promise<void>;
}

/**
 * Assembles the corpus the dashboard's unified search runs over (spec §7 / §12 Phase 4):
 * `entriesFromOpenWindows()` over the live tabs plus one cached `SearchEntry[]` per session body.
 * Everything expensive happens here — a keystroke only re-runs `search()` over `corpus`.
 *
 * Bodies are read through `SearchCorpusCache` (i.e. `sessionRepo`), pre-warmed on idle within a
 * byte budget, invalidated per `session:<id>` key by `chrome.storage.onChanged` and dropped when
 * the session leaves the index.
 */
export function useSearchCorpus({
  summaries,
  openWindows,
}: UseSearchCorpusOptions): SearchCorpusState {
  const [cache] = useState(() => new SearchCorpusCache());
  const [openEntries, setOpenEntries] = useState<SearchEntry[]>([]);
  const [bodyEntries, setBodyEntries] = useState<SearchEntry[]>([]);
  const [warming, setWarming] = useState(false);
  // The ids the corpus is assembled from, kept in a ref so the cache's storage listener can
  // rebuild the entry list without being re-registered on every index change.
  const idsRef = useRef<SessionId[]>([]);
  // Guards state writes from callbacks that resolve after this hook is gone. Same split as the
  // other dashboard hooks: `disposed` is about this instance's lifetime, not about ordering.
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  // What the last `setBodyEntries` was built from. Re-assembling the list is only worth a render
  // when the cache actually changed or the index did — a query that needed no new body must not
  // hand the dashboard a new corpus array and make `search()` run twice.
  const syncedRef = useRef<{ mutations: number; ids: SessionId[] }>({ mutations: -1, ids: [] });

  const syncEntries = useCallback(() => {
    if (disposedRef.current) {
      return;
    }
    const { mutations, ids } = syncedRef.current;
    if (mutations === cache.mutations && ids === idsRef.current) {
      return;
    }
    syncedRef.current = { mutations: cache.mutations, ids: idsRef.current };
    setBodyEntries(cache.entriesFor(idsRef.current));
  }, [cache]);

  const ensureLoaded = useCallback<SearchCorpusState['ensureLoaded']>(
    async (ids) => {
      await cache.ensureLoaded(ids);
      syncEntries();
    },
    [cache, syncEntries],
  );

  // Index changes: forget sessions that are gone, then pre-warm the newest bodies on idle. Only
  // the ids that are not cached yet are read, so a later index change is cheap.
  useEffect(() => {
    const ids = summaries.map((summary) => summary.id);
    idsRef.current = ids;
    cache.retain(ids);
    syncEntries();

    const pending = selectPrewarmIds(summaries).filter((id) => !cache.isLoaded(id));
    if (pending.length === 0) {
      setWarming(false);
      return;
    }
    setWarming(true);
    let disposed = false;
    const cancel = scheduleIdle(() => {
      void (async () => {
        await cache.ensureLoaded(pending);
        if (disposed) {
          return;
        }
        syncEntries();
        setWarming(false);
      })();
    });

    return () => {
      disposed = true;
      cancel();
    };
  }, [cache, summaries, syncEntries]);

  // A body written anywhere (rename, tab removed, import, delete) drops that session's entries;
  // reload it straight away so the corpus stays complete between queries.
  useEffect(
    () =>
      cache.subscribe((ids) => {
        syncEntries();
        void ensureLoaded(ids);
      }),
    [cache, ensureLoaded, syncEntries],
  );

  // Open tabs. The pane's snapshot only says *that* the live tabs changed; the entries are built
  // from a fresh populated read, because `SearchEntry` needs what `OpenWindowView` drops (the
  // pending url of a navigating tab, the group titles, the tab ids results are focused by).
  useEffect(() => {
    if (openWindows.loading) {
      return;
    }
    if (openWindows.windows.length === 0) {
      setOpenEntries([]);
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const [windows, groups] = await Promise.all([
          chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
          chrome.tabGroups.query({}),
        ]);
        if (disposed) {
          return;
        }
        setOpenEntries(
          entriesFromOpenWindows(windows, groups, {
            // Our own pages (this dashboard, the options page) are never search results.
            excludeUrlPrefix: chrome.runtime.getURL(''),
          }),
        );
      } catch (err) {
        console.warn('[tab-organizer:sessions] search corpus open tabs failed', errorMessage(err));
      }
    })();

    return () => {
      disposed = true;
    };
  }, [openWindows.loading, openWindows.windows]);

  const corpus = useMemo(() => [...openEntries, ...bodyEntries], [openEntries, bodyEntries]);

  return { corpus, warming, ensureLoaded };
}
