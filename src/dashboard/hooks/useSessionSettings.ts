import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/dashboard/lib/errors';
import { isSettingsChange } from '@/dashboard/lib/settings-change';
import { sessionRepo } from '@/sessions/storage';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from '@/types';

export interface SessionSettingsState {
  /** The stored settings; `DEFAULT_SESSION_SETTINGS` until the first read resolves. */
  settings: SessionSettings;
  loading: boolean;
  error?: string;
  /** Writes a partial update through `sessionRepo.setSettings()` (which normalises it). */
  update(patch: Partial<SessionSettings>): Promise<void>;
}

/**
 * `sessionSettings` for an extension page (spec §12 Phase 3). Both the dashboard's settings row
 * and the Options "Sessions" card use this; either can be open while the other writes, so the
 * hook re-reads on every `chrome.storage.onChanged` for the settings key. The service worker
 * watches the same key and re-arms the history alarm itself — this hook must never touch
 * `chrome.alarms`, and never writes storage except through `sessionRepo`.
 */
export function useSessionSettings(): SessionSettingsState {
  const [settings, setSettings] = useState<SessionSettings>(DEFAULT_SESSION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  // Generation counter: guards getSettings() *results* that settle out of order — an update()
  // and the storage.onChanged it triggers start two reads, and whichever started last must win.
  // Same pattern (and same reasoning) as useSessionIndex's genRef.
  const genRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const stored = await sessionRepo.getSettings();
      if (gen !== genRef.current) {
        return;
      }
      setSettings(stored);
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
      if (isSettingsChange(changes, area)) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    void refresh();

    return () => {
      // Invalidate any refresh() still in flight for this instance (see genRef's comment above).
      genRef.current += 1;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  const update = useCallback<SessionSettingsState['update']>(
    async (patch) => {
      try {
        await sessionRepo.setSettings(patch);
      } catch (err) {
        setError(errorMessage(err));
        return;
      }
      // Re-read rather than merging the patch locally: setSettings() normalises what it stores
      // (an out-of-range interval falls back to the default), so the controls must show what was
      // actually written. storage.onChanged fires for this write too; genRef settles the race.
      await refresh();
    },
    [refresh],
  );

  return { settings, loading, error, update };
}
