import { t, tp } from '@/lib/i18n';
import type { OpenWindowView } from '@/lib/open-windows';
import { toMarkdownLinks } from '@/lib/session-export';

/**
 * The selection on the Open tabs list: which live tabs are ticked, and what the bar above them
 * does with those. Everything here is pure; the components only hold the set and call these.
 *
 * A selection is a set of Chrome tab ids. They are runtime ids, valid only while the tab is open,
 * so they live in component state and are never stored.
 */

export type TabSelection = ReadonlySet<number>;

export const EMPTY_SELECTION: TabSelection = new Set<number>();

type OpenTab = OpenWindowView['tabs'][number];

/** Every open tab in the order the list shows them: window by window, left to right. */
function allTabs(windows: readonly OpenWindowView[]): OpenTab[] {
  return windows.flatMap((window) => window.tabs);
}

export function toggleSelected(selection: TabSelection, tabId: number): TabSelection {
  const next = new Set(selection);
  if (!next.delete(tabId)) {
    next.add(tabId);
  }
  return next;
}

/**
 * Shift-click: ticks every tab from `anchorId` (the tab ticked last) to `tabId`, in list order and
 * across windows, on top of what is already ticked. Without a usable anchor it ticks just the one
 * tab - a range needs two ends.
 */
export function selectRange(
  windows: readonly OpenWindowView[],
  selection: TabSelection,
  anchorId: number | undefined,
  tabId: number,
): TabSelection {
  const order = allTabs(windows).map((tab) => tab.tabId);
  const from = anchorId === undefined ? -1 : order.indexOf(anchorId);
  const to = order.indexOf(tabId);
  const next = new Set(selection);
  if (from === -1 || to === -1) {
    next.add(tabId);
    return next;
  }
  for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
    next.add(id);
  }
  return next;
}

/** How much of a window is ticked: what its select-all box shows (ticked, dash, empty). */
export type SelectionState = 'all' | 'some' | 'none';

/** 'all' when every tab of the window is ticked, 'some' when part of them are, 'none' otherwise. */
export function selectionState(window: OpenWindowView, selection: TabSelection): SelectionState {
  const ticked = window.tabs.filter((tab) => selection.has(tab.tabId)).length;
  if (ticked === 0) {
    return 'none';
  }
  return ticked === window.tabs.length ? 'all' : 'some';
}

/**
 * A window's select-all box clicked: when every tab of the window is ticked it unticks them,
 * otherwise it ticks them all - collapsed groups and tabs past "show more" included, since the
 * selection is of tabs, not of rows. Ticks in other windows are left as they are.
 */
export function toggleWindow(window: OpenWindowView, selection: TabSelection): TabSelection {
  const clear = selectionState(window, selection) === 'all';
  const next = new Set(selection);
  for (const tab of window.tabs) {
    if (clear) {
      next.delete(tab.tabId);
    } else {
      next.add(tab.tabId);
    }
  }
  return next;
}

/**
 * Drops the ids of tabs that are no longer open. Returns the very same set when nothing was
 * dropped, so an effect that calls this on every refresh of the list does not re-render forever.
 */
export function pruneSelection(
  windows: readonly OpenWindowView[],
  selection: TabSelection,
): TabSelection {
  if (selection.size === 0) {
    return selection;
  }
  const open = new Set(allTabs(windows).map((tab) => tab.tabId));
  const kept = [...selection].filter((id) => open.has(id));
  return kept.length === selection.size ? selection : new Set(kept);
}

/** The ticked tabs, in list order. */
export function selectedTabs(
  windows: readonly OpenWindowView[],
  selection: TabSelection,
): OpenTab[] {
  return allTabs(windows).filter((tab) => selection.has(tab.tabId));
}

/** What makes two tabs "like" each other: the site. A url that will not parse is its own site. */
function siteOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host === '' ? `${parsed.protocol}${parsed.pathname}` : parsed.host;
  } catch {
    return url;
  }
}

/**
 * "Select all tabs like this" / "… not like this": every open tab on the same sites as the ticked
 * ones, or every tab on any other site. The result replaces the selection - "not like this" is how
 * you keep the three tabs you are reading and sweep away the rest.
 */
export function selectBySite(
  windows: readonly OpenWindowView[],
  selection: TabSelection,
  mode: 'like' | 'unlike',
): TabSelection {
  const sites = new Set(selectedTabs(windows, selection).map((tab) => siteOf(tab.url)));
  const wantLike = mode === 'like';
  return new Set(
    allTabs(windows)
      .filter((tab) => sites.has(siteOf(tab.url)) === wantLike)
      .map((tab) => tab.tabId),
  );
}

/** How a copied selection can be written. Plain links are what the Copy button itself does. */
export type CopyFormat = 'links' | 'markdown' | 'titled';

interface CopyFormatItem {
  format: CopyFormat;
  label: string;
}

/** The copy formats with their menu labels, in the UI language (read at call time). */
export function copyFormatItems(): readonly CopyFormatItem[] {
  return [
    { format: 'links', label: t('openCopyFormatLinks') },
    { format: 'markdown', label: t('openCopyFormatMarkdown') },
    { format: 'titled', label: t('openCopyFormatTitled') },
  ];
}

export function selectionText(tabs: readonly OpenTab[], format: CopyFormat): string {
  switch (format) {
    case 'links':
      return tabs.map((tab) => tab.url).join('\n');
    case 'markdown':
      // The pinned marker is for a saved session's list; a copied link is just a link.
      return toMarkdownLinks(tabs.map((tab) => ({ ...tab, pinned: false })));
    case 'titled':
      return tabs
        .map((tab) => (tab.title === '' ? tab.url : `${tab.title}\n${tab.url}`))
        .join('\n\n');
  }
}

export function selectionLabel(count: number): string {
  return tp('openSelectedTabs', count);
}

export function copiedSelectionNotice(count: number, format: CopyFormat): string {
  switch (format) {
    case 'links':
      return tp('commonCopiedLinks', count);
    case 'markdown':
      return tp('openCopiedLinksMarkdown', count);
    case 'titled':
      return tp('openCopiedLinksTitled', count);
  }
}

export function closedTabsNotice(count: number): string {
  return tp('openClosedTabs', count);
}

/** "Save & close", when some ticked tabs could not be saved and were therefore left open. */
export function keptOpenNotice(count: number): string {
  return tp('openKeptOpen', count);
}
