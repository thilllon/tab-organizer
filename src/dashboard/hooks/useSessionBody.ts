import { useEffect, useRef, useState } from 'react';
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
  // Generation counter: guards sessionRepo.get() *results* that settle out of order — e.g. the
  // initial load racing a chrome.storage.onChanged-triggered reload (sessionRepo.rename() writes
  // the body key too, so a rename while the card is expanded fires the listener). Whichever
  // load() call started last wins; a stale one is dropped instead of overwriting a fresher
  // result. Same pattern as useSessionIndex's genRef.
  const genRef = useRef(0);

  useEffect(() => {
    if (id === null) {
      setState({ loading: false });
      return;
    }
    // Separate from genRef above: this guards the id-change/unmount case specifically. genRef
    // alone can't do that job too — bumping it on cleanup already invalidates any load() still in
    // flight for this effect instance, but `disposed` also short-circuits state updates before
    // load() even calls sessionRepo.get(), so a load kicked off right as this effect is torn down
    // doesn't touch state at all.
    let disposed = false;

    const load = async () => {
      const gen = ++genRef.current;
      setState((previous) => ({ ...previous, loading: true }));
      try {
        const session = await sessionRepo.get(id);
        if (disposed || gen !== genRef.current) {
          return;
        }
        if (session === undefined) {
          setState({ loading: false, error: 'This session no longer exists.' });
        } else {
          setState({ loading: false, session });
        }
      } catch (err) {
        if (disposed || gen !== genRef.current) {
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
      genRef.current += 1;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [id]);

  return state;
}
