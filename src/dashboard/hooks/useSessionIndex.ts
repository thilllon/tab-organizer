import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/dashboard/lib/errors';
import { INDEX_KEY, sessionRepo } from '@/sessions/storage';
import type { SessionSummary } from '@/types';

export function isIndexChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): boolean {
  return area === 'local' && Object.hasOwn(changes, INDEX_KEY);
}

export interface SessionIndexState {
  sessions: SessionSummary[];
  loading: boolean;
  error?: string;
  refresh(): Promise<void>;
}

export function useSessionIndex(): SessionIndexState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  // Generation counter: guards listSummaries() *results* that settle out of order (e.g. a rapid
  // storage.onChanged burst racing the initial load) — whichever refresh() call started last
  // wins, and a stale one is dropped instead of overwriting a fresher result.
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const list = await sessionRepo.listSummaries();
      if (gen !== genRef.current) {
        return;
      }
      setSessions(list);
      setError(undefined);
    } catch (err) {
      if (gen !== genRef.current) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (gen === genRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Separate from genRef above: this guards *starting* the post-reconcile refresh() call at
    // all. genRef alone can't do that job too — a refresh() triggered by storage.onChanged while
    // reconcile() is still pending legitimately bumps genRef, which would make a mount-generation
    // comparison against genRef misfire even though the component is still mounted. `disposed` is
    // local to this effect instance and is only ever set by this effect's own cleanup, so it
    // unambiguously means "this hook unmounted since the reconcile() call below was started."
    let disposed = false;

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (isIndexChange(changes, area)) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(listener);

    void (async () => {
      try {
        // Spec §4: reconcile orphan bodies / dangling index entries on dashboard mount.
        await sessionRepo.reconcile();
      } catch (err) {
        console.warn('[tab-organizer:sessions] reconcile failed', errorMessage(err));
      }
      if (disposed) {
        return;
      }
      await refresh();
    })();

    return () => {
      disposed = true;
      // Invalidate any refresh() still in flight for this instance (see genRef's comment above).
      genRef.current += 1;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
