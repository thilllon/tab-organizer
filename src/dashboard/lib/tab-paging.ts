import { pluralize } from '@/dashboard/lib/format';

/**
 * Paging for very large windows (spec §12 Phase 6: "a 10,000-tab session never mounts 10,000
 * rows at once"). `content-visibility: auto` keeps off-screen rows cheap to *render*, but React
 * still has to create and diff every row it mounts — so a window over the threshold starts
 * clipped and grows a page at a time behind a "Show 200 more tabs" button.
 *
 * The threshold is deliberately well above a realistic window (a 300-tab window renders in full,
 * as it always did) and the page size below it, so the first click on a huge window is visibly
 * cheap. Pure; the component only holds the count.
 */

/** Windows with more tabs than this start paged. */
export const TAB_PAGE_THRESHOLD = 300;

/** How many more rows each "Show more" click mounts. */
export const TAB_PAGE_SIZE = 200;

function clampTotal(total: number): number {
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}

/** How many rows a window shows before the first "Show more" click. */
export function initialTabPage(total: number): number {
  const size = clampTotal(total);
  return size > TAB_PAGE_THRESHOLD ? TAB_PAGE_SIZE : size;
}

/** How many rows are shown after one more click; never past the end. */
export function nextTabPage(visible: number, total: number): number {
  const size = clampTotal(total);
  return Math.min(size, Math.max(0, Math.floor(visible)) + TAB_PAGE_SIZE);
}

/** Rows not mounted yet. Zero means the whole window is on screen and no button is needed. */
export function hiddenTabCount(visible: number, total: number): number {
  return Math.max(0, clampTotal(total) - Math.max(0, Math.floor(visible)));
}

/**
 * "Show 200 more tabs" — or the exact remainder on the last page ("Show 43 more tabs"), so the
 * button never promises rows that do not exist.
 */
export function showMoreLabel(visible: number, total: number): string {
  const hidden = hiddenTabCount(visible, total);
  return `Show ${pluralize(Math.min(TAB_PAGE_SIZE, hidden), 'more tab')}`;
}
