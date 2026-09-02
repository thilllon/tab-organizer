import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { toHtml, toJson, toMarkdown, toText } from './export';
import { contentHash } from './hash';
import {
  decodeEntities,
  detectFormat,
  importSessions,
  parseJson,
  parseNetscapeHtml,
  parsers,
  parseTextOrMarkdown,
} from './import';

const NOW = 1_800_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const fixture: Session = {
  schemaVersion: 1,
  id: 'a1',
  kind: 'saved',
  name: 'Work',
  origin: 'manual',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_050_000,
  contentHash: 'cafe0000',
  windows: [
    {
      state: 'normal',
      focused: true,
      bounds: { left: 10, top: 20, width: 800, height: 600 },
      groups: [
        { title: 'Dev', color: 'blue', collapsed: true },
        { title: 'Docs', color: 'green', collapsed: false },
      ],
      tabs: [
        { url: 'https://pinned.test/', title: 'Pinned', pinned: true, active: false },
        { url: 'https://a.test/', title: 'A & B', pinned: false, active: true },
        { url: 'https://b.test/?x=1&y=2', title: 'B', pinned: false, active: false, groupIndex: 0 },
        { url: 'https://c.test/', title: 'C', pinned: false, active: false, groupIndex: 0 },
        { url: 'https://d.test/', title: '<D>', pinned: false, active: false, groupIndex: 1 },
      ],
    },
    {
      state: 'maximized',
      focused: false,
      groups: [],
      tabs: [{ url: 'https://e.test/', title: 'E', pinned: false, active: true }],
    },
  ],
};

/** Strips the fields an import legitimately rewrites so the rest can be compared exactly. */
function stable(
  session: Session,
): Omit<Session, 'id' | 'origin' | 'name' | 'createdAt' | 'updatedAt'> {
  const { id: _id, origin: _origin, name: _name, createdAt: _c, updatedAt: _u, ...rest } = session;
  return rest;
}

describe('detectFormat', () => {
  it('recognises JSON objects and arrays', () => {
    expect(detectFormat('  {"app":"tab-organizer"}')).toBe('json');
    expect(detectFormat('[{"id":"a"}]')).toBe('json');
    expect(detectFormat('["https://a.test"]')).toBe('json');
    expect(detectFormat('\uFEFF\n{}')).toBe('json'); // trim() strips a leading BOM
  });

  it('recognises Netscape bookmark HTML', () => {
    expect(detectFormat('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>')).toBe('html');
    expect(detectFormat('<!doctype netscape-bookmark-file-1>')).toBe('html');
    expect(detectFormat('<DL><p><DT><A HREF="https://a.test">A</A></DL>')).toBe('html');
    expect(detectFormat('<dl><dt><a href="https://a.test">A</a></dl>')).toBe('html');
  });

  it('recognises Markdown by a leading heading or a link, even one at the very start', () => {
    expect(detectFormat('# Links\nhttps://a.test')).toBe('markdown');
    expect(detectFormat('- [A](https://a.test)')).toBe('markdown');
    expect(detectFormat('[A](https://a.test)')).toBe('markdown');
    expect(detectFormat('see [the docs](https://docs.test) please')).toBe('markdown');
  });

  it('falls back to text when any URL is present and null otherwise', () => {
    expect(detectFormat('https://a.test')).toBe('text');
    expect(detectFormat('read this: http://a.test/x and file:///tmp/x.html')).toBe('text');
    expect(detectFormat('chrome://extensions')).toBe('text');
    expect(detectFormat('')).toBe(null);
    expect(detectFormat('   \n\t ')).toBe(null);
    expect(detectFormat('no links here')).toBe(null);
    expect(detectFormat('chrome-extension://abc/page.html')).toBe(null);
  });
});

