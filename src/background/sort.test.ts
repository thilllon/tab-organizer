import { describe, expect, it } from 'vitest'
import {
  compareByUrlComponents,
  extractGroupingKey,
  findDuplicateTabs,
  isSuspended,
  sortByTitleOrUrl,
  tabToUrl,
} from './sort'

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
  }
}

describe('compareByUrlComponents', () => {
  it('sorts URLs alphabetically by hostname', () => {
    const a = new URL('https://apple.com')
    const b = new URL('https://banana.com')
    expect(compareByUrlComponents(a, b)).toBeLessThan(0)
    expect(compareByUrlComponents(b, a)).toBeGreaterThan(0)
  })

  it('returns 0 for identical URLs', () => {
    const a = new URL('https://example.com/path')
    const b = new URL('https://example.com/path')
    expect(compareByUrlComponents(a, b)).toBe(0)
  })

  it('strips www. prefix for comparison', () => {
    const a = new URL('https://www.example.com/page')
    const b = new URL('https://example.com/page')
    expect(compareByUrlComponents(a, b)).toBe(0)
  })

  it('considers pathname in comparison', () => {
    const a = new URL('https://example.com/aaa')
    const b = new URL('https://example.com/zzz')
    expect(compareByUrlComponents(a, b)).toBeLessThan(0)
  })

  it('considers search params in comparison', () => {
    const a = new URL('https://example.com/path?a=1')
    const b = new URL('https://example.com/path?z=1')
    expect(compareByUrlComponents(a, b)).toBeLessThan(0)
  })

  it('considers hash in comparison', () => {
    const a = new URL('https://example.com/path#aaa')
    const b = new URL('https://example.com/path#zzz')
    expect(compareByUrlComponents(a, b)).toBeLessThan(0)
  })
})

describe('extractGroupingKey', () => {
  it('returns full hostname in subdomain mode', () => {
    expect(extractGroupingKey('docs.google.com', 'subdomain')).toBe('docs.google.com')
  })

  it('returns base domain in domain mode', () => {
    expect(extractGroupingKey('docs.google.com', 'domain')).toBe('google.com')
  })

  it('handles two-part TLDs like co.uk', () => {
    expect(extractGroupingKey('www.example.co.uk', 'domain')).toBe('example.co.uk')
  })

  it('handles simple hostname in domain mode', () => {
    expect(extractGroupingKey('example.com', 'domain')).toBe('example.com')
  })

  it('handles known second-level domains', () => {
    expect(extractGroupingKey('app.example.ac.kr', 'domain')).toBe('example.ac.kr')
    expect(extractGroupingKey('shop.example.com.au', 'domain')).toBe('example.com.au')
  })
})

describe('isSuspended', () => {
  const prefix = 'chrome-extension://testid/suspended.html#'

  it('returns true for suspended tab', () => {
    const tab = makeTab({ url: `${prefix}uri=https://example.com` })
    expect(isSuspended(tab, prefix)).toBe(true)
  })

  it('returns false for normal tab', () => {
    const tab = makeTab({ url: 'https://example.com' })
    expect(isSuspended(tab, prefix)).toBe(false)
  })

  it('returns false for tab without URL', () => {
    const tab = makeTab({ url: undefined })
    expect(isSuspended(tab, prefix)).toBe(false)
  })
})

describe('tabToUrl', () => {
  const prefixLen = 'chrome-extension://testid/suspended.html#'.length

  it('returns tab URL directly when groupSuspendedTabs is true', () => {
    const tab = makeTab({ url: 'https://example.com/page' })
    const result = tabToUrl(tab, true, prefixLen)
    expect(result.href).toBe('https://example.com/page')
  })

  it('returns pendingUrl when url is not available', () => {
    const tab = makeTab({ url: undefined, pendingUrl: 'https://pending.com' })
    const result = tabToUrl(tab, false, prefixLen)
    expect(result.href).toBe('https://pending.com/')
  })

  it('returns tab url for normal tabs', () => {
    const tab = makeTab({ url: 'https://example.com' })
    const result = tabToUrl(tab, false, prefixLen)
    expect(result.href).toBe('https://example.com/')
  })
})

