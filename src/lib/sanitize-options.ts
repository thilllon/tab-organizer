import { loadSuspendedPrefix } from '@/lib/session-capture';
import type { SanitizeOptions } from '@/lib/session-restore';

/**
 * Builds the SanitizeOptions for a restore run in this page. The suspender default and the
 * `tabSuspenderExtensionId` lookup are shared with capture (`src/lib/session-capture.ts`).
 */
export async function loadSanitizeOptions(): Promise<SanitizeOptions> {
  const [suspendedPrefix, fileAccessAllowed] = await Promise.all([
    loadSuspendedPrefix(),
    chrome.extension.isAllowedFileSchemeAccess(),
  ]);
  return { ownExtensionId: chrome.runtime.id, fileAccessAllowed, suspendedPrefix };
}
