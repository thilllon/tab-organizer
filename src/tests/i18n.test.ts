import { readdirSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUPPORTED_LOCALES } from '@/constants';
import {
  appliedUiLanguage,
  applyUiLanguage,
  expandPlaceholders as expandCatalogPlaceholders,
  formatMessage,
  formatNumber,
  joinFacts,
  joinSentences,
  type MessageKey,
  readPackagedCatalog,
  t,
  toCatalog,
  tp,
  uiLanguageReady,
  uiLocale,
} from '@/lib/i18n';

import {
  expandPlaceholders,
  fetchPackagedFile,
  getChromeFake,
  readLocaleFile,
} from './chrome-fake';

/** The languages the extension ships in. English is `default_locale` and must have every key. */
const LOCALES = SUPPORTED_LOCALES;

interface LocaleMessage {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string }>;
}

const LOCALES_DIR = new URL('../../public/_locales/', import.meta.url);

function load(locale: string): Record<string, LocaleMessage> {
  return JSON.parse(
    readFileSync(new URL(`${locale}/messages.json`, LOCALES_DIR), 'utf8'),
  ) as Record<string, LocaleMessage>;
}

/** The `$1`..`$9` a message substitutes, sorted, so word order may differ between languages. */
function substitutions(message: string): string[] {
  return [...message.replace(/\$\$/g, '').matchAll(/\$([1-9])/g)].map((m) => m[1]).sort();
}

/**
 * The named placeholders Chrome finds in `message`, scanning left to right as its message bundle
 * does: `$$` is an escaped dollar, otherwise text up to the next `$` is a placeholder name. That is
 * why "$1$2" fails (it reads a placeholder called "1") while "$FIRST$$SECOND$" is two names.
 */
function namedPlaceholders(message: string): string[] {
  const names: string[] = [];
  let at = message.indexOf('$');
  while (at !== -1) {
    if (message[at + 1] === '$') {
      at = message.indexOf('$', at + 2);
      continue;
    }
    if (/[1-9]/.test(message[at + 1] ?? '') && message[at + 2] !== '$') {
      at = message.indexOf('$', at + 2);
      continue;
    }
    const end = message.indexOf('$', at + 1);
    if (end === -1) {
      break;
    }
    names.push(message.slice(at + 1, end));
    at = message.indexOf('$', end + 1);
  }
  return names;
}

const en = load('en');
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);

describe('_locales', () => {
  it('ships exactly the languages of SUPPORTED_LOCALES', () => {
    expect(readdirSync(LOCALES_DIR).sort()).toEqual([...LOCALES].sort());
  });

  it('names every message the way Chrome accepts, and describes it for translators', () => {
    for (const [name, entry] of Object.entries(en)) {
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
      expect(entry.description?.trim(), name).toBeTruthy();
    }
  });

  it('pairs every counted key with an _other form', () => {
    for (const name of Object.keys(en)) {
      const match = /^(.+)_(zero|one|two|few|many)$/.exec(name);
      if (match !== null) {
        expect(en, name).toHaveProperty(`${match[1]}_other`);
      }
    }
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const messages = load(locale);

      it('has every English key and nothing else (plural forms vary by language)', () => {
        // Plural forms other than _other follow the language (Korean has none, Spanish adds _many),
        // so they are left out of the comparison; each must still belong to an English _other.
        const isPluralForm = (name: string) => /_(zero|one|two|few|many)$/.test(name);
        const withoutForms = (names: string[]) =>
          names.filter((name) => !isPluralForm(name)).sort();
        expect(withoutForms(Object.keys(messages))).toEqual(withoutForms(Object.keys(en)));
        for (const name of Object.keys(messages).filter(isPluralForm)) {
          expect(en, `${locale}/${name}`).toHaveProperty(name.replace(/_[a-z]+$/, '_other'));
        }
      });

      it('keeps the substitutions of the English text, and nothing is empty', () => {
        for (const [name, entry] of Object.entries(messages)) {
          expect(entry.message.trim(), `${locale}/${name}`).not.toBe('');
          const english = en[name] ?? en[name.replace(/_[a-z]+$/, '_other')];
          expect(substitutions(expandPlaceholders(entry)), `${locale}/${name}`).toEqual(
            substitutions(expandPlaceholders(english)),
          );
        }
      });

      it('defines every named placeholder, or Chrome refuses to load the extension', () => {
        for (const [name, entry] of Object.entries(messages)) {
          const defined = Object.keys(entry.placeholders ?? {}).map((key) => key.toLowerCase());
          const used = namedPlaceholders(entry.message).map((key) => key.toLowerCase());
          expect(
            used.filter((key) => !defined.includes(key)),
            `${locale}/${name}`,
          ).toEqual([]);
        }
      });

      it('uses no em or en dash', () => {
        for (const [name, entry] of Object.entries(messages)) {
          expect(LONG_DASH.test(entry.message), `${locale}/${name}`).toBe(false);
        }
      });

      it('fits the store limits: name 75, summary 132 characters', () => {
        expect(messages.extName.message.length).toBeLessThanOrEqual(75);
        expect(messages.extDescription.message.length).toBeLessThanOrEqual(132);
      });
    });
  }

  it('keeps the English summary equal to package.json, which the store listing reads', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      description: string;
    };
    expect(en.extDescription.message).toBe(pkg.description);
  });
});

