/**
 * Readable keyboard shortcuts for Settings.
 *
 * Chrome reports a bound key in two spellings. On a Mac `chrome.commands.getAll()` gives glyphs
 * ("⌥⇧S", "⌘⇧Y", "⌃⇧S"); elsewhere, and in the manifest's `suggested_key`, it is words joined by
 * "+" ("Alt+Shift+S", "Ctrl+Shift+Y"). Both are turned into a list of named keys here, so the page
 * can draw one small chip per key. The glyphs are hard to read at a glance, which is the point.
 */

type Modifier = 'command' | 'control' | 'alt' | 'shift' | 'search';

const GLYPHS: Readonly<Record<string, Modifier>> = {
  '⌘': 'command',
  '⌃': 'control',
  '⌥': 'alt',
  '⇧': 'shift',
};

const MAC_NAMES: Readonly<Record<Modifier, string>> = {
  command: 'Command',
  control: 'Control',
  alt: 'Option',
  shift: 'Shift',
  search: 'Search',
};

const OTHER_NAMES: Readonly<Record<Modifier, string>> = {
  command: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  search: 'Search',
};

/**
 * One word of the "+" spelling as a modifier, or `null` for the key itself. In a manifest "Ctrl"
 * means Command on a Mac and "MacCtrl" is the real Control key there.
 */
function wordModifier(word: string, isMac: boolean): Modifier | null {
  switch (word.toLowerCase()) {
    case 'ctrl':
    case 'control':
      return isMac ? 'command' : 'control';
    case 'macctrl':
      return 'control';
    case 'command':
    case 'cmd':
      return 'command';
    case 'alt':
    case 'option':
      return 'alt';
    case 'shift':
      return 'shift';
    case 'search':
      return 'search';
    default:
      return null;
  }
}

/** The key names a shortcut is made of, modifiers first; `[]` for an unbound command. */
export function shortcutKeys(shortcut: string | undefined, isMac: boolean): string[] {
  const text = (shortcut ?? '').trim();
  if (text === '') {
    return [];
  }
  const names = isMac ? MAC_NAMES : OTHER_NAMES;

  if (text.includes('+') && text.length > 1) {
    // "Ctrl++" would be the Plus key; keep a trailing "+" as the key rather than losing it.
    const words = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
    return words
      .map((word) => word.trim())
      .filter((word) => word !== '')
      .map((word) => {
        const modifier = wordModifier(word, isMac);
        return modifier === null ? word : names[modifier];
      });
  }

  // Glyph spelling: modifier glyphs first, then the key as Chrome wrote it.
  const keys: string[] = [];
  let index = 0;
  const chars = [...text];
  while (index < chars.length - 1) {
    const modifier = GLYPHS[chars[index] ?? ''];
    if (modifier === undefined) {
      break;
    }
    keys.push(names[modifier]);
    index += 1;
  }
  const key = chars.slice(index).join('').trim();
  if (key !== '') {
    keys.push(key);
  }
  return keys;
}

/** The same keys as one line of text, e.g. "Option + Shift + S". */
export function shortcutText(shortcut: string | undefined, isMac: boolean): string {
  return shortcutKeys(shortcut, isMac).join(' + ');
}

/** Whether a user agent or platform string belongs to a Mac. */
export function isMacPlatform(platform: string): boolean {
  return /mac/i.test(platform);
}
