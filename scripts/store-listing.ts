/**
 * Reads the Chrome Web Store text out of `docs/store_listing.md`.
 *
 * The store's "Description" field takes plain text only, so that file keeps the description
 * already in store form inside a fenced block under `### Description` -- what is in the block is
 * what gets pasted, nothing is generated from it. This module finds the block and holds the two
 * length limits the store enforces; `store-listing.test.ts` checks the real file against them on
 * every `pnpm test`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chrome Web Store limit for the "Description" field. */
export const CWS_DESCRIPTION_MAX_CHARS = 16_000;
/** Chrome Web Store limit for the "Summary" field (manifest `description`). */
export const CWS_SUMMARY_MAX_CHARS = 132;

const DESCRIPTION_HEADING = '### Description';
const FENCE = '```';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LISTING_SOURCE = path.resolve(__dirname, '..', 'docs', 'store_listing.md');

/**
 * Returns the text of the first fenced block under `### Description`, without the fences.
 * Throws when the heading or a complete block is missing before the next heading.
 */
export function extractDescription(markdown: string): string {
  const lines = markdown.split('\n');
  const heading = lines.findIndex((line) => line.trim() === DESCRIPTION_HEADING);
  if (heading === -1) {
    throw new Error(`Heading "${DESCRIPTION_HEADING}" not found in the store listing`);
  }
  let open = -1;
  for (let i = heading + 1; i < lines.length; i++) {
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
  throw new Error(`No fenced block under "${DESCRIPTION_HEADING}" in the store listing`);
}

export function validateDescription(description: string): void {
  if (description.length > CWS_DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `Description is ${description.length.toLocaleString('en-US')} characters; the Chrome Web Store allows at most ${CWS_DESCRIPTION_MAX_CHARS.toLocaleString('en-US')}`,
    );
  }
}

/** The store "Summary" is the manifest `description`, which comes from package.json. */
export function validateSummary(summary: string): void {
  if (summary.length > CWS_SUMMARY_MAX_CHARS) {
    throw new Error(
      `Summary is ${summary.length} characters; the Chrome Web Store allows at most ${CWS_SUMMARY_MAX_CHARS}`,
    );
  }
}
