import { getAbsoluteLocaleUrl, getRelativeLocaleUrl } from 'astro:i18n';

/** Must match `i18n.locales` in astro.config.ts. English is the default and has no prefix. */
export const LOCALES = ['en', 'ko', 'es', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's name in that language, as the language switch shows it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ko: '한국어',
  es: 'Español',
  ja: '日本語',
};

/** `og:locale` values. */
export const OG_LOCALES: Record<Locale, string> = {
  en: 'en_US',
  ko: 'ko_KR',
  es: 'es_419',
  ja: 'ja_JP',
};

export const PAGES = ['home', 'support', 'privacy'] as const;
export type Page = (typeof PAGES)[number];

const SLUGS: Record<Page, string> = {
  home: '',
  support: 'support/',
  privacy: 'privacy/',
};

/** Root-relative URL of a page in a language, base path included: `/tab-organizer/ko/support/`. */
export function pageUrl(locale: Locale, page: Page): string {
  return getRelativeLocaleUrl(locale, SLUGS[page]);
}

/** The same URL, absolute, for canonical links, hreflang alternates and Open Graph. */
export function absolutePageUrl(locale: Locale, page: Page): string {
  return getAbsoluteLocaleUrl(locale, SLUGS[page]);
}

/** `getStaticPaths()` result shared by every page under `[...locale]`. */
export function localePaths() {
  return LOCALES.map((locale) => ({
    params: { locale: locale === DEFAULT_LOCALE ? undefined : locale },
    props: { locale },
  }));
}

export const STORE_URL =
  'https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg';
export const REPO_URL = 'https://github.com/thilllon/tab-organizer';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new`;
export const RELEASES_URL = `${REPO_URL}/releases`;
