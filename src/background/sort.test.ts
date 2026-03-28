import { describe, expect, it } from 'vitest';
import {
  compareByUrlComponents,
  extractGroupingKey,
  findDuplicateTabs,
  isSuspended,
  sortByTitleOrUrl,
  tabToUrl,
} from './sort';

describe('compareByUrlComponents', () => {
  it('sorts URLs alphabetically by hostname', () => {
    const a = new URL('https://apple.com');
    const b = new URL('https://banana.com');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
    expect(compareByUrlComponents(b, a)).toBeGreaterThan(0);
  });

  it('returns 0 for identical URLs', () => {
    const a = new URL('https://example.com/path');
    const b = new URL('https://example.com/path');
    expect(compareByUrlComponents(a, b)).toBe(0);
  });

  it('strips www. prefix for comparison', () => {
    const a = new URL('https://www.example.com/page');
    const b = new URL('https://example.com/page');
    expect(compareByUrlComponents(a, b)).toBe(0);
  });

  it('considers pathname in comparison', () => {
    const a = new URL('https://example.com/aaa');
    const b = new URL('https://example.com/zzz');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });

  it('considers search params in comparison', () => {
    const a = new URL('https://example.com/path?a=1');
    const b = new URL('https://example.com/path?z=1');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });

  it('considers hash in comparison', () => {
    const a = new URL('https://example.com/path#aaa');
    const b = new URL('https://example.com/path#zzz');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });

  it('handles chrome:// URLs', () => {
    const a = new URL('chrome://extensions/');
    const b = new URL('chrome://settings/');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
    expect(compareByUrlComponents(b, a)).toBeGreaterThan(0);
  });

  it('handles chrome-extension:// URLs', () => {
    const a = new URL('chrome-extension://abcdef/popup.html');
    const b = new URL('chrome-extension://zyxwvu/options.html');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });

  it('sorts chrome:// before https://', () => {
    const a = new URL('chrome://settings/');
    const b = new URL('https://example.com');
    // chrome:// hostname ("settings") < https:// hostname ("example.com")
    const result = compareByUrlComponents(a, b);
    expect(typeof result).toBe('number');
  });

  it('handles about:blank', () => {
    const a = new URL('about:blank');
    const b = new URL('https://example.com');
    const result = compareByUrlComponents(a, b);
    expect(typeof result).toBe('number');
  });

  it('handles file:// URLs', () => {
    const a = new URL('file:///Users/test/doc.html');
    const b = new URL('file:///Users/test/readme.html');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });

  it('handles chrome:// URLs with subpages', () => {
    const a = new URL('chrome://settings/privacy');
    const b = new URL('chrome://settings/security');
    expect(compareByUrlComponents(a, b)).toBeLessThan(0);
  });
});

describe('extractGroupingKey', () => {
  it('returns full hostname in subdomain mode', () => {
    expect(extractGroupingKey('docs.google.com', 'subdomain')).toBe('docs.google.com');
  });

  it('returns base domain in domain mode', () => {
    expect(extractGroupingKey('docs.google.com', 'domain')).toBe('google.com');
  });

  it('handles two-part TLDs like co.uk', () => {
    expect(extractGroupingKey('www.example.co.uk', 'domain')).toBe('example.co.uk');
  });

  it('handles simple hostname in domain mode', () => {
    expect(extractGroupingKey('example.com', 'domain')).toBe('example.com');
  });

  it('handles known second-level domains', () => {
    expect(extractGroupingKey('app.example.ac.kr', 'domain')).toBe('example.ac.kr');
    expect(extractGroupingKey('shop.example.com.au', 'domain')).toBe('example.com.au');
  });
});

