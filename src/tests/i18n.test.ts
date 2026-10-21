import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formatNumber, joinFacts, joinSentences, t, tp, uiLocale } from '@/lib/i18n';

import { getChromeFake, expandPlaceholders } from './chrome-fake';

/** The languages the extension ships in. English is `default_locale` and must have every key. */
const LOCALES = ['en', 'es', 'ja', 'ko'] as const;

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
  it('ships exactly the four languages', () => {
    expect(readdirSync(LOCALES_DIR).sort()).toEqual([...LOCALES]);
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
