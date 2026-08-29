import { describe, expect, it } from 'vitest';
import {
  CWS_DESCRIPTION_MAX_CHARS,
  CWS_SUMMARY_MAX_CHARS,
  extractSection,
  markdownToStoreText,
  validateSummary,
} from './build-listing';

describe('extractSection', () => {
  const md = [
    '# Listing',
    '',
    '## Store listing',
    '',
    '### Description',
    '',
    'Intro paragraph.',
    '',
    '#### Sub heading',
    '',
    '- item',
    '',
    '### Graphic assets',
    '',
    'ignored',
  ].join('\n');

  it('returns the body under the heading up to the next heading of the same or higher level', () => {
    expect(extractSection(md, '### Description')).toBe(
      ['Intro paragraph.', '', '#### Sub heading', '', '- item'].join('\n'),
    );
  });

  it('throws when the heading is missing', () => {
    expect(() => extractSection(md, '### Nope')).toThrow(/### Nope/);
  });
});

describe('markdownToStoreText', () => {
  it('turns level-4 headings into upper-case section titles', () => {
    expect(markdownToStoreText('#### How it works')).toBe('HOW IT WORKS');
  });

  it('turns level-5 headings into ▸ feature titles', () => {
    expect(markdownToStoreText('##### One-Click Sorting')).toBe('▸ One-Click Sorting');
  });

  it('turns top-level list items into • bullets and nested items into indented dashes', () => {
    const input = ['- Pinned tabs', '- Tab groups', '  - nested one', '  - nested two'].join('\n');
    expect(markdownToStoreText(input)).toBe(
      ['• Pinned tabs', '• Tab groups', '  - nested one', '  - nested two'].join('\n'),
    );
  });

  it('accepts * as a list marker too', () => {
    expect(markdownToStoreText('* item')).toBe('• item');
  });

  it('strips bold, italic and inline code markers', () => {
    expect(markdownToStoreText('Use **Ctrl+Z** to _undo_ and `chrome://extensions`')).toBe(
      'Use Ctrl+Z to undo and chrome://extensions',
    );
  });

  it('renders links as text followed by the URL in parentheses', () => {
    expect(markdownToStoreText('See [the repo](https://github.com/x/y).')).toBe(
      'See the repo (https://github.com/x/y).',
    );
  });

  it('unescapes markdown escapes such as \\* produced by prettier', () => {
    expect(markdownToStoreText('all \\*.google.com tabs')).toBe('all *.google.com tabs');
  });

  it('strips blockquote markers and HTML comments', () => {
    expect(markdownToStoreText('<!-- note -->\n> quoted line')).toBe('quoted line');
  });

  it('collapses runs of blank lines and trims the result', () => {
    expect(markdownToStoreText('\n\nA\n\n\n\nB\n\n')).toBe('A\n\nB');
  });

  it('keeps a ▸ feature title tight against its first paragraph', () => {
    expect(markdownToStoreText('##### One-Click Sorting\n\nClick the icon.')).toBe(
      '▸ One-Click Sorting\nClick the icon.',
    );
  });

  it('keeps a list tight against the introducing line that ends with a colon', () => {
    expect(markdownToStoreText('Choose how:\n\n- By URL\n- By Title')).toBe(
      'Choose how:\n• By URL\n• By Title',
    );
  });

  it('keeps the blank line after an UPPER-CASE section title', () => {
    expect(markdownToStoreText('#### Features\n\nIntro.')).toBe('FEATURES\n\nIntro.');
  });

  it('drops a trailing backslash used as a Markdown hard line break', () => {
    expect(markdownToStoreText('Q: Does it work?\\\nA: Yes.')).toBe('Q: Does it work?\nA: Yes.');
  });

  it('leaves plain lines such as FAQ entries untouched', () => {
    expect(markdownToStoreText('Q: Does it work?\nA: Yes.')).toBe('Q: Does it work?\nA: Yes.');
  });

  it(`throws when the result exceeds ${CWS_DESCRIPTION_MAX_CHARS} characters`, () => {
    expect(() => markdownToStoreText('x'.repeat(CWS_DESCRIPTION_MAX_CHARS + 1))).toThrow(/16,000/);
  });
});

describe('validateSummary', () => {
  it('accepts a summary within the limit', () => {
    expect(() => validateSummary('Sorts your tabs.')).not.toThrow();
  });

  it(`rejects a summary longer than ${CWS_SUMMARY_MAX_CHARS} characters`, () => {
    expect(() => validateSummary('x'.repeat(CWS_SUMMARY_MAX_CHARS + 1))).toThrow(/132/);
  });
});
