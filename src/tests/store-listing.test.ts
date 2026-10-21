import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_CHARS,
  CWS_SUMMARY_MAX_CHARS,
  descriptionHeading,
  extractDescription,
  extractListings,
  extractSummary,
  LISTING_LOCALES,
  LISTING_SOURCE,
  LOCALES_SOURCE,
  readLocaleMessage,
  summaryHeading,
  validateDescription,
  validateSummary,
} from '../../scripts/store-listing';

const SAMPLE = [
  '## Store listing',
  '',
  '### Description',
  '',
  'Paste the block below.',
  '',
  '```text',
  'Title line',
  '',
  'FEATURES',
  '# not a heading, just store text',
  '• one',
  '```',
  '',
  '### Graphic assets',
  '',
  '```',
  'another block',
  '```',
].join('\n');

describe('extractDescription', () => {
  it('returns the fenced block under the Description heading, without the fences', () => {
    expect(extractDescription(SAMPLE)).toBe(
      'Title line\n\nFEATURES\n# not a heading, just store text\n• one',
    );
  });

  it('throws when the heading is missing', () => {
    expect(() => extractDescription('# Title\n\n```\ntext\n```')).toThrow(/not found/);
  });

  it('does not borrow a block from a later section', () => {
    const markdown = '### Description\n\nNo block here.\n\n### Graphic assets\n\n```\nx\n```';
    expect(() => extractDescription(markdown)).toThrow(/No fenced block/);
  });

  it('finds a translation under its own heading, not the English block', () => {
    const markdown = [
      '### Summary',
      '```text',
      'English summary',
      '```',
      '### Description',
      '```text',
      'English',
      '```',
      '### Summary (ko)',
      '```text',
      '한국어 요약',
      '```',
      '### Description (ko)',
      '```text',
      '한국어',
      '```',
    ].join('\n');
    expect(extractDescription(markdown)).toBe('English');
    expect(extractDescription(markdown, 'ko')).toBe('한국어');
    expect(extractSummary(markdown)).toBe('English summary');
    expect(extractSummary(markdown, 'ko')).toBe('한국어 요약');
  });

  it('throws on a block that is never closed', () => {
    expect(() => extractDescription('### Description\n\n```text\nunfinished')).toThrow(
      /No fenced block/,
    );
  });
});

describe('validateDescription', () => {
  it('accepts a description at the limit', () => {
    expect(() => validateDescription('a'.repeat(DESCRIPTION_MAX_CHARS))).not.toThrow();
  });

  it(`rejects a description longer than ${DESCRIPTION_MAX_CHARS} characters`, () => {
    expect(() => validateDescription('a'.repeat(DESCRIPTION_MAX_CHARS + 1))).toThrow(/at most 500/);
  });
});

describe('validateSummary', () => {
  it('accepts a summary within the limit', () => {
    expect(() => validateSummary('a'.repeat(CWS_SUMMARY_MAX_CHARS))).not.toThrow();
  });

  it(`rejects a summary longer than ${CWS_SUMMARY_MAX_CHARS} characters`, () => {
    expect(() => validateSummary('a'.repeat(CWS_SUMMARY_MAX_CHARS + 1))).toThrow(/at most 132/);
  });
});

// The real files: this is what keeps an over-long or stale listing from being committed.
describe('the store listing in this repository', () => {
  const markdown = readFileSync(LISTING_SOURCE, 'utf-8');
  const listings = extractListings(markdown);

  it('has a Summary and a Description for every language of public/_locales', () => {
    expect(listings.map((listing) => listing.locale)).toEqual([...LISTING_LOCALES]);
    for (const locale of LISTING_LOCALES) {
      expect(markdown).toContain(`\n${summaryHeading(locale)}\n`);
      expect(markdown).toContain(`\n${descriptionHeading(locale)}\n`);
    }
  });

  describe.each(listings)('$locale', ({ locale, summary, description }) => {
    it('has a description the store will accept', () => {
      expect(description.trim()).not.toBe('');
      expect(() => validateDescription(description)).not.toThrow();
    });

    it('keeps Markdown out of the description, since it is pasted as it is', () => {
      expect(description).not.toMatch(/^#{1,6}\s/m);
      expect(description).not.toMatch(/\*\*|`/);
    });

    it('has no em or en dash', () => {
      expect(summary).not.toMatch(/[\u2013\u2014]/);
      expect(description).not.toMatch(/[\u2013\u2014]/);
    });

    it("has the Summary the package carries (that locale's extDescription)", () => {
      expect(summary).toBe(readLocaleMessage(LOCALES_SOURCE, locale, 'extDescription'));
      expect(() => validateSummary(summary)).not.toThrow();
    });
  });

  it('keeps package.json description equal to the English summary', () => {
    const pkgPath = path.resolve(path.dirname(LISTING_SOURCE), 'package.json');
    const pkg: { description?: string } = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.description).toBe(extractSummary(markdown));
  });
});
