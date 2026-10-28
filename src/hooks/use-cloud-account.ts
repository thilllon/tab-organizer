import { useCallback, useEffect, useState } from 'react';

import { me } from '@/lib/cloud-api';
import {
  type AccountState,
  accountState,
  CLOUD_ACCOUNT_KEY,
  CLOUD_SYNC_KEY,
  loadCloudAccount,
  loadSyncKey,
  withCloudAccount,
} from '@/lib/cloud-auth';
import { isCloudSyncEnabled } from '@/lib/cloud-config';
import { reportError } from '@/lib/error-message';
import type { CloudAccount, CloudKeySetup } from '@/types';

export interface CloudAccountView {
  /** `'unknown'` while the stored account is read or the server is asked about the passphrase. */
  state: AccountState | 'unknown';
  account: CloudAccount | null;
  /** The server's passphrase setup, once known (needed to unlock). */
  keySetup: CloudKeySetup | null | undefined;
  /** Why the server could not be asked, in the UI language; cleared by `refresh()`. */
  error: string | undefined;
  /** Reads everything again (after sign-in, a passphrase, sign-out, or a failure). */
  refresh(): void;
  /** Records the setup the server just answered with, without asking it again. */
  setKeySetup(setup: CloudKeySetup | null | undefined): void;
}

/**
 * The cloud sync account as Settings shows it. Reads the stored account and key, asks the server
 * whether a passphrase exists only when this device has none, and follows `cloudAccount` /
 * `cloudSyncKey` in `chrome.storage.onChanged`, so another app tab signing out shows at once.
 * The listener lives in the page and dies with it.
 */
export function useCloudAccount(): CloudAccountView {
  const configured = isCloudSyncEnabled();
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keySetup, setKeySetup] = useState<CloudKeySetup | null | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!configured) {
      return;
    }
    let live = true;
    setError(undefined);
    void (async () => {
      try {
        const [storedAccount, key] = await Promise.all([loadCloudAccount(), loadSyncKey()]);
        if (!live) {
          return;
        }
        setAccount(storedAccount);
        setHasKey(key !== null);
        setLoaded(true);
        if (storedAccount === null) {
          // Whatever the server said about the passphrase belonged to the account now gone.
          setKeySetup(undefined);
          return;
        }
        if (key !== null) {
          return;
        }
        const answer = await withCloudAccount((current) => me(current.token));
        if (live) {
          setKeySetup(answer.keySetup);
        }
      } catch (err: unknown) {
        if (live) {
          setLoaded(true);
          setError(reportError('cloud account not read', err));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [configured, generation]);

  useEffect(() => {
    if (!configured) {
      return;
    }
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (CLOUD_ACCOUNT_KEY in changes || CLOUD_SYNC_KEY in changes)) {
        refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [configured, refresh]);

  const state = loaded
    ? accountState({ configured, account, hasLocalKey: hasKey, keySetup, now: Date.now() })
    : configured
      ? 'unknown'
      : 'unconfigured';

  return { state, account, keySetup, error, refresh, setKeySetup };
}
