import { describe, expect, it } from 'vitest';
import {
  SESSION_SCHEMA_VERSION,
  type Session,
  type TabSnapshot,
  type WindowSnapshot,
} from '@/types';
import {
  clampToScreen,
  DEFAULT_CHUNK_SIZE,
  isLazyRestore,
  LAZY_AUTO_THRESHOLD,
  planRestore,
  type RestoreOptions,
  type SanitizeOptions,
  sanitizeRestoreUrl,
  screenRectOf,
} from './restore';

const SUSPENDED_PREFIX = 'chrome-extension://suspenderid/suspended.html#';

const SANITIZE: SanitizeOptions = {
  ownExtensionId: 'fakeextid',
  fileAccessAllowed: false,
  suspendedPrefix: SUSPENDED_PREFIX,
};

function tab(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    url: 'https://example.com/',
    title: 'Example',
    pinned: false,
    active: false,
    ...overrides,
  };
}

function urls(count: number, prefix = 'https://site.test/'): TabSnapshot[] {
  return Array.from({ length: count }, (_, i) => tab({ url: `${prefix}${i}` }));
}

function win(tabs: TabSnapshot[], overrides: Partial<WindowSnapshot> = {}): WindowSnapshot {
  return { state: 'normal', focused: false, groups: [], tabs, ...overrides };
}

function session(windows: WindowSnapshot[]): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: 'sess',
    kind: 'saved',
    name: 'Test',
    origin: 'manual',
    createdAt: 1,
    updatedAt: 1,
    windows,
  };
}

function options(overrides: Partial<RestoreOptions> = {}): RestoreOptions {
  return { target: { kind: 'newWindows' }, lazy: 'auto', sanitize: SANITIZE, ...overrides };
}

