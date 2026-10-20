/**
 * Every string a person reads goes through here. The text lives in `public/_locales/<lang>/messages.json`
 * (copied to the extension root, where Chrome looks for it); `chrome.i18n` picks the browser's UI
 * language and falls back to English (`default_locale`) for a missing key, so English must always
 * have every key. Messages use `$1`..`$9` for substitutions (a literal dollar sign is `$$`).
 *
 * Chrome has no plural support, so a counted phrase is a family of keys, `<base>_one`,
 * `<base>_other` (and whatever else the language's plural rules use, such as Spanish `_many`).
 * `tp()` picks the key with `Intl.PluralRules` for the UI language and falls back to `_other`;
 * Korean and Japanese only ever need `_other`.
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

/** The browser's UI language as a BCP 47 tag (`en-US`, `ko`, `es-419`), for `Intl` and `lang`. */
export function uiLocale(): string {
  return chrome.i18n.getUILanguage();
}

let cachedRules: { locale: string; rules: Intl.PluralRules } | undefined;

function pluralRules(): Intl.PluralRules {
  const locale = uiLocale();
  if (cachedRules?.locale !== locale) {
    cachedRules = { locale, rules: new Intl.PluralRules(locale) };
  }
  return cachedRules.rules;
}

/** `n` with the UI language's digit grouping. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(uiLocale()).format(n);
}
