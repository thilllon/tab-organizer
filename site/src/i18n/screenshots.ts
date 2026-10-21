import { DEFAULT_LOCALE, type Locale } from './locales';

// Every store screenshot: English at the top of assets/, the other UI languages in
// assets/<code>/ with the same file names (scripts/prepare-registration.ts, LOCALES=...).
const SHOTS = import.meta.glob<{ default: ImageMetadata }>('../../../assets/**/*.png', {
  eager: true,
});

/** The screenshot `name` with the extension in `locale`'s language, or the English one. */
export function screenshot(locale: Locale, name: string): ImageMetadata {
  const own =
    locale === DEFAULT_LOCALE ? undefined : SHOTS[`../../../assets/${locale}/${name}.png`];
  const found = own ?? SHOTS[`../../../assets/${name}.png`];
  if (found === undefined) {
    throw new Error(`assets/${name}.png is missing`);
  }
  return found.default;
}
