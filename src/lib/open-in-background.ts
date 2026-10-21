import { reportError } from '@/lib/error-message';
import { t } from '@/lib/i18n';
import { loadSanitizeOptions } from '@/lib/sanitize-options';
import { sanitizeRestoreUrl } from '@/lib/session-restore';

type OpenTabResult = { ok: true } | { ok: false; reason: string };

/**
 * Opens one saved tab in a background tab, through the same sanitiser a restore uses:
 * a snapshot url is whatever the page had at capture time (`data:`, `javascript:`, `blob:`, a
 * foreign extension page), so it must never reach `chrome.tabs.create` unchecked. Never throws -
 * a refused url and a rejected `tabs.create` both come back as `{ ok: false, reason }` for the
 * caller to show inline.
 */
export async function openTabInBackground(url: string): Promise<OpenTabResult> {
  try {
    const options = await loadSanitizeOptions();
    const safe = sanitizeRestoreUrl(url, options);
    if (safe === null) {
      return { ok: false, reason: t('openUnsupportedUrl') };
    }
    await chrome.tabs.create({ url: safe, active: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reportError('open tab', err) };
  }
}
