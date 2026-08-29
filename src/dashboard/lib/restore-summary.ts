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

export function formatRestoreSummary(result: RestoreResult, total: number): string {
  const parts = [`Restored ${result.restored} of ${total} ${total === 1 ? 'tab' : 'tabs'}`];
  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} skipped`);
  }
  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} could not be opened`);
  }
  return parts.join(' · ');
}
