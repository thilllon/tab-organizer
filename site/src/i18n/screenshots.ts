import { DEFAULT_LOCALE, type Locale } from './locales';

// Every store screenshot: English at the top of screenshots/, the other UI languages in
// screenshots/<code>/ with the same file names (scripts/prepare-registration.ts, LOCALES=...).
const SHOTS = import.meta.glob<{ default: ImageMetadata }>('../../../screenshots/**/*.png', {
  eager: true,
});

/** The screenshot `name` with the extension in `locale`'s language, or the English one. */
export function screenshot(locale: Locale, name: string): ImageMetadata {
  const own =
    locale === DEFAULT_LOCALE ? undefined : SHOTS[`../../../screenshots/${locale}/${name}.png`];
  const found = own ?? SHOTS[`../../../screenshots/${name}.png`];
  if (found === undefined) {
    throw new Error(`screenshots/${name}.png is missing`);
  }
  return found.default;
}
