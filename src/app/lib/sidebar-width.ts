import { readLocalUiState, SIDEBAR_WIDTH_KEY, writeLocalUiState } from '@/dashboard/lib/ui-state';

/**
 * The sidebar can be dragged wider: session names are long ("Session 2026-09-22 14:13 · …") and a
 * fixed column cut them off. Bounds rather than a free-for-all — narrower than `MIN` hides the
 * names it exists to show, wider than `MAX` starves the pane the sidebar is there to drive.
 */
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 260;
/** Arrow keys on the drag handle move it in steps this size. */
export const SIDEBAR_WIDTH_STEP = 16;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

export function readSidebarWidth(): number {
  const stored = readLocalUiState(SIDEBAR_WIDTH_KEY);
  return stored === undefined ? DEFAULT_SIDEBAR_WIDTH : clampSidebarWidth(Number(stored));
}

export function writeSidebarWidth(width: number): void {
  writeLocalUiState(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
}
