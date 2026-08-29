import { pluralize } from '@/dashboard/lib/format';
import type { RestoreResult } from '@/sessions/restore';
import type { Session } from '@/types';

/** Spec §6: confirm (with the lazy checkbox) when a restore would open more than 100 tabs. */
export const RESTORE_CONFIRM_THRESHOLD = 100;

export function countTabs(session: Session): number {
  return session.windows.reduce((sum, window) => sum + window.tabs.length, 0);
}

export function needsRestoreConfirm(session: Session): boolean {
  return countTabs(session) > RESTORE_CONFIRM_THRESHOLD;
}

// executeRestore records group/activation/window-state failures as `errors` entries whose `url`
// is a synthetic `group:<title>` / `activate:<url>` / `window-state:<state>` marker rather than a
// real tab url — these are structural restore problems, not tabs that failed to open.
const STRUCTURAL_ERROR_PREFIXES = ['group:', 'activate:', 'window-state:'];

function isStructuralRestoreError(entry: RestoreResult['errors'][number]): boolean {
  return STRUCTURAL_ERROR_PREFIXES.some((prefix) => entry.url.startsWith(prefix));
}

export interface SplitRestoreErrors {
  /** Real tabs that failed to open. */
  tabErrors: RestoreResult['errors'];
  /** Synthetic group/activation/window-state failures — see `isStructuralRestoreError`. */
  structuralProblems: RestoreResult['errors'];
}

/** Separates executeRestore's tab-level failures from its group/window "structural" ones. */
export function splitRestoreErrors(result: RestoreResult): SplitRestoreErrors {
  const tabErrors: RestoreResult['errors'] = [];
  const structuralProblems: RestoreResult['errors'] = [];
  for (const entry of result.errors) {
    (isStructuralRestoreError(entry) ? structuralProblems : tabErrors).push(entry);
  }
  return { tabErrors, structuralProblems };
}

/**
 * `total` (aka M) must count attempted tabs only — restored + skipped + tab errors — never
 * structural (group/window) problems; the caller computes it that way (see ProgressToast, which
 * uses `splitRestoreErrors`). That keeps "of total" meaningful whether the run finished in full or
 * broke off early (e.g. a window failed to open partway through): both read as a fraction of tabs
 * the restore actually attempted. When `options.cancelled` is set, the fraction is dropped
 * entirely in favour of a plain count of tabs opened before Cancel was pressed.
 */
export function formatRestoreSummary(
  result: RestoreResult,
  total: number,
  options: { cancelled?: boolean } = {},
): string {
  if (options.cancelled === true) {
    return `Restore cancelled — ${pluralize(result.restored, 'tab')} opened`;
  }
  const { tabErrors, structuralProblems } = splitRestoreErrors(result);
  const parts = [`Restored ${result.restored} of ${pluralize(total, 'tab')}`];
  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} skipped`);
  }
  if (tabErrors.length > 0) {
    parts.push(`${tabErrors.length} could not be opened`);
  }
  if (structuralProblems.length > 0) {
    parts.push(pluralize(structuralProblems.length, 'group/window problem'));
  }
  return parts.join(' · ');
}