describe('parseJson', () => {
  it('round-trips an export bundle exactly except id, origin, name suffix and timestamps', () => {
    const sessions = parseJson(toJson([fixture], 5), NOW);
    expect(sessions).not.toBeNull();
    expect(sessions).toHaveLength(1);
    const [imported] = sessions ?? [];
    expect(imported).toBeDefined();
    if (imported === undefined) {
      return;
    }
    expect(stable(imported)).toEqual(stable(fixture));
    expect(imported.id).toMatch(UUID);
    expect(imported.id).not.toBe(fixture.id);
    expect(imported.origin).toBe('import');
    expect(imported.kind).toBe('saved');
    expect(imported.name).toBe('Work (imported)');
    expect(imported.createdAt).toBe(NOW);
    expect(imported.updatedAt).toBe(NOW);
  });

  it('gives every imported session its own fresh id', () => {
    const sessions = parseJson(toJson([fixture, fixture], 5), NOW) ?? [];
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).not.toBe(sessions[1]?.id);
  });

  it('accepts a bare session and an array of sessions', () => {
    expect(parseJson(JSON.stringify(fixture), NOW)?.map((s) => s.name)).toEqual([
      'Work (imported)',
    ]);
    expect(
      parseJson(JSON.stringify([fixture, { ...fixture, name: 'Play' }]), NOW)?.map((s) => s.name),
    ).toEqual(['Work (imported)', 'Play (imported)']);
  });

  it('turns history sessions into saved ones, dropping protected and unknown fields', () => {
    const history = { ...fixture, kind: 'history', protected: true, extra: 'ignored' };
    const [imported] = parseJson(JSON.stringify(history), NOW) ?? [];
    expect(imported?.kind).toBe('saved');
    expect(imported).not.toHaveProperty('protected');
    expect(imported).not.toHaveProperty('extra');
    expect(imported?.contentHash).toBe('cafe0000');
  });

  it('rejects malformed JSON, non-session JSON and bundles with an invalid session', () => {
    expect(parseJson('{"app": "tab-organizer", "sessions": [', NOW)).toBeNull();
    expect(parseJson('{"hello": "world"}', NOW)).toBeNull();
    expect(parseJson('[1, 2, 3]', NOW)).toBeNull();
    expect(parseJson(JSON.stringify({ ...fixture, schemaVersion: 2 }), NOW)).toBeNull();
    const bundle = JSON.parse(toJson([fixture], 5)) as { sessions: unknown[] };
    bundle.sessions.push({ ...fixture, windows: [{ state: 'normal' }] });
    expect(parseJson(JSON.stringify(bundle), NOW)).toBeNull();
  });

  it('returns null for input that is not JSON at all', () => {
    expect(parseJson('https://a.test', NOW)).toBeNull();
    expect(parseJson('', NOW)).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones alone', () => {
    expect(decodeEntities('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#x41;&#66;')).toBe(
      'A & B <C> "D" \'E\' AB',
    );
    expect(decodeEntities('&bogus; &#1114112;')).toBe('&bogus; &#1114112;');
  });
});