describe('t / tp', () => {
  it('fills in substitutions', () => {
    expect(t('tabCount_other', 3)).toBe('3 tabs');
  });

  it('picks the plural form for the UI language', () => {
    expect(tp('tabCount', 1)).toBe('1 tab');
    expect(tp('tabCount', 1200)).toBe(`${formatNumber(1200)} tabs`);
    getChromeFake().setUiLanguage('ko');
    expect(tp('tabCount', 1)).toBe(t('tabCount_other', 1));
  });

  it('falls back to English for a language it does not ship', () => {
    getChromeFake().setUiLanguage('fr');
    expect(t('commonCancel')).toBe('Cancel');
  });

  it('counts and formats numbers the English way when the text fell back to English', () => {
    // French would pick "one" for 0 and group 1234 as "1 234"; the text shown is English.
    getChromeFake().setUiLanguage('fr');
    expect(uiLocale()).toBe('en');
    expect(tp('tabCount', 0)).toBe('0 tabs');
    expect(tp('tabCount', 1234)).toBe('1,234 tabs');
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });

  it('formats for the language of the file Chrome picked', () => {
    getChromeFake().setUiLanguage('es');
    expect(uiLocale()).toBe('es');
    expect(tp('tabCount', 1)).toBe(t('tabCount_one', 1));
    // Spanish ships no _many forms; a million falls back to _other.
    expect(tp('tabCount', 1_000_000)).toBe(t('tabCount_other', formatNumber(1_000_000)));
    getChromeFake().setUiLanguage('ja');
    expect(uiLocale()).toBe('ja');
  });
});

describe('localeCode', () => {
  it('names the language of each file', () => {
    for (const locale of LOCALES) {
      expect(load(locale).localeCode?.message).toBe(locale);
    }
  });
});

describe('joinSentences / joinFacts', () => {
  it('puts sentences side by side the way the language does', () => {
    expect(joinSentences('One.', 'Two.')).toBe('One. Two.');
    expect(joinSentences('One.', '', 'Three.')).toBe('One. Three.');
    expect(joinSentences('')).toBe('');
    getChromeFake().setUiLanguage('ja');
    expect(joinSentences('一。', '二。')).toBe('一。二。');
  });

  it('separates facts with a middle dot', () => {
    expect(joinFacts(['3 windows', '', '87 tabs', '2 KB'])).toBe('3 windows · 87 tabs · 2 KB');
    expect(joinFacts([])).toBe('');
  });
});

describe('formatMessage', () => {
  it('fills $1..$9, turns $$ into $ and leaves a missing substitution empty', () => {
    expect(formatMessage({ message: '$1 and $2' }, ['a', 'b'])).toBe('a and b');
    expect(formatMessage({ message: '$2 before $1' }, ['a', 'b'])).toBe('b before a');
    expect(formatMessage({ message: 'costs $$5 for $1' }, ['you'])).toBe('costs $5 for you');
    expect(formatMessage({ message: '$1|$3' }, ['a'])).toBe('a|');
    expect(formatMessage({ message: '$9' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9'])).toBe(
      '9',
    );
    expect(formatMessage({ message: 'no substitutions' }, ['ignored'])).toBe('no substitutions');
  });

  it('expands named placeholders first, in any case, as Chrome does on load', () => {
    const entry = {
      message: '$FIRST$$Second$',
      placeholders: { first: { content: '$1' }, second: { content: '$2' } },
    };
    expect(formatMessage(entry, ['一。', '二。'])).toBe('一。二。');
    expect(formatMessage({ message: '$UNKNOWN$ stays' }, [])).toBe('$UNKNOWN$ stays');
  });
});

describe('toCatalog', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      toCatalog({
        good: { message: 'Hi', description: 'x' },
        named: { message: '$A$', placeholders: { a: { content: '$1' }, bad: { nope: 1 } } },
        noMessage: { description: 'x' },
        wrong: 'text',
      }),
    ).toEqual({
      good: { message: 'Hi' },
      named: { message: '$A$', placeholders: { a: { content: '$1' } } },
    });
    expect(toCatalog(null)).toEqual({});
    expect(toCatalog(['x'])).toEqual({});
  });
});

describe('dollar signs in the shipped messages', () => {
  // Chrome (base::ReplaceStringPlaceholders) drops an invalid `$x`, `$0` or a trailing lone `$`,
  // while formatMessage() and the fake keep them. No shipped message may rely on either, so the
  // override and Chrome always agree: every `$` left after the named placeholders are expanded
  // is `$$` or `$1`..`$9`.
  for (const locale of LOCALES) {
    it(`${locale} uses only $$ and $1..$9`, async () => {
      const catalog = toCatalog(await readLocaleFile(locale));
      const stray = Object.entries(catalog).filter(([, entry]) =>
        expandCatalogPlaceholders(entry)
          .replace(/\$(\$|[1-9])/g, '')
          .includes('$'),
      );
      expect(stray.map(([name]) => name)).toEqual([]);
    });
  }

  it('catches a stray dollar sign', () => {
    const strays = ['$0', 'costs $', '$x', '$NAME$'].filter((message) =>
      expandCatalogPlaceholders({ message })
        .replace(/\$(\$|[1-9])/g, '')
        .includes('$'),
    );
    expect(strays).toEqual(['$0', 'costs $', '$x', '$NAME$']);
    expect(
      expandCatalogPlaceholders({
        message: '$Name$ $$1',
        placeholders: { name: { content: '$2' } },
      }),
    ).toBe('$2 $$1');
  });
});

