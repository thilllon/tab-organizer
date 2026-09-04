/**
 * Quota classification (spec §4 "Quota errors"). Every session write goes through
 * `sessionRepo` → `chrome.storage.local.set`, which rejects when the area is full. Chrome words
 * that rejection several ways depending on where it comes from:
 *
 *   - `Resource::kQuotaBytes quota exceeded`      (storage.local over the quota)
 *   - `QUOTA_BYTES quota exceeded`                (older wording, and storage.sync)
 *   - `QuotaExceededError` / `DOMException(22)`   (the underlying storage layer)
 *
 * …none of which a user can act on, so all of them are shown as one sentence with a way to the
 * storage meter. Pure and unit-tested; the wiring lives in the save / import / "Save as session"
 * paths.
 */

/** The single message every quota failure is reported with. */
export const QUOTA_NOTICE = 'Storage is full — delete old snapshots or sessions.';

/** DOMException.QUOTA_EXCEEDED_ERR — the legacy numeric code that still travels with it. */
const QUOTA_EXCEEDED_CODE = 22;

function stringField(value: object, key: string): string {
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' ? field : '';
}

function numberField(value: object, key: string): number | undefined {
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'number' ? field : undefined;
}

function mentionsQuota(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('quota') || lower.includes('storage is full');
}

/**
 * True when `err` is a storage-quota rejection rather than an ordinary failure. Deliberately
 * conservative: only the word "quota" (or the `QuotaExceededError` name / code 22) counts, so a
 * genuine bug is never mislabelled as "delete old snapshots".
 */
export function isQuotaError(err: unknown): boolean {
  if (typeof err === 'string') {
    return mentionsQuota(err);
  }
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const name = stringField(err, 'name');
  if (name === 'QuotaExceededError') {
    return true;
  }
  if (numberField(err, 'code') === QUOTA_EXCEEDED_CODE && mentionsQuota(name)) {
    return true;
  }
  return mentionsQuota(stringField(err, 'message'));
}