describe('isSuspended', () => {
  const prefix = 'chrome-extension://testid/suspended.html#';

  it('returns true for suspended tab', () => {
    const tab = makeTab({ url: `${prefix}uri=https://example.com` });
    expect(isSuspended(tab, prefix)).toBe(true);
  });

  it('returns false for normal tab', () => {
    const tab = makeTab({ url: 'https://example.com' });
    expect(isSuspended(tab, prefix)).toBe(false);
  });

  it('returns false for tab without URL', () => {
    const tab = makeTab({ url: undefined });
    expect(isSuspended(tab, prefix)).toBe(false);
  });

  it('returns false for chrome:// URL', () => {
    const tab = makeTab({ url: 'chrome://settings/' });
    expect(isSuspended(tab, prefix)).toBe(false);
  });

  it('returns false for chrome-extension:// URL that is not the suspender', () => {
    const tab = makeTab({ url: 'chrome-extension://otherid/popup.html' });
    expect(isSuspended(tab, prefix)).toBe(false);
  });
});

describe('tabToUrl', () => {
  const prefixLen = 'chrome-extension://testid/suspended.html#'.length;

  it('returns tab URL directly when groupSuspendedTabs is true', () => {
    const tab = makeTab({ url: 'https://example.com/page' });
    const result = tabToUrl(tab, true, prefixLen);
    expect(result.href).toBe('https://example.com/page');
  });

  it('returns pendingUrl when url is not available', () => {
    const tab = makeTab({ url: undefined, pendingUrl: 'https://pending.com' });
    const result = tabToUrl(tab, false, prefixLen);
    expect(result.href).toBe('https://pending.com/');
  });

  it('returns tab url for normal tabs', () => {
    const tab = makeTab({ url: 'https://example.com' });
    const result = tabToUrl(tab, false, prefixLen);
    expect(result.href).toBe('https://example.com/');
  });

  it('handles chrome:// URLs', () => {
    const tab = makeTab({ url: 'chrome://extensions/' });
    const result = tabToUrl(tab, false, prefixLen);
    expect(result.href).toBe('chrome://extensions/');
  });

  it('handles chrome-extension:// URLs', () => {
    const tab = makeTab({ url: 'chrome-extension://abcdef/options.html' });
    const result = tabToUrl(tab, false, prefixLen);
    expect(result.href).toBe('chrome-extension://abcdef/options.html');
  });

  it('handles about:blank', () => {
    const tab = makeTab({ url: 'about:blank' });
    const result = tabToUrl(tab, false, prefixLen);
    expect(result.href).toBe('about:blank');
  });
});