/** Every English key, which every language has too (the _locales checks above). */
function messageKeys(): MessageKey[] {
  return Object.keys(en).filter((name): name is MessageKey => name in en);
}

const SAMPLE = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9'];

describe('a language chosen in Settings', () => {
  afterEach(async () => {
    await applyUiLanguage('auto');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const locale of LOCALES) {
    it(`reads ${locale} exactly as chrome.i18n would in a ${locale} Chrome`, async () => {
      const fake = getChromeFake();
      // Chrome's own language stays English: the text must come from the override.
      fake.setUiLanguage('en');
      await applyUiLanguage(locale, readLocaleFile);
      const ours = messageKeys().map((key) => [key, t(key, ...SAMPLE), t(key)]);

      fake.setUiLanguage(locale);
      await applyUiLanguage('auto');
      const chromes = messageKeys().map((key) => [
        key,
        chrome.i18n.getMessage(key, SAMPLE),
        chrome.i18n.getMessage(key, []),
      ]);
      expect(ours).toEqual(chromes);
    });
  }

  it('makes uiLocale, plurals and numbers follow the chosen language', async () => {
    getChromeFake().setUiLanguage('en');
    await applyUiLanguage('es', readLocaleFile);
    expect(uiLocale()).toBe('es');
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('es').format(1234.5));
    getChromeFake().setUiLanguage('es');
    const expected = chrome.i18n.getMessage('tabCount_one', [
      new Intl.NumberFormat('es').format(1),
    ]);
    getChromeFake().setUiLanguage('en');
    expect(tp('tabCount', 1)).toBe(expected);

    await applyUiLanguage('ja', readLocaleFile);
    expect(uiLocale()).toBe('ja');
    expect(joinSentences('一。', '二。')).toBe('一。二。');
  });

  it('falls back to English, key by key, for a message the language lacks', async () => {
    await applyUiLanguage('ko', async (locale) =>
      locale === 'ko' ? { commonCancel: { message: '취소' } } : readLocaleFile(locale),
    );
    expect(t('commonCancel')).toBe('취소');
    expect(t('commonClose')).toBe('Close');
  });

  it('reads English alone when English is chosen', async () => {
    const read = vi.fn(readLocaleFile);
    getChromeFake().setUiLanguage('ko');
    await applyUiLanguage('en', read);
    expect(read.mock.calls).toEqual([['en']]);
    expect(t('commonCancel')).toBe('Cancel');
    expect(uiLocale()).toBe('en');
  });

  it("'auto' hands the text back to Chrome", async () => {
    getChromeFake().setUiLanguage('ja');
    await applyUiLanguage('ko', readLocaleFile);
    expect(uiLocale()).toBe('ko');
    await applyUiLanguage('auto');
    expect(uiLocale()).toBe('ja');
  });

  it('keeps Chrome language when a file cannot be read, and never rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getChromeFake().setUiLanguage('es');
    await expect(
      applyUiLanguage('ko', async () => {
        throw new Error('gone');
      }),
    ).resolves.toBeUndefined();
    expect(uiLocale()).toBe('es');
    // The menu in Settings then shows Automatic, the language the page is really in.
    expect(appliedUiLanguage()).toBe('auto');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports the choice in use', async () => {
    expect(appliedUiLanguage()).toBe('auto');
    await applyUiLanguage('ja', readLocaleFile);
    expect(appliedUiLanguage()).toBe('ja');
    await applyUiLanguage('auto');
    expect(appliedUiLanguage()).toBe('auto');
  });

  it('waits for a choice that is still being read, and the latest choice wins', async () => {
    let answer: (value: 'ko') => void = () => undefined;
    const pending = new Promise<'ko'>((resolve) => {
      answer = resolve;
    });
    const slow = applyUiLanguage(pending, readLocaleFile);
    let settled = false;
    void uiLanguageReady().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const fast = applyUiLanguage('ja', readLocaleFile);
    answer('ko');
    await Promise.all([slow, fast, uiLanguageReady()]);
    expect(uiLocale()).toBe('ja');
  });

  it('fetches the packaged file from the extension root', async () => {
    const fetchSpy = vi.fn(fetchPackagedFile);
    vi.stubGlobal('fetch', fetchSpy);
    await expect(readPackagedCatalog('ko')).resolves.toEqual(await readLocaleFile('ko'));
    expect(fetchSpy).toHaveBeenCalledWith('chrome-extension://fakeextid/_locales/ko/messages.json');

    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(readPackagedCatalog('es')).rejects.toThrow('HTTP 404');
  });
});
