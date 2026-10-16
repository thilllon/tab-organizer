import { describe, expect, it } from 'vitest';
import type { OpenWindowView } from '@/lib/open-windows';
import {
  closedTabsNotice,
  copiedSelectionNotice,
  EMPTY_SELECTION,
  keptOpenNotice,
  pruneSelection,
  selectBySite,
  selectedTabs,
  selectionLabel,
  selectionText,
  selectRange,
  toggleSelected,
} from '@/lib/tab-selection';

function tab(tabId: number, url: string, title = `Tab ${tabId}`): OpenWindowView['tabs'][number] {
  return { tabId, url, title, pinned: false, active: false };
}

function win(windowId: number, tabs: OpenWindowView['tabs']): OpenWindowView {
  return { windowId, focused: false, state: 'normal', groups: [], tabs };
}

const WINDOWS: OpenWindowView[] = [
  win(1, [
    tab(11, 'https://a.example/one'),
    tab(12, 'https://b.example/'),
    tab(13, 'https://a.example/two'),
  ]),
  win(2, [tab(21, 'https://c.example/'), tab(22, 'https://b.example/x')]),
];

const ids = (selection: ReadonlySet<number>) => [...selection].sort((a, b) => a - b);

describe('toggleSelected', () => {
  it('ticks an unticked tab and unticks a ticked one, without touching its input', () => {
    const one = toggleSelected(EMPTY_SELECTION, 11);
    expect(ids(one)).toEqual([11]);
    expect(ids(toggleSelected(one, 12))).toEqual([11, 12]);
    expect(ids(toggleSelected(one, 11))).toEqual([]);
    expect(EMPTY_SELECTION.size).toBe(0);
    expect(ids(one)).toEqual([11]);
  });
});

describe('selectRange', () => {
  it('ticks everything between the anchor and the clicked tab, across windows', () => {
    expect(ids(selectRange(WINDOWS, new Set([12]), 12, 21))).toEqual([12, 13, 21]);
  });

  it('works upwards too, and keeps what was already ticked', () => {
    expect(ids(selectRange(WINDOWS, new Set([22, 13]), 13, 11))).toEqual([11, 12, 13, 22]);
  });

  it('ticks just the clicked tab when there is no anchor, or the anchor has closed', () => {
    expect(ids(selectRange(WINDOWS, EMPTY_SELECTION, undefined, 13))).toEqual([13]);
    expect(ids(selectRange(WINDOWS, new Set([11]), 99, 13))).toEqual([11, 13]);
  });
});

describe('pruneSelection', () => {
  it('drops the tabs that are no longer open', () => {
    expect(ids(pruneSelection(WINDOWS, new Set([11, 99, 22])))).toEqual([11, 22]);
  });

  it('returns the same set when nothing was dropped, so an effect can call it freely', () => {
    const selection = new Set([11, 22]);
    expect(pruneSelection(WINDOWS, selection)).toBe(selection);
    expect(pruneSelection(WINDOWS, EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
  });
});

describe('selectedTabs', () => {
  it('returns the ticked tabs in list order, whatever order they were ticked in', () => {
    expect(selectedTabs(WINDOWS, new Set([22, 11, 13])).map((t) => t.tabId)).toEqual([11, 13, 22]);
  });
});

describe('selectBySite', () => {
  it('like: every tab on the sites of the ticked ones', () => {
    expect(ids(selectBySite(WINDOWS, new Set([11]), 'like'))).toEqual([11, 13]);
    expect(ids(selectBySite(WINDOWS, new Set([11, 22]), 'like'))).toEqual([11, 12, 13, 22]);
  });

  it('unlike: every tab on any other site, replacing the selection', () => {
    expect(ids(selectBySite(WINDOWS, new Set([11]), 'unlike'))).toEqual([12, 21, 22]);
  });

  it('tells apart urls that are not web pages', () => {
    const windows = [
      win(1, [
        tab(1, 'file:///Users/me/a.pdf'),
        tab(2, 'file:///Users/me/b.pdf'),
        tab(3, 'chrome://settings/'),
        tab(4, 'not a url'),
      ]),
    ];
    expect(ids(selectBySite(windows, new Set([1]), 'like'))).toEqual([1]);
    expect(ids(selectBySite(windows, new Set([3]), 'unlike'))).toEqual([1, 2, 4]);
  });
});

describe('selectionText', () => {
  const tabs = [
    tab(1, 'https://a.example/one', 'One [draft]'),
    { ...tab(2, 'https://b.example/(x)', ''), pinned: true },
  ];

  it('links: one url per line', () => {
    expect(selectionText(tabs, 'links')).toBe('https://a.example/one\nhttps://b.example/(x)');
  });

  it('markdown: an escaped link per line, with no pinned marker', () => {
    expect(selectionText(tabs, 'markdown')).toBe(
      '- [One \\[draft\\]](https://a.example/one)\n- [https://b.example/(x)](https://b.example/%28x%29)',
    );
  });

  it('titled: title above url, a blank line between tabs, the url alone when untitled', () => {
    expect(selectionText(tabs, 'titled')).toBe(
      'One [draft]\nhttps://a.example/one\n\nhttps://b.example/(x)',
    );
  });
});

describe('wording', () => {
  it('counts the selection', () => {
    expect(selectionLabel(1)).toBe('1 selected tab');
    expect(selectionLabel(12)).toBe('12 selected tabs');
  });

  it('says what was copied and closed', () => {
    expect(copiedSelectionNotice(1, 'links')).toBe('Copied 1 link.');
    expect(copiedSelectionNotice(3, 'markdown')).toBe('Copied 3 links as Markdown.');
    expect(copiedSelectionNotice(3, 'titled')).toBe('Copied 3 links with titles.');
    expect(closedTabsNotice(1)).toBe('Closed 1 tab.');
    expect(closedTabsNotice(4)).toBe('Closed 4 tabs.');
    expect(keptOpenNotice(1)).toBe('1 tab could not be saved and was left open.');
    expect(keptOpenNotice(2)).toBe('2 tabs could not be saved and were left open.');
  });
});
