import { describe, expect, it } from 'vitest';

import { isMacPlatform, shortcutKeys, shortcutText } from '@/lib/shortcut-keys';

describe('shortcutKeys', () => {
  it('names the glyphs Chrome reports on a Mac', () => {
    expect(shortcutKeys('⌥⇧S', true)).toEqual(['Option', 'Shift', 'S']);
    expect(shortcutKeys('⌘⇧Y', true)).toEqual(['Command', 'Shift', 'Y']);
    expect(shortcutKeys('⌃⇧S', true)).toEqual(['Control', 'Shift', 'S']);
  });

  it('keeps a named key after the glyphs whole', () => {
    expect(shortcutKeys('⌥Comma', true)).toEqual(['Option', 'Comma']);
    expect(shortcutKeys('⌘↑', true)).toEqual(['Command', '↑']);
  });

  it('reads the "+" spelling with the names of each platform', () => {
    expect(shortcutKeys('Alt+Shift+S', false)).toEqual(['Alt', 'Shift', 'S']);
    expect(shortcutKeys('Ctrl+Shift+Y', false)).toEqual(['Ctrl', 'Shift', 'Y']);
    expect(shortcutKeys('Alt+Shift+S', true)).toEqual(['Option', 'Shift', 'S']);
    // In a manifest Ctrl means Command on a Mac, and MacCtrl is the Control key.
    expect(shortcutKeys('Ctrl+Shift+Y', true)).toEqual(['Command', 'Shift', 'Y']);
    expect(shortcutKeys('MacCtrl+Shift+Y', true)).toEqual(['Control', 'Shift', 'Y']);
    expect(shortcutKeys('Command+B', true)).toEqual(['Command', 'B']);
  });

  it('keeps the Plus key', () => {
    expect(shortcutKeys('Ctrl++', false)).toEqual(['Ctrl', '+']);
  });

  it('returns nothing for an unbound command', () => {
    expect(shortcutKeys('', true)).toEqual([]);
    expect(shortcutKeys('   ', false)).toEqual([]);
    expect(shortcutKeys(undefined, false)).toEqual([]);
  });
});

describe('shortcutText', () => {
  it('joins the names with spaced plus signs', () => {
    expect(shortcutText('⌥⇧S', true)).toBe('Option + Shift + S');
    expect(shortcutText('Alt+Shift+A', false)).toBe('Alt + Shift + A');
    expect(shortcutText('', false)).toBe('');
  });
});

describe('isMacPlatform', () => {
  it('recognises a Mac user agent and nothing else', () => {
    expect(
      isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
    ).toBe(true);
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isMacPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });
});