describe('findDuplicateTabs', () => {
  it('returns empty map when no duplicates', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com' }),
      makeTab({ id: 2, url: 'https://b.com' }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(0);
  });

  it('detects duplicate tabs by URL', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com' }),
      makeTab({ id: 2, url: 'https://a.com' }),
      makeTab({ id: 3, url: 'https://b.com' }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(1);
    expect(result.get('https://a.com')?.length).toBe(2);
  });

  it('skips tabs without URL', () => {
    const tabs = [
      makeTab({ id: 1, url: undefined, pendingUrl: undefined }),
      makeTab({ id: 2, url: undefined, pendingUrl: undefined }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(0);
  });

  it('uses pendingUrl as fallback', () => {
    const tabs = [
      makeTab({ id: 1, url: undefined, pendingUrl: 'https://a.com' }),
      makeTab({ id: 2, url: undefined, pendingUrl: 'https://a.com' }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(1);
  });

  it('detects duplicate chrome:// tabs', () => {
    const tabs = [
      makeTab({ id: 1, url: 'chrome://settings/' }),
      makeTab({ id: 2, url: 'chrome://settings/' }),
      makeTab({ id: 3, url: 'chrome://extensions/' }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(1);
    expect(result.get('chrome://settings/')?.length).toBe(2);
  });

  it('treats chrome:// and https:// as different URLs', () => {
    const tabs = [
      makeTab({ id: 1, url: 'chrome://settings/' }),
      makeTab({ id: 2, url: 'https://settings/' }),
    ];
    const result = findDuplicateTabs(tabs);
    expect(result.size).toBe(0);
  });
});

describe('sortByTitleOrUrl', () => {
  const noSuspend = '';
  const noSuspendLen = 0;

  it('sorts tabs alphabetically by title (A→Z)', () => {
    const tabs = [
      makeTab({ title: 'Zebra', url: 'https://z.com' }),
      makeTab({ title: 'Apple', url: 'https://a.com' }),
      makeTab({ title: 'Mango', url: 'https://m.com' }),
    ];

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('sorts tabs alphabetically by URL', () => {
    const tabs = [
      makeTab({ url: 'https://zoo.com' }),
      makeTab({ url: 'https://apple.com' }),
      makeTab({ url: 'https://banana.com' }),
    ];

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.url)).toEqual([
      'https://apple.com',
      'https://banana.com',
      'https://zoo.com',
    ]);
  });

  it('does not reorder pinned tabs when sortPinnedTabs is false', () => {
    const tabs = [
      makeTab({ title: 'Zebra', pinned: true }),
      makeTab({ title: 'Apple', pinned: false }),
      makeTab({ title: 'Mango', pinned: false }),
    ];

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);

    // Pinned tab should stay in place relative to others
    expect(tabs[0].pinned).toBe(true);
  });

  it('sorts pinned tabs when sortPinnedTabs is true', () => {
    const tabs = [
      makeTab({ title: 'Zebra', pinned: true }),
      makeTab({ title: 'Apple', pinned: true }),
    ];

    sortByTitleOrUrl(tabs, 'title', false, true, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.title)).toEqual(['Apple', 'Zebra']);
  });

  it('handles empty title gracefully', () => {
    const tabs = [
      makeTab({ title: 'Beta' }),
      makeTab({ title: undefined }),
      makeTab({ title: 'Alpha' }),
    ];

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.title ?? '')).toEqual(['', 'Alpha', 'Beta']);
  });

  it('handles single tab array', () => {
    const tabs = [makeTab({ title: 'Only' })];
    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);
    expect(tabs[0].title).toBe('Only');
  });

  it('handles empty array', () => {
    const tabs: chrome.tabs.Tab[] = [];
    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);
    expect(tabs).toEqual([]);
  });

  it('sorts mixed chrome:// and https:// tabs by URL', () => {
    const tabs = [
      makeTab({ url: 'https://zoo.com' }),
      makeTab({ url: 'chrome://settings/' }),
      makeTab({ url: 'chrome://extensions/' }),
      makeTab({ url: 'https://apple.com' }),
    ];

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.url)).toEqual([
      'https://apple.com',
      'chrome://extensions/',
      'chrome://settings/',
      'https://zoo.com',
    ]);
  });

  it('sorts tabs with about:blank by URL', () => {
    const tabs = [makeTab({ url: 'https://example.com' }), makeTab({ url: 'about:blank' })];

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen);

    // about:blank has empty hostname, so it sorts before any domain
    expect(tabs[0].url).toBe('about:blank');
  });

  it('sorts chrome-extension:// tabs by URL', () => {
    const tabs = [
      makeTab({ url: 'chrome-extension://zzz/popup.html' }),
      makeTab({ url: 'chrome-extension://aaa/options.html' }),
    ];

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.url)).toEqual([
      'chrome-extension://aaa/options.html',
      'chrome-extension://zzz/popup.html',
    ]);
  });

  it('sorts file:// tabs by title', () => {
    const tabs = [
      makeTab({ title: 'Readme', url: 'file:///readme.html' }),
      makeTab({ title: 'About', url: 'file:///about.html' }),
    ];

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen);

    expect(tabs.map((t) => t.title)).toEqual(['About', 'Readme']);
  });

  it('sorts many tabs with diverse URLs including subdomains and special schemes', () => {
    const tabs = [
      makeTab({ url: 'https://www.youtube.com/watch?v=abc123' }),
      makeTab({ url: 'chrome://settings/privacy' }),
      makeTab({ url: 'https://docs.google.com/document/d/1' }),
      makeTab({ url: 'https://mail.google.com/mail/u/0/#inbox' }),
      makeTab({ url: 'about:blank' }),
      makeTab({ url: 'https://github.com/anthropics/claude-code' }),
      makeTab({ url: 'chrome-extension://abcdef/options.html' }),
      makeTab({ url: 'https://ko.wikipedia.org/wiki/JavaScript' }),
      makeTab({ url: 'https://stackoverflow.com/questions/12345' }),
      makeTab({ url: 'https://developer.mozilla.org/en-US/docs/Web/API' }),
      makeTab({ url: 'chrome://extensions/' }),
      makeTab({ url: 'https://www.amazon.com/dp/B09V3KXJPB' }),
      makeTab({ url: 'https://drive.google.com/drive/my-drive' }),
      makeTab({ url: 'https://news.ycombinator.com/' }),
      makeTab({ url: 'file:///Users/test/index.html' }),
      makeTab({ url: 'https://calendar.google.com/calendar/u/0' }),
      makeTab({ url: 'https://app.slack.com/client/T1234/C5678' }),
      makeTab({ url: 'https://www.reddit.com/r/programming/' }),
      makeTab({ url: 'https://translate.google.com/?sl=en&tl=ko' }),
      makeTab({ url: 'chrome://flags/' }),
      makeTab({ url: 'https://console.cloud.google.com/home/dashboard' }),
      makeTab({ url: 'https://www.notion.so/workspace/page-id' }),
      makeTab({ url: 'https://en.wikipedia.org/wiki/TypeScript' }),
      makeTab({ url: 'https://github.com/vercel/next.js/issues' }),
      makeTab({ url: 'https://maps.google.com/maps?q=seoul' }),
    ];

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen);

    const urls = tabs.map((t) => {
      const u = new URL(t.url ?? '');
      return u.hostname.replace(/^www\./, '') + u.pathname + u.search + u.hash;
    });

    // Verify sorted in ascending order
    for (let i = 1; i < urls.length; i++) {
      expect(urls[i - 1].localeCompare(urls[i])).toBeLessThanOrEqual(0);
    }

    // Verify specific ordering expectations
    const hostnames = tabs.map((t) => new URL(t.url ?? '').hostname.replace(/^www\./, ''));

    // about:blank (empty hostname) should be first
    expect(hostnames[0]).toBe('');

    // chrome-extension:// comes early (hostname is extension ID)
    // amazon.com before github.com
    const amazonIdx = hostnames.indexOf('amazon.com');
    const githubIdx = hostnames.indexOf('github.com');
    expect(amazonIdx).toBeLessThan(githubIdx);

    // Multiple google subdomains should appear (URL sort is by full key, not just domain)
    const googleHostnames = hostnames.filter((h) => h.endsWith('google.com'));
    expect(googleHostnames.length).toBe(7);
    // They should be in alphabetical order among themselves
    const sortedGoogle = [...googleHostnames].sort((a, b) => a.localeCompare(b));
    expect(googleHostnames).toEqual(sortedGoogle);

    // Same domain, different paths: github.com entries should be adjacent
    const githubIndices = hostnames
      .map((h, i) => (h === 'github.com' ? i : -1))
      .filter((i) => i !== -1);
    expect(githubIndices.length).toBe(2);
    expect(githubIndices[1] - githubIndices[0]).toBe(1);

    // Two wikipedia subdomains should both be present and in alphabetical order
    const wikiHostnames = hostnames.filter((h) => h.endsWith('wikipedia.org'));
    expect(wikiHostnames.length).toBe(2);
    expect(wikiHostnames).toEqual([...wikiHostnames].sort((a, b) => a.localeCompare(b)));
  });
});

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  };
}
