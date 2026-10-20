/**
 * Every string a person reads goes through here. The text lives in `public/_locales/<lang>/messages.json`
 * (copied to the extension root, where Chrome looks for it); `chrome.i18n` picks the browser's UI
 * language and falls back to English (`default_locale`) for a missing key, so English must always
 * have every key. Messages use `$1`..`$9` for substitutions (a literal dollar sign is `$$`).
 *
 * Chrome has no plural support, so a counted phrase is a family of keys, `<base>_one`,
 * `<base>_other` (and whatever else the language's plural rules use, such as Spanish `_many`).
 * `tp()` picks the key with `Intl.PluralRules` for the language of the text shown (`uiLocale()`,
 * the `localeCode` message) and falls back to `_other`; Korean and Japanese only ever need `_other`.
 */
import type enMessages from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof enMessages;

type PluralBaseOf<K> = K extends `${infer Base}_other` ? Base : never;
/** A key family `tp()` can count with: every `<base>_other` in the English messages. */
export type PluralBase = PluralBaseOf<MessageKey>;

type Substitution = string | number;

/** The message for `key` in the UI language, with `$1`.. filled in from `substitutions`. */
export function t(key: MessageKey, ...substitutions: Substitution[]): string {
  return chrome.i18n.getMessage(key, substitutions.map(String));
}

/**
 * A counted phrase: `$1` is `count` formatted for the UI language, `$2`.. are `extra`.
 * `tp('tabCount', 3)` is "3 tabs" in English and "탭 3개" in Korean.
 */
export function tp(base: PluralBase, count: number, ...extra: Substitution[]): string {
  const substitutions = [formatNumber(count), ...extra.map(String)];
  const exact = chrome.i18n.getMessage(`${base}_${pluralRules().select(count)}`, substitutions);
  return exact !== '' ? exact : chrome.i18n.getMessage(`${base}_other`, substitutions);
}

/**
 * The language the text is actually shown in, as a BCP 47 tag, for every `Intl` call and the
 * page's `lang`. Not `chrome.i18n.getUILanguage()`: for a Chrome language the extension does not
 * ship (French, Portuguese...) Chrome falls back to the English messages, and the plurals and
 * number formats must then be English too, or the page would read "1 234,5 tabs". So each
 * `messages.json` names its own language in `localeCode`, and whichever file Chrome picked answers.
 */
export function uiLocale(): string {
  return t('localeCode') || 'en';
}

/**
 * Two (or more) complete sentences as one text, the way the UI language puts sentences side by
 * side: a space in English, Korean and Spanish, nothing in Japanese. Empty sentences are left out.
 * Never use it to build a sentence out of fragments; that needs a message of its own.
 */
export function joinSentences(...sentences: string[]): string {
  return sentences
    .filter((sentence) => sentence !== '')
    .reduce(
      (joined, sentence) => (joined === '' ? sentence : t('commonSentenceJoin', joined, sentence)),
      '',
    );
}

/** Short facts on one line ("3 windows · 87 tabs"), separated the way the UI language does it. */
export function joinFacts(facts: readonly string[]): string {
  return facts
    .filter((fact) => fact !== '')
    .reduce((joined, fact) => (joined === '' ? fact : t('commonFactJoin', joined, fact)), '');
}

let cachedRules: { locale: string; rules: Intl.PluralRules } | undefined;
let cachedNumbers: { locale: string; format: Intl.NumberFormat } | undefined;

function pluralRules(): Intl.PluralRules {
  const locale = uiLocale();
  if (cachedRules?.locale !== locale) {
    cachedRules = { locale, rules: new Intl.PluralRules(locale) };
  }
  return cachedRules.rules;
}

/** `n` with the UI language's digit grouping. */
export function formatNumber(n: number): string {
  const locale = uiLocale();
  if (cachedNumbers?.locale !== locale) {
    cachedNumbers = { locale, format: new Intl.NumberFormat(locale) };
  }
  return cachedNumbers.format.format(n);
}