describe('findDuplicateTabs', () => {
  it('returns empty map when no duplicates', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com' }),
      makeTab({ id: 2, url: 'https://b.com' }),
    ]
    const result = findDuplicateTabs(tabs)
    expect(result.size).toBe(0)
  })

  it('detects duplicate tabs by URL', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com' }),
      makeTab({ id: 2, url: 'https://a.com' }),
      makeTab({ id: 3, url: 'https://b.com' }),
    ]
    const result = findDuplicateTabs(tabs)
    expect(result.size).toBe(1)
    expect(result.get('https://a.com')?.length).toBe(2)
  })

  it('skips tabs without URL', () => {
    const tabs = [
      makeTab({ id: 1, url: undefined, pendingUrl: undefined }),
      makeTab({ id: 2, url: undefined, pendingUrl: undefined }),
    ]
    const result = findDuplicateTabs(tabs)
    expect(result.size).toBe(0)
  })

  it('uses pendingUrl as fallback', () => {
    const tabs = [
      makeTab({ id: 1, url: undefined, pendingUrl: 'https://a.com' }),
      makeTab({ id: 2, url: undefined, pendingUrl: 'https://a.com' }),
    ]
    const result = findDuplicateTabs(tabs)
    expect(result.size).toBe(1)
  })
})

describe('sortByTitleOrUrl', () => {
  const noSuspend = ''
  const noSuspendLen = 0

  it('sorts tabs alphabetically by title (A→Z)', () => {
    const tabs = [
      makeTab({ title: 'Zebra', url: 'https://z.com' }),
      makeTab({ title: 'Apple', url: 'https://a.com' }),
      makeTab({ title: 'Mango', url: 'https://m.com' }),
    ]

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen)

    expect(tabs.map((t) => t.title)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  it('sorts tabs alphabetically by URL', () => {
    const tabs = [
      makeTab({ url: 'https://zoo.com' }),
      makeTab({ url: 'https://apple.com' }),
      makeTab({ url: 'https://banana.com' }),
    ]

    sortByTitleOrUrl(tabs, 'url', false, false, noSuspend, noSuspendLen)

    expect(tabs.map((t) => t.url)).toEqual([
      'https://apple.com',
      'https://banana.com',
      'https://zoo.com',
    ])
  })

  it('does not reorder pinned tabs when sortPinnedTabs is false', () => {
    const tabs = [
      makeTab({ title: 'Zebra', pinned: true }),
      makeTab({ title: 'Apple', pinned: false }),
      makeTab({ title: 'Mango', pinned: false }),
    ]

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen)

    // Pinned tab should stay in place relative to others
    expect(tabs[0].pinned).toBe(true)
  })

  it('sorts pinned tabs when sortPinnedTabs is true', () => {
    const tabs = [
      makeTab({ title: 'Zebra', pinned: true }),
      makeTab({ title: 'Apple', pinned: true }),
    ]

    sortByTitleOrUrl(tabs, 'title', false, true, noSuspend, noSuspendLen)

    expect(tabs.map((t) => t.title)).toEqual(['Apple', 'Zebra'])
  })

  it('handles empty title gracefully', () => {
    const tabs = [
      makeTab({ title: 'Beta' }),
      makeTab({ title: undefined }),
      makeTab({ title: 'Alpha' }),
    ]

    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen)

    expect(tabs.map((t) => t.title ?? '')).toEqual(['', 'Alpha', 'Beta'])
  })

  it('handles single tab array', () => {
    const tabs = [makeTab({ title: 'Only' })]
    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen)
    expect(tabs[0].title).toBe('Only')
  })

  it('handles empty array', () => {
    const tabs: chrome.tabs.Tab[] = []
    sortByTitleOrUrl(tabs, 'title', false, false, noSuspend, noSuspendLen)
    expect(tabs).toEqual([])
  })
})