describe('parseNetscapeHtml', () => {
  it('round-trips the structure of an exported HTML file', () => {
    const sessions = parseNetscapeHtml(toHtml([fixture]), NOW);
    expect(sessions).toHaveLength(1);
    const [imported] = sessions ?? [];
    expect(imported).toBeDefined();
    if (imported === undefined) {
      return;
    }
    expect(imported.name).toBe('Work');
    expect(imported.origin).toBe('import');
    expect(imported.kind).toBe('saved');
    expect(imported.id).toMatch(UUID);
    expect(imported.createdAt).toBe(NOW);
    expect(imported.windows).toEqual([
      {
        state: 'normal',
        focused: true,
        groups: [
          { title: 'Dev', color: 'grey', collapsed: false },
          { title: 'Docs', color: 'grey', collapsed: false },
        ],
        tabs: [
          { url: 'https://pinned.test/', title: 'Pinned', pinned: false, active: true },
          { url: 'https://a.test/', title: 'A & B', pinned: false, active: false },
          {
            url: 'https://b.test/?x=1&y=2',
            title: 'B',
            pinned: false,
            active: false,
            groupIndex: 0,
          },
          { url: 'https://c.test/', title: 'C', pinned: false, active: false, groupIndex: 0 },
          { url: 'https://d.test/', title: '<D>', pinned: false, active: false, groupIndex: 1 },
        ],
      },
      {
        state: 'normal',
        focused: false,
        groups: [],
        tabs: [{ url: 'https://e.test/', title: 'E', pinned: false, active: true }],
      },
    ]);
    expect(imported.contentHash).toBe(contentHash(imported.windows));
  });

  it('collects top-level links into an "Imported bookmarks" session', () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '  <DT><A HREF="https://a.test/">A</A>',
      '  <DT><A ADD_DATE="1" HREF=\'https://b.test/\'>B</A>',
      '</DL><p>',
    ].join('\n');
    expect(parseNetscapeHtml(html, NOW)).toEqual([
      {
        schemaVersion: 1,
        id: expect.stringMatching(UUID),
        kind: 'saved',
        name: 'Imported bookmarks',
        origin: 'import',
        createdAt: NOW,
        updatedAt: NOW,
        contentHash: expect.any(String),
        windows: [
          {
            state: 'normal',
            focused: true,
            groups: [],
            tabs: [
              { url: 'https://a.test/', title: 'A', pinned: false, active: true },
              { url: 'https://b.test/', title: 'B', pinned: false, active: false },
            ],
          },
        ],
      },
    ]);
  });

  it('tolerates lowercase tags, attribute order, missing <p>, nested markup and entities', () => {
    const html = [
      '<dl>',
      '<dt><h3 add_date="1" personal_toolbar_folder="true">Bookmarks &amp; bar</h3>',
      '<dl>',
      '  <dt><a href="https://a.test/?q=1&amp;r=2" icon="data:x">Tom &amp; <i>Jerry</i></a>',
      '  <dt><h3>Folder</h3>',
      '  <dl>',
      '    <dt><a add_date="2" href="https://b.test/">B &#39;quoted&#39;</a>',
      '    <dt><h3>Deep</h3>',
      '    <dl>',
      '      <dt><a href="https://c.test/">C</a>',
      '      <dt><h3>Deeper</h3>',
      '      <dl><dt><a href="https://d.test/">D</a></dl>',
      '    </dl>',
      '  </dl>',
      '</dl>',
      '</dl>',
    ].join('\n');
    const [session] = parseNetscapeHtml(html, NOW) ?? [];
    expect(session?.name).toBe('Bookmarks & bar');
    expect(session?.windows).toEqual([
      {
        state: 'normal',
        focused: true,
        groups: [],
        tabs: [
          { url: 'https://a.test/?q=1&r=2', title: 'Tom & Jerry', pinned: false, active: true },
        ],
      },
      {
        state: 'normal',
        focused: false,
        groups: [{ title: 'Deep', color: 'grey', collapsed: false }],
        tabs: [
          { url: 'https://b.test/', title: "B 'quoted'", pinned: false, active: true },
          { url: 'https://c.test/', title: 'C', pinned: false, active: false, groupIndex: 0 },
          { url: 'https://d.test/', title: 'D', pinned: false, active: false, groupIndex: 0 },
        ],
      },
    ]);
  });

  it('skips empty folders, links without an href, and returns null when nothing remains', () => {
    const html = [
      '<DL><p>',
      '  <DT><H3>Empty session</H3>',
      '  <DL><p>',
      '    <DT><H3>Empty window</H3>',
      '    <DL><p></DL><p>',
      '  </DL><p>',
      '  <DT><H3>Real</H3>',
      '  <DL><p>',
      '    <DT><H3>Window</H3>',
      '    <DL><p>',
      '      <DT><A NAME="no-href">nothing</A>',
      '      <DT><H3>Empty group</H3>',
      '      <DL><p></DL><p>',
      '      <DT><A HREF="https://a.test/">A</A>',
      '    </DL><p>',
      '  </DL><p>',
      '</DL><p>',
    ].join('\n');
    const sessions = parseNetscapeHtml(html, NOW);
    expect(sessions?.map((s) => s.name)).toEqual(['Real']);
    expect(sessions?.[0]?.windows).toEqual([
      {
        state: 'normal',
        focused: true,
        groups: [],
        tabs: [{ url: 'https://a.test/', title: 'A', pinned: false, active: true }],
      },
    ]);
    expect(parseNetscapeHtml('<DL><p><DT><H3>Nothing</H3><DL><p></DL><p></DL><p>', NOW)).toBeNull();
  });

  it('returns null for input that is not bookmark HTML', () => {
    expect(parseNetscapeHtml('https://a.test', NOW)).toBeNull();
    expect(parseNetscapeHtml(JSON.stringify(fixture), NOW)).toBeNull();
  });
});