describe('sanitizeRestoreUrl', () => {
  it.each([
    'http://example.com/',
    'https://example.com/path?q=1#h',
    'ftp://files.example.com/pub/',
    'chrome://settings/',
    'chrome://extensions/shortcuts',
    'about:blank',
    'chrome-extension://fakeextid/dashboard.html',
  ])('allows %s', (url) => {
    expect(sanitizeRestoreUrl(url, SANITIZE)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'blob:https://example.com/uuid',
    'view-source:https://example.com/',
    'chrome-extension://otherid/popup.html',
    'about:newtab',
    'about:srcdoc',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(sanitizeRestoreUrl(url, SANITIZE)).toBeNull();
  });

  it('allows file:// only when file access is granted', () => {
    const url = 'file:///Users/me/doc.html';

    expect(sanitizeRestoreUrl(url, SANITIZE)).toBeNull();
    expect(sanitizeRestoreUrl(url, { ...SANITIZE, fileAccessAllowed: true })).toBe(url);
  });

  it('unwraps suspender wrappers before checking the scheme', () => {
    const wrapped = `${SUSPENDED_PREFIX}ttl=Docs&uri=https://docs.example.com/p?x=1`;

    expect(sanitizeRestoreUrl(wrapped, SANITIZE)).toBe('https://docs.example.com/p?x=1');
  });

  it('unwraps verbatim: query with &, +, %XX escapes and a #fragment survive', () => {
    const real = 'https://www.youtube.com/watch?v=abc&list=PL123&q=a+b&p=%2Fusr%2Fbin#t=42';

    expect(sanitizeRestoreUrl(`${SUSPENDED_PREFIX}ttl=YouTube&pos=0&uri=${real}`, SANITIZE)).toBe(
      real,
    );
  });

  it('rejects a wrapper whose uri parameter is empty or relative', () => {
    expect(sanitizeRestoreUrl(`${SUSPENDED_PREFIX}ttl=Docs&uri=`, SANITIZE)).toBeNull();
    expect(sanitizeRestoreUrl(`${SUSPENDED_PREFIX}uri=/foo`, SANITIZE)).toBeNull();
  });

  it('rejects a wrapper whose inner url is not allowed', () => {
    const wrapped = `${SUSPENDED_PREFIX}uri=javascript:alert(1)`;

    expect(sanitizeRestoreUrl(wrapped, SANITIZE)).toBeNull();
  });

  it('rejects a wrapper without a uri parameter', () => {
    expect(sanitizeRestoreUrl(`${SUSPENDED_PREFIX}ttl=Docs`, SANITIZE)).toBeNull();
  });

  it('does not unwrap when suspendedPrefix is empty', () => {
    const url = 'https://a.com/?uri=https://b.com/';

    expect(sanitizeRestoreUrl(url, { ...SANITIZE, suspendedPrefix: '' })).toBe(url);
  });

  it('does not alter the url text (no normalization)', () => {
    expect(sanitizeRestoreUrl('https://Example.com', SANITIZE)).toBe('https://Example.com');
  });
});

describe('clampToScreen', () => {
  const screen = { availWidth: 1440, availHeight: 900 };

  it('returns bounds unchanged when fully on screen', () => {
    const bounds = { left: 100, top: 50, width: 800, height: 600 };

    expect(clampToScreen(bounds, screen)).toEqual(bounds);
  });

  it('moves a window with negative origin onto the screen and shrinks it', () => {
    expect(clampToScreen({ left: -200, top: -100, width: 800, height: 600 }, screen)).toEqual({
      left: 0,
      top: 0,
      width: 600,
      height: 500,
    });
  });

  it('shrinks a window that overflows the right/bottom edge', () => {
    expect(clampToScreen({ left: 1000, top: 700, width: 800, height: 600 }, screen)).toEqual({
      left: 1000,
      top: 700,
      width: 440,
      height: 200,
    });
  });

  it('returns undefined when the visible part is smaller than 200x200', () => {
    expect(clampToScreen({ left: 1300, top: 0, width: 800, height: 600 }, screen)).toBeUndefined();
    expect(clampToScreen({ left: 0, top: 750, width: 800, height: 600 }, screen)).toBeUndefined();
  });

  it('returns undefined for a window that is already tiny', () => {
    expect(clampToScreen({ left: 0, top: 0, width: 199, height: 600 }, screen)).toBeUndefined();
    expect(clampToScreen({ left: 5000, top: 0, width: 800, height: 100 }, screen)).toBeUndefined();
  });

  it('passes bounds through unchanged when they do not touch this screen (another monitor)', () => {
    const right = { left: 2000, top: 0, width: 800, height: 600 };
    const leftOf = { left: -1000, top: 100, width: 800, height: 600 };
    const above = { left: 100, top: -700, width: 800, height: 600 };
    const below = { left: 100, top: 900, width: 800, height: 600 };

    expect(clampToScreen(right, screen)).toEqual(right);
    expect(clampToScreen(leftOf, screen)).toEqual(leftOf);
    expect(clampToScreen(above, screen)).toEqual(above);
    expect(clampToScreen(below, screen)).toEqual(below);
  });

  it('treats a window touching the edge without overlapping as off-screen', () => {
    const bounds = { left: 1440, top: 0, width: 800, height: 600 };

    expect(clampToScreen(bounds, screen)).toEqual(bounds);
  });

  it('clamps into a screen whose origin is offset by availLeft/availTop', () => {
    // Secondary monitor to the right of a 1440-wide primary, with a 30px top bar.
    const secondary = { availLeft: 1440, availTop: 30, availWidth: 1920, availHeight: 1050 };

    const inside = { left: 1500, top: 100, width: 800, height: 600 };
    expect(clampToScreen(inside, secondary)).toEqual(inside);
    expect(clampToScreen({ left: 1000, top: 0, width: 800, height: 600 }, secondary)).toEqual({
      left: 1440,
      top: 30,
      width: 360,
      height: 570,
    });
    expect(clampToScreen({ left: 3000, top: 100, width: 800, height: 600 }, secondary)).toEqual({
      left: 3000,
      top: 100,
      width: 360,
      height: 600,
    });
    // Entirely on the primary: not this screen, so untouched.
    const primary = { left: 100, top: 100, width: 800, height: 600 };
    expect(clampToScreen(primary, secondary)).toEqual(primary);
  });
});

describe('screenRectOf', () => {
  it('copies availLeft/availTop when Chrome exposes them, and omits them otherwise', () => {
    const chromeScreen = { availLeft: 1440, availTop: 30, availWidth: 1920, availHeight: 1050 };
    const plainScreen = { availWidth: 1440, availHeight: 900 };
    const bogusScreen = { availLeft: 'x', availWidth: 1440, availHeight: 900 };

    expect(screenRectOf(chromeScreen)).toEqual({
      availLeft: 1440,
      availTop: 30,
      availWidth: 1920,
      availHeight: 1050,
    });
    expect(screenRectOf(plainScreen)).toEqual({ availWidth: 1440, availHeight: 900 });
    expect(screenRectOf(bogusScreen)).toEqual({ availWidth: 1440, availHeight: 900 });
  });
});

describe('isLazyRestore', () => {
  it("mirrors the planner: 'always' is lazy, 'never' is not, 'auto' is lazy above 50 tabs", () => {
    expect(isLazyRestore('always', 1)).toBe(true);
    expect(isLazyRestore('never', 500)).toBe(false);
    expect(isLazyRestore('auto', LAZY_AUTO_THRESHOLD)).toBe(false);
    expect(isLazyRestore('auto', LAZY_AUTO_THRESHOLD + 1)).toBe(true);
  });
});

describe('planRestore', () => {
  it('exposes the chunk size and lazy threshold constants', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(25);
    expect(LAZY_AUTO_THRESHOLD).toBe(50);
  });

  it('copies url, pinned, active and groupIndex into planned tabs', () => {
    const plan = planRestore(
      session([
        win(
          [
            tab({ url: 'https://a.com/', pinned: true }),
            tab({ url: 'https://b.com/', active: true, groupIndex: 0 }),
            tab({ url: 'https://c.com/' }),
          ],
          { groups: [{ title: 'G', color: 'blue', collapsed: false }] },
        ),
      ]),
      options(),
    );

    expect(plan.target).toEqual({ kind: 'newWindows' });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].tabs).toEqual([
      { url: 'https://a.com/', pinned: true, active: false },
      { url: 'https://b.com/', pinned: false, active: true, groupIndex: 0 },
      { url: 'https://c.com/', pinned: false, active: false },
    ]);
    expect(plan.windows[0].snapshot.groups[0].title).toBe('G');
    expect(plan.totalTabs).toBe(3);
    expect(plan.skipped).toEqual([]);
  });

  it('keeps the window target', () => {
    const plan = planRestore(
      session([win(urls(1))]),
      options({ target: { kind: 'window', windowId: 7 } }),
    );

    expect(plan.target).toEqual({ kind: 'window', windowId: 7 });
  });

  it('puts 25 tabs in a single chunk', () => {
    const plan = planRestore(session([win(urls(25))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25]);
  });

  it('splits 26 tabs into chunks of 25 and 1', () => {
    const plan = planRestore(session([win(urls(26))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25, 1]);
    expect(plan.windows[0].chunks.flat()).toEqual(plan.windows[0].tabs);
  });

  it('honours a custom chunkSize', () => {
    const plan = planRestore(session([win(urls(5))]), options({ chunkSize: 2 }));

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('chunks per window, not across windows', () => {
    const plan = planRestore(session([win(urls(30)), win(urls(3))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25, 5]);
    expect(plan.windows[1].chunks.map((c) => c.length)).toEqual([3]);
    expect(plan.totalTabs).toBe(33);
  });

  it('moves pinned tabs first, keeping relative order otherwise', () => {
    const plan = planRestore(
      session([
        win([
          tab({ url: 'https://u1.com/' }),
          tab({ url: 'https://p1.com/', pinned: true }),
          tab({ url: 'https://u2.com/' }),
          tab({ url: 'https://p2.com/', pinned: true }),
        ]),
      ]),
      options(),
    );

    expect(plan.windows[0].tabs.map((t) => t.url)).toEqual([
      'https://p1.com/',
      'https://p2.com/',
      'https://u1.com/',
      'https://u2.com/',
    ]);
  });

  it("lazy 'auto' is false at exactly 50 tabs and true at 51", () => {
    expect(planRestore(session([win(urls(50))]), options({ lazy: 'auto' })).windows[0].lazy).toBe(
      false,
    );
    expect(planRestore(session([win(urls(51))]), options({ lazy: 'auto' })).windows[0].lazy).toBe(
      true,
    );
  });

  it("lazy 'auto' counts tabs across all windows", () => {
    const plan = planRestore(session([win(urls(30)), win(urls(21))]), options({ lazy: 'auto' }));

    expect(plan.windows.map((w) => w.lazy)).toEqual([true, true]);
  });

  it("lazy 'auto' counts only tabs that survive sanitize", () => {
    const tabs = [...urls(50), tab({ url: 'javascript:alert(1)' })];

    expect(planRestore(session([win(tabs)]), options({ lazy: 'auto' })).windows[0].lazy).toBe(
      false,
    );
  });

  it("lazy 'always' is true even for one tab, 'never' is false even for many", () => {
    expect(planRestore(session([win(urls(1))]), options({ lazy: 'always' })).windows[0].lazy).toBe(
      true,
    );
    expect(planRestore(session([win(urls(200))]), options({ lazy: 'never' })).windows[0].lazy).toBe(
      false,
    );
  });

  it('collects skipped urls and keeps the remaining tabs', () => {
    const plan = planRestore(
      session([
        win(
          [
            tab({ url: 'https://ok.com/' }),
            tab({ url: 'javascript:alert(1)' }),
            tab({ url: 'file:///secret.html' }),
            tab({ url: 'chrome-extension://otherid/x.html', groupIndex: 0 }),
          ],
          { groups: [{ title: 'G', color: 'red', collapsed: true }] },
        ),
      ]),
      options(),
    );

    expect(plan.skipped).toEqual([
      'javascript:alert(1)',
      'file:///secret.html',
      'chrome-extension://otherid/x.html',
    ]);
    expect(plan.windows[0].tabs.map((t) => t.url)).toEqual(['https://ok.com/']);
    expect(plan.totalTabs).toBe(1);
  });

  it('records the unwrapped url for suspended tabs', () => {
    const plan = planRestore(
      session([win([tab({ url: `${SUSPENDED_PREFIX}uri=https://real.com/` })])]),
      options(),
    );

    expect(plan.windows[0].tabs[0].url).toBe('https://real.com/');
  });

  it('omits a window whose tabs were all skipped but still reports them', () => {
    const plan = planRestore(
      session([win([tab({ url: 'data:text/plain,x' })]), win([tab({ url: 'https://ok.com/' })])]),
      options(),
    );

    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].tabs[0].url).toBe('https://ok.com/');
    expect(plan.skipped).toEqual(['data:text/plain,x']);
  });

  it('returns an empty plan for a session with no restorable tabs', () => {
    const plan = planRestore(session([win([tab({ url: 'javascript:void(0)' })])]), options());

    expect(plan.windows).toEqual([]);
    expect(plan.totalTabs).toBe(0);
    expect(plan.skipped).toEqual(['javascript:void(0)']);
  });

  it('throws when a window has more than one active tab', () => {
    const broken = session([
      win([tab({ active: true }), tab({ url: 'https://b.com/', active: true })]),
    ]);

    expect(() => planRestore(broken, options())).toThrow(
      'Invariant violated: more than one active tab',
    );
  });

  it('throws when a pinned tab carries a groupIndex', () => {
    const broken = session([
      win([tab({ pinned: true, groupIndex: 0 })], {
        groups: [{ title: 'G', color: 'blue', collapsed: false }],
      }),
    ]);

    expect(() => planRestore(broken, options())).toThrow(
      'Invariant violated: pinned tab has groupIndex',
    );
  });

  it('throws when a groupIndex points outside the groups array', () => {
    const broken = session([win([tab({ groupIndex: 3 })])]);

    expect(() => planRestore(broken, options())).toThrow(
      'Invariant violated: groupIndex out of range',
    );
  });

  it('does not mutate the session', () => {
    const input = session([
      win([tab({ url: 'https://u.com/' }), tab({ url: 'https://p.com/', pinned: true })]),
    ]);
    const before = JSON.stringify(input);

    planRestore(input, options());

    expect(JSON.stringify(input)).toBe(before);
  });
});
