import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/dashboard/lib/errors';
import {
  type OpenWindowView,
  snapshotOpenWindows,
  subscribeOpenWindows,
} from '@/dashboard/lib/open-windows';

export interface OpenWindowsState {
  windows: OpenWindowView[];
  /** The window this dashboard tab lives in, so the pane can mark it. */
  currentWindowId?: number;
  loading: boolean;
  error?: string;
  refresh(): Promise<void>;
}

/**
 * Live view of the open windows (spec §12 Phase 2). The tab/window/group listeners are registered
 * **in this page** — never in the service worker (AGENTS.md) — so they die with the dashboard tab
 * and the worker stays idle while the pane updates.
 */
export function useOpenWindows(): OpenWindowsState {
  const [windows, setWindows] = useState<OpenWindowView[]>([]);
  const [currentWindowId, setCurrentWindowId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  // Generation counter: guards snapshotOpenWindows() *results* that settle out of order — a burst
  // of tab events can start several refreshes, and whichever started last must win. Same pattern
  // (and same reasoning) as useSessionIndex's genRef.
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const list = await snapshotOpenWindows({ excludeUrlPrefix: chrome.runtime.getURL('') });
      if (gen !== genRef.current) {
        return;
      }
      setWindows(list);
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
    // Separate from genRef: this guards *starting* the initial load's follow-up state writes at
    // all. A refresh() triggered by a tab event while windows.getCurrent() is still pending
    // legitimately bumps genRef, so a mount-generation comparison against it would misfire even
    // though the component is still mounted. `disposed` is local to this effect instance and is
    // only ever set by its own cleanup — see useSessionIndex for the same split.
    let disposed = false;

    const unsubscribe = subscribeOpenWindows(() => {
      void refresh();
    });

    void (async () => {
      try {
        const current = await chrome.windows.getCurrent();
        if (!disposed && current.id !== undefined) {
          setCurrentWindowId(current.id);
        }
      } catch (err) {
        console.warn('[tab-organizer:sessions] windows.getCurrent failed', errorMessage(err));
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
      unsubscribe();
    };
  }, [refresh]);

  return { windows, currentWindowId, loading, error, refresh };
}