describe('parseTextOrMarkdown', () => {
  it('creates a one-window session from a pasted URL list', () => {
    const sessions = parseTextOrMarkdown('https://a.test/\nhttps://b.test/path?q=1\n', NOW);
    expect(sessions).toEqual([
      {
        schemaVersion: 1,
        id: expect.stringMatching(UUID),
        kind: 'saved',
        name: 'Imported links',
        origin: 'import',
        createdAt: NOW,
        updatedAt: NOW,
        contentHash: expect.any(String),
        windows: [
          {
            state: 'normal',
            focused: true,
            groups: [],
            tabs: [
              { url: 'https://a.test/', title: '', pinned: false, active: true },
              { url: 'https://b.test/path?q=1', title: '', pinned: false, active: false },
            ],
          },
        ],
      },
    ]);
  });

  it('splits blank-line-separated blocks into windows and ignores lines without URLs', () => {
    const text = [
      'Shopping list',
      'https://a.test/',
      '',
      '',
      'notes only',
      '   ',
      'https://b.test/ and https://c.test/.',
      'Window 3 heading\r\n',
    ].join('\n');
    const [session] = parseTextOrMarkdown(text, NOW) ?? [];
    expect(session?.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a.test/'],
      ['https://b.test/', 'https://c.test/'],
    ]);
    expect(session?.windows.map((w) => w.focused)).toEqual([true, false]);
  });

  it('keeps Markdown titles (unescaped), honours the pinned marker and moves pinned tabs first', () => {
    const text = [
      '# Reading',
      '- [Plain](https://a.test/)',
      '- [\\[Draft\\] Foo \\\\ bar](https://en.wikipedia.org/wiki/Foo_(bar))',
      '- [Pinned one](https://p.test/) (pinned)',
      '- [Anchor only](#top)',
      '- <https://bare.test/>',
    ].join('\n');
    const [session] = parseTextOrMarkdown(text, NOW) ?? [];
    expect(session?.windows).toHaveLength(1);
    expect(session?.windows[0]?.tabs).toEqual([
      { url: 'https://p.test/', title: 'Pinned one', pinned: true, active: true },
      { url: 'https://a.test/', title: 'Plain', pinned: false, active: false },
      {
        url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        title: '[Draft] Foo \\ bar',
        pinned: false,
        active: false,
      },
      { url: 'https://bare.test/', title: '', pinned: false, active: false },
    ]);
  });

  it('trims sentence punctuation after bare URLs but keeps balanced parens', () => {
    const text =
      'See https://a.test/x, then (https://b.test/y) or https://en.wikipedia.org/wiki/Foo_(bar). Done: "https://c.test/"!';
    const [session] = parseTextOrMarkdown(text, NOW) ?? [];
    expect(session?.windows[0]?.tabs.map((t) => t.url)).toEqual([
      'https://a.test/x',
      'https://b.test/y',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://c.test/',
    ]);
  });

  it('accepts the other Chrome-openable schemes and returns null without URLs', () => {
    const [session] =
      parseTextOrMarkdown('ftp://f.test/ file:///tmp/a.html chrome://extensions', NOW) ?? [];
    expect(session?.windows[0]?.tabs.map((t) => t.url)).toEqual([
      'ftp://f.test/',
      'file:///tmp/a.html',
      'chrome://extensions',
    ]);
    expect(parseTextOrMarkdown('# heading without links', NOW)).toBeNull();
    expect(parseTextOrMarkdown(JSON.stringify(fixture), NOW)).toBeNull();
  });

  it('round-trips the windows and titles of a Markdown export', () => {
    const [session] = parseTextOrMarkdown(toMarkdown([fixture]), NOW) ?? [];
    expect(session?.windows.map((w) => w.tabs.map((t) => [t.title, t.url, t.pinned]))).toEqual([
      [
        ['Pinned', 'https://pinned.test/', true],
        ['A & B', 'https://a.test/', false],
        ['B', 'https://b.test/?x=1&y=2', false],
        ['C', 'https://c.test/', false],
        ['<D>', 'https://d.test/', false],
      ],
      [['E', 'https://e.test/', false]],
    ]);
  });

  it('round-trips the windows of a text export', () => {
    const [session] = parseTextOrMarkdown(toText([fixture]), NOW) ?? [];
    expect(session?.windows.map((w) => w.tabs.map((t) => t.url))).toEqual(
      fixture.windows.map((w) => w.tabs.map((t) => t.url)),
    );
  });
});

