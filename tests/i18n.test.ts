import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { formatNumber, t, tp } from '@/lib/i18n';

import { getChromeFake } from './chrome-fake';

/** The languages the extension ships in. English is `default_locale` and must have every key. */
const LOCALES = ['en', 'es', 'ja', 'ko'] as const;

interface LocaleMessage {
  message: string;
  description?: string;
}

const LOCALES_DIR = new URL('../public/_locales/', import.meta.url);

function load(locale: string): Record<string, LocaleMessage> {
  return JSON.parse(
    readFileSync(new URL(`${locale}/messages.json`, LOCALES_DIR), 'utf8'),
  ) as Record<string, LocaleMessage>;
}

/** The `$1`..`$9` a message substitutes, sorted, so word order may differ between languages. */
function substitutions(message: string): string[] {
  return [...message.replace(/\$\$/g, '').matchAll(/\$([1-9])/g)].map((m) => m[1]).sort();
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
          expect(substitutions(entry.message), `${locale}/${name}`).toEqual(
            substitutions(english.message),
          );
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
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
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
});
