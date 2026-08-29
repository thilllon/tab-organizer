import { useEffect, useState } from 'react';
import { errorMessage } from '@/dashboard/lib/errors';
import { UnknownSchemaVersionError } from '@/sessions/migrate';
import { sessionKey, sessionRepo } from '@/sessions/storage';
import type { Session, SessionId } from '@/types';

export function isBodyChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
  id: SessionId,
): boolean {
  return area === 'local' && Object.hasOwn(changes, sessionKey(id));
}

export interface SessionBodyState {
  session?: Session;
  loading: boolean;
  error?: string;
}

/** Loads the full Session body for `id`; `null` means "not expanded", nothing is loaded. */
export function useSessionBody(id: SessionId | null): SessionBodyState {
  const [state, setState] = useState<SessionBodyState>({ loading: false });

  useEffect(() => {
    if (id === null) {
      setState({ loading: false });
      return;
    }
    let disposed = false;

    const load = async () => {
      setState((previous) => ({ ...previous, loading: true }));
      try {
        const session = await sessionRepo.get(id);
        if (disposed) {
          return;
        }
        if (session === undefined) {
          setState({ loading: false, error: 'This session no longer exists.' });
        } else {
          setState({ loading: false, session });
        }
      } catch (err) {
        if (disposed) {
          return;
        }
        const error =
          err instanceof UnknownSchemaVersionError
            ? 'This session was saved by a newer version of Tab Organizer and cannot be shown.'
            : errorMessage(err);
        setState({ loading: false, error });
      }
    };

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (isBodyChange(changes, area, id)) {
        void load();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    void load();

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [id]);

  return state;
}
