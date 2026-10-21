/**
 * Reads the Chrome Web Store text out of `REGISTRATION.md`.
 *
 * The store's "Description" field takes plain text only, so that file keeps every description
 * already in store form inside a fenced block: `### Description` for English (the default
 * language) and `### Description (<code>)` for each translation. The Summary of each language sits
 * the same way under `### Summary` / `### Summary (<code>)`, and must equal that language's
 * `extDescription` in `public/_locales/<code>/messages.json`: the store reads the Summary out of
 * the package, so the block in the listing is only a copy for review. What is in a block is what
 * gets pasted, nothing is generated from it. This module finds the blocks and holds the length
 * limits the store enforces; `tests/store-listing.test.ts` checks the real files on every
 * `pnpm test`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Limit for the "Description" field, set by the owner: nobody reads a long store description, so
 * it is a hook, a few lines and a link to the website. The store itself allows 16,000.
 */
export const DESCRIPTION_MAX_CHARS = 500;
/** Chrome Web Store limit for the "Summary" field (manifest `description`). */
export const CWS_SUMMARY_MAX_CHARS = 132;

/**
 * The languages the listing is written in, default first. Each is a folder of `public/_locales/`,
 * so Chrome and the store offer exactly these.
 */
export const LISTING_LOCALES = ['en', 'ko', 'es', 'ja'] as const;
export type ListingLocale = (typeof LISTING_LOCALES)[number];
/** The manifest's `default_locale`: the listing every language without its own falls back to. */
export const DEFAULT_LISTING_LOCALE: ListingLocale = 'en';

/** English names, for headings in SUBMIT.md and log lines. */
export const LOCALE_NAMES: Record<ListingLocale, string> = {
  en: 'English',
  ko: 'Korean',
  es: 'Spanish',
  ja: 'Japanese',
};

const FENCE = '```';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LISTING_SOURCE = path.resolve(__dirname, '..', 'REGISTRATION.md');
export const LOCALES_SOURCE = path.resolve(__dirname, '..', 'public', '_locales');

export function isListingLocale(code: string): code is ListingLocale {
  return (LISTING_LOCALES as readonly string[]).includes(code);
}

/** `### Description` for the default language, `### Description (ko)` for the others. */
export function descriptionHeading(locale: ListingLocale = DEFAULT_LISTING_LOCALE): string {
  return locale === DEFAULT_LISTING_LOCALE ? '### Description' : `### Description (${locale})`;
}

/** `### Summary` for the default language, `### Summary (ko)` for the others. */
export function summaryHeading(locale: ListingLocale = DEFAULT_LISTING_LOCALE): string {
  return locale === DEFAULT_LISTING_LOCALE ? '### Summary' : `### Summary (${locale})`;
}

/**
 * Returns the text of the first fenced block under `heading` (matched as the whole line), without
 * the fences. Throws when the heading or a complete block is missing before the next heading.
 */
export function extractBlock(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`Heading "${heading}" not found in the store listing`);
  }
  let open = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(FENCE)) {
      if (open === -1) {
        open = i;
        continue;
      }
      return lines.slice(open + 1, i).join('\n');
    }
    // Inside the block a line starting with # is store text; outside it, the section has ended.
    if (open === -1 && /^#{1,3}\s/.test(line)) {
      break;
    }
  }
  throw new Error(`No fenced block under "${heading}" in the store listing`);
}

/** The plain-text Description of one language. */
export function extractDescription(
  markdown: string,
  locale: ListingLocale = DEFAULT_LISTING_LOCALE,
): string {
  return extractBlock(markdown, descriptionHeading(locale));
}

/** The Summary of one language, as the listing shows it (one line). */
export function extractSummary(
  markdown: string,
  locale: ListingLocale = DEFAULT_LISTING_LOCALE,
): string {
  return extractBlock(markdown, summaryHeading(locale)).trim();
}

export interface LocalizedListing {
  locale: ListingLocale;
  summary: string;
  description: string;
}

/** Every language's Summary and Description, default language first. */
export function extractListings(markdown: string): LocalizedListing[] {
  return LISTING_LOCALES.map((locale) => ({
    locale,
    summary: extractSummary(markdown, locale),
    description: extractDescription(markdown, locale),
  }));
}

interface MessageEntry {
  message: string;
}

/**
 * One message of `<localesDir>/<locale>/messages.json`, or `undefined` when the file or the key is
 * missing. Chrome matches message names case-insensitively, so this does too.
 */
export function readLocaleMessage(
  localesDir: string,
  locale: string,
  key: string,
): string | undefined {
  let messages: Record<string, MessageEntry | undefined>;
  try {
    messages = JSON.parse(readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf-8'));
  } catch {
    return undefined;
  }
  const exact = messages[key];
  if (exact !== undefined) {
    return exact.message;
  }
  const lower = key.toLowerCase();
  const loose = Object.entries(messages).find(([name]) => name.toLowerCase() === lower);
  return loose?.[1]?.message;
}

export function validateDescription(description: string): void {
  if (description.length > DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `Description is ${description.length.toLocaleString('en-US')} characters; the Chrome Web Store is kept to at most ${DESCRIPTION_MAX_CHARS}`,
    );
  }
}

/** The store "Summary" is the manifest `description`, which comes from `extDescription`. */
export function validateSummary(summary: string): void {
  if (summary.length > CWS_SUMMARY_MAX_CHARS) {
    throw new Error(
      `Summary is ${summary.length} characters; the Chrome Web Store allows at most ${CWS_SUMMARY_MAX_CHARS}`,
    );
  }
}
