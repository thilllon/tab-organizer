import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    try {
      const summaries = await sessionRepo.listSummaries();
      setSessions(summaries);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
      } catch {
        // Reconcile failures are non-fatal; the list below still loads.
      }
      if (!disposed) {
        await refresh();
      }
    })();

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