describe('importSessions', () => {
  it('exposes the parser chain in order', () => {
    expect(parsers).toEqual([parseJson, parseNetscapeHtml, parseTextOrMarkdown]);
  });

  it('reports the detected format and the parsed sessions', () => {
    const result = importSessions(toJson([fixture], 5), NOW);
    expect(result.format).toBe('json');
    if (result.format === null) {
      return;
    }
    expect(result.sessions.map((s) => s.name)).toEqual(['Work (imported)']);
    expect(result.warnings).toEqual([]);
    expect(importSessions(toHtml([fixture]), NOW).format).toBe('html');
    expect(importSessions(toMarkdown([fixture]), NOW).format).toBe('markdown');
    expect(importSessions(toText([fixture]), NOW).format).toBe('text');
  });

  it('rejects malformed JSON with a message instead of scraping its URLs', () => {
    const result = importSessions(
      '{"app":"tab-organizer","sessions":[{"url":"https://a.test"}',
      NOW,
    );
    expect(result.format).toBeNull();
    expect(result.format === null && result.error).toMatch(/^Malformed JSON: /);
  });

  it('explains invalid bundles, unsupported versions and foreign JSON', () => {
    const bundle = JSON.parse(toJson([fixture, fixture], 5)) as { sessions: unknown[] };
    bundle.sessions[1] = { ...fixture, windows: 'nope' };
    const invalid = importSessions(JSON.stringify(bundle), NOW);
    expect(invalid.format === null && invalid.error).toBe(
      'Session 2 is not a valid Tab Organizer session record.',
    );

    const newer = importSessions(JSON.stringify({ ...fixture, schemaVersion: 2 }), NOW);
    expect(newer.format === null && newer.error).toBe(
      'Unsupported session schema version 2 (this version reads 1).',
    );

    const foreign = importSessions('{"tabs": ["https://a.test"]}', NOW);
    expect(foreign.format === null && foreign.error).toBe(
      'Session 1 is not a valid Tab Organizer session record.',
    );

    const noList = importSessions('{"app": "tab-organizer"}', NOW);
    expect(noList.format === null && noList.error).toBe(
      'The export bundle has no "sessions" list.',
    );

    const empty = importSessions(toJson([], 5), NOW);
    expect(empty.format === null && empty.error).toBe('The export contains no sessions.');
    expect(importSessions('[]', NOW)).toEqual({
      format: null,
      error: 'The export contains no sessions.',
    });
  });

  it('reports empty input, link-less text and empty bookmark files', () => {
    expect(importSessions('   ', NOW)).toEqual({
      format: null,
      error: expect.stringMatching(/^Nothing to import/),
    });
    expect(importSessions('# just a heading', NOW)).toEqual({
      format: null,
      error: 'No URLs were found.',
    });
    expect(importSessions('<DL><p></DL><p>', NOW)).toEqual({
      format: null,
      error: 'No bookmarks were found in the HTML.',
    });
  });

  it('warns about sessions without windows and windows without tabs', () => {
    const empty: Session = { ...fixture, name: 'Empty', windows: [] };
    const hollow: Session = {
      ...fixture,
      name: 'Hollow',
      windows: [{ state: 'normal', focused: true, groups: [], tabs: [] }],
    };
    const result = importSessions(toJson([empty, hollow], 5), NOW);
    expect(result.format === 'json' && result.warnings).toEqual([
      '"Empty (imported)" has no windows.',
      '"Hollow (imported)": window 1 has no tabs.',
    ]);
  });
});
