import { toMarkdownLinks } from '@/lib/export';
import { pluralize } from '@/lib/format';
import type { OpenWindowView } from '@/lib/open-windows';

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
 * tab — a range needs two ends.
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
 * ones, or every tab on any other site. The result replaces the selection — "not like this" is how
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

export interface CopyFormatItem {
  format: CopyFormat;
  label: string;
}

export const COPY_FORMAT_ITEMS: readonly CopyFormatItem[] = [
  { format: 'links', label: 'Links' },
  { format: 'markdown', label: 'Markdown links' },
  { format: 'titled', label: 'Titles and links' },
];

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
  return `${count} selected ${count === 1 ? 'tab' : 'tabs'}`;
}

export function copiedSelectionNotice(count: number, format: CopyFormat): string {
  const links = pluralize(count, 'link');
  switch (format) {
    case 'links':
      return `Copied ${links}.`;
    case 'markdown':
      return `Copied ${links} as Markdown.`;
    case 'titled':
      return `Copied ${links} with titles.`;
  }
}

export function closedTabsNotice(count: number): string {
  return `Closed ${pluralize(count, 'tab')}.`;
}

/** "Save & close", when some ticked tabs could not be saved and were therefore left open. */
export function keptOpenNotice(count: number): string {
  return `${pluralize(count, 'tab')} could not be saved and ${count === 1 ? 'was' : 'were'} left open.`;
}
