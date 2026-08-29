/**
 * Chrome Web Store listing builder.
 *
 * `docs/README.md` is the single source of truth for the store listing. The
 * store's "Description" field only accepts plain text, so this script extracts
 * the `### Description` section from that file, converts the Markdown to the
 * plain-text conventions the store uses (UPPER-CASE section titles, ▸ feature
 * titles, • bullets) and writes it to `docs/description.txt`, ready to paste.
 *
 * Runs on every commit (lefthook) and during `pnpm release` so the generated
 * file never drifts from the Markdown.
 *
 *   pnpm listing
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Constants
 */

/** Chrome Web Store limit for the "Description" field. */
export const CWS_DESCRIPTION_MAX_CHARS = 16_000;
/** Chrome Web Store limit for the "Summary" field (manifest `description`). */
export const CWS_SUMMARY_MAX_CHARS = 132;

const DESCRIPTION_HEADING = '### Description';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const LISTING_SOURCE = path.join(ROOT, 'docs', 'README.md');
export const DESCRIPTION_OUTPUT = path.join(ROOT, 'docs', 'description.txt');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

/*
 * Pure conversion
 */

function headingLevel(line: string): number {
  const match = /^(#{1,6})\s/.exec(line);
  return match ? match[1].length : 0;
}

/**
 * Returns the Markdown body under `heading` (exact line match), up to but not
 * including the next heading of the same or a higher level.
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`Heading "${heading}" not found in listing source`);
  }
  const level = headingLevel(heading);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const lineLevel = headingLevel(line);
    if (lineLevel > 0 && lineLevel <= level) {
      break;
    }
    body.push(line);
  }
  return body.join('\n').trim();
}

function convertInline(text: string): string {
  return (
    text
      // [text](url) -> text (url)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
      // **bold** / __bold__
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      // *italic* / _italic_ (word-bounded so file_names and 2*3 survive)
      .replace(/(^|\s)\*(?!\s)([^*]+?)\*(?=[\s.,;:!?)]|$)/g, '$1$2')
      .replace(/(^|\s)_(?!\s)([^_]+?)_(?=[\s.,;:!?)]|$)/g, '$1$2')
      // `code`
      .replace(/`([^`]+)`/g, '$1')
      // Markdown escapes such as \* \_ \# produced by prettier
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
  );
}

function convertLine(line: string): string {
  const heading4 = /^####\s+(.*)$/.exec(line);
  if (heading4) {
    return convertInline(heading4[1]).toUpperCase();
  }
  const heading5 = /^#####\s+(.*)$/.exec(line);
  if (heading5) {
    return `▸ ${convertInline(heading5[1])}`;
  }
  const listItem = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (listItem) {
    const [, indent, text] = listItem;
    return indent.length === 0 ? `• ${convertInline(text)}` : `  - ${convertInline(text)}`;
  }
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) {
    return convertInline(quote[1]);
  }
  // A trailing backslash is a Markdown hard line break; the store text keeps the newline itself.
  return convertInline(line.replace(/\\$/, ''));
}

/**
 * Converts the Markdown of the description section to Chrome Web Store plain
 * text. Throws if the result exceeds the store's character limit.
 */
export function markdownToStoreText(markdown: string): string {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const converted = withoutComments
    .split('\n')
    .map((line) => convertLine(line).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // Store style: a ▸ feature title sits directly above its paragraph …
    .replace(/^(▸ .*)\n\n/gm, '$1\n')
    // … and a list follows its "…:" intro line without a gap.
    .replace(/(:)\n\n(• )/g, '$1\n$2')
    .trim();

  if (converted.length > CWS_DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `Description is ${converted.length.toLocaleString('en-US')} characters; the Chrome Web Store allows at most ${CWS_DESCRIPTION_MAX_CHARS.toLocaleString('en-US')}`,
    );
  }
  return converted;
}

/** The store "Summary" is the manifest `description`, which comes from package.json. */
export function validateSummary(summary: string): void {
  if (summary.length > CWS_SUMMARY_MAX_CHARS) {
    throw new Error(
      `Summary is ${summary.length} characters; the Chrome Web Store allows at most ${CWS_SUMMARY_MAX_CHARS}`,
    );
  }
}

/*
 * File I/O
 */

interface PackageJson {
  description?: string;
}

/** Builds docs/description.txt from docs/README.md. Returns the output path. */
export function buildListing(): string {
  const pkg: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
  validateSummary(pkg.description ?? '');

  const markdown = readFileSync(LISTING_SOURCE, 'utf-8');
  const text = markdownToStoreText(extractSection(markdown, DESCRIPTION_HEADING));
  writeFileSync(DESCRIPTION_OUTPUT, `${text}\n`);
  return DESCRIPTION_OUTPUT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = buildListing();
  console.log(`Wrote ${path.relative(ROOT, output)}`);
}
