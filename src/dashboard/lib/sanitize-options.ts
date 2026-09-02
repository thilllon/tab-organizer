import { loadSuspendedPrefix } from '@/sessions/capture';
import type { SanitizeOptions } from '@/sessions/restore';

/**
 * Builds the SanitizeOptions for a restore run in this page. The suspender default and the
 * `tabSuspenderExtensionId` lookup are shared with capture (`src/sessions/capture.ts`).
 */
export async function loadSanitizeOptions(): Promise<SanitizeOptions> {
  const [suspendedPrefix, fileAccessAllowed] = await Promise.all([
    loadSuspendedPrefix(),
    chrome.extension.isAllowedFileSchemeAccess(),
  ]);
  return { ownExtensionId: chrome.runtime.id, fileAccessAllowed, suspendedPrefix };
}
