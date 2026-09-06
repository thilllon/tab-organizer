/**
 * Per-tab UI state (`sessionStorage`): which disclosure is open, which banner was dismissed.
 * Deliberately not `chrome.storage` — none of this is user data, it must not travel between
 * devices or outlive the dashboard tab, and it must never go through `sessionRepo` (AGENTS.md:
 * every session-key write goes through the repo under the Web Lock; these keys are not session
 * keys at all).
 */

/** Open/closed state of the dashboard's History disclosure. */
export const HISTORY_OPEN_KEY = 'tab-organizer:history-open';
/** Id of the recovered snapshot whose banner was dismissed in this tab (spec §12 Phase 3). */
export const RECOVERED_DISMISSED_KEY = 'tab-organizer:recovered-dismissed';

/**
 * `sessionStorage` is absent under vitest (Node, no DOM) and its accessors throw outright when
 * the browser blocks site data, so every read/write is guarded and failures are ignored: losing a
 * disclosure's open state is not worth an error banner.
 */
export function readUiState(key: string): string | undefined {
  if (typeof sessionStorage === 'undefined') {
    return undefined;
  }
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeUiState(key: string, value: string): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignored — see readUiState
  }
}
