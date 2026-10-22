import type { SanitizeOptions } from '@/lib/session-restore';

/** Builds the SanitizeOptions for a restore run in this page. */
export async function loadSanitizeOptions(): Promise<SanitizeOptions> {
  const fileAccessAllowed = await chrome.extension.isAllowedFileSchemeAccess();
  return { ownExtensionId: chrome.runtime.id, fileAccessAllowed };
}
