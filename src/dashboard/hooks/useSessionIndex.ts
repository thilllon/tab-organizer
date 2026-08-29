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
  // Generation counter: guards listSummaries() calls that settle out of order (e.g. a rapid
  // storage.onChanged burst racing the initial load) and discards a refresh() still in flight
  // when the hook unmounts (the cleanup below bumps it past any gen already captured).
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
      await refresh();
    })();

    return () => {
      // Invalidate any refresh() still in flight for this instance.
      genRef.current += 1;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
