import { describe, expect, it } from 'vitest';
import { formatBytes, formatSessionMeta, hostnameOf, pluralize } from './format';

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'tab')).toBe('1 tab');
  });

  it('uses the plural otherwise', () => {
    expect(pluralize(0, 'tab')).toBe('0 tabs');
    expect(pluralize(87, 'window')).toBe('87 windows');
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2150)).toBe('2.1 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('formatSessionMeta', () => {
  it('joins window count, tab count and size with middle dots', () => {
    expect(formatSessionMeta({ windowCount: 3, tabCount: 87, bytes: 2150 })).toBe(
      '3 windows · 87 tabs · 2.1 KB',
    );
  });

  it('uses singular forms', () => {
    expect(formatSessionMeta({ windowCount: 1, tabCount: 1, bytes: 10 })).toBe(
      '1 window · 1 tab · 10 B',
    );
  });
});

describe('hostnameOf', () => {
  it('returns the hostname of http(s) urls', () => {
    expect(hostnameOf('https://mail.google.com/mail/u/0/#inbox')).toBe('mail.google.com');
  });

  it('returns the scheme label for chrome and about urls', () => {
    expect(hostnameOf('chrome://extensions/')).toBe('chrome://extensions');
    expect(hostnameOf('about:blank')).toBe('about:blank');
  });

  it('returns the raw string for unparsable urls', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});
