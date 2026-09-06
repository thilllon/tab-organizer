import { SETTINGS_KEY } from '@/sessions/storage';

/**
 * Does this `chrome.storage.onChanged` event touch `sessionSettings`? Mirrors `isIndexChange`
 * (src/dashboard/hooks/useSessionIndex.ts) for the settings key: session settings are device-local
 * and live in `chrome.storage.local` only, so a `sync` change of the same name is never ours.
 */
export function isSettingsChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): boolean {
  return area === 'local' && Object.hasOwn(changes, SETTINGS_KEY);
}
