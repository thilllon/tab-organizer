import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CWS_DESCRIPTION_MAX_CHARS,
  CWS_SUMMARY_MAX_CHARS,
  extractDescription,
  LISTING_SOURCE,
  validateDescription,
  validateSummary,
} from './store-listing';

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

  it('throws on a block that is never closed', () => {
    expect(() => extractDescription('### Description\n\n```text\nunfinished')).toThrow(
      /No fenced block/,
    );
  });
});

describe('validateDescription', () => {
  it('accepts a description at the limit', () => {
    expect(() => validateDescription('a'.repeat(CWS_DESCRIPTION_MAX_CHARS))).not.toThrow();
  });

  it(`rejects a description longer than ${CWS_DESCRIPTION_MAX_CHARS} characters`, () => {
    expect(() => validateDescription('a'.repeat(CWS_DESCRIPTION_MAX_CHARS + 1))).toThrow(
      /at most 16,000/,
    );
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

// The real files: this is what keeps an over-long listing from being committed.
describe('the store listing in this repository', () => {
  const description = extractDescription(readFileSync(LISTING_SOURCE, 'utf-8'));

  it('has a description the store will accept', () => {
    expect(description.trim()).not.toBe('');
    expect(() => validateDescription(description)).not.toThrow();
  });

  it('keeps Markdown out of the description, since it is pasted as it is', () => {
    expect(description).not.toMatch(/^#{1,6}\s/m);
    expect(description).not.toMatch(/\*\*|`/);
  });

  it('has a summary (package.json description) the store will accept', () => {
    const pkgPath = path.resolve(path.dirname(LISTING_SOURCE), '..', 'package.json');
    const pkg: { description?: string } = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.description).toBeTruthy();
    expect(() => validateSummary(pkg.description ?? '')).not.toThrow();
  });
});
