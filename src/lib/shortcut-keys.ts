/**
 * Readable keyboard shortcuts for Settings.
 *
 * Chrome reports a bound key in two spellings. On a Mac `chrome.commands.getAll()` gives glyphs
 * ("⌥⇧S", "⌘⇧Y", "⌃⇧S"); elsewhere, and in the manifest's `suggested_key`, it is words joined by
 * "+" ("Alt+Shift+S", "Ctrl+Shift+Y"). Both are turned into a list of named keys here, so the page
 * can draw one small chip per key. The glyphs are hard to read at a glance, which is the point.
 */

import { type MessageKey, t } from '@/lib/i18n';

type Modifier = 'command' | 'control' | 'alt' | 'shift' | 'search';

const GLYPHS: Readonly<Record<string, Modifier>> = {
  '⌘': 'command',
  '⌃': 'control',
  '⌥': 'alt',
  '⇧': 'shift',
};

/** The modifier names a Mac keyboard prints, in the UI language (read when drawn, not at load). */
function macNames(): Readonly<Record<Modifier, string>> {
  return {
    command: t('settingsKeyCommand'),
    control: t('settingsKeyControl'),
    alt: t('settingsKeyOption'),
    shift: t('settingsKeyShift'),
    search: t('settingsKeySearch'),
  };
}

/** The same for every other platform: Command does not exist there, Ctrl stands in. */
function otherNames(): Readonly<Record<Modifier, string>> {
  return {
    command: t('settingsKeyCtrl'),
    control: t('settingsKeyCtrl'),
    alt: t('settingsKeyAlt'),
    shift: t('settingsKeyShift'),
    search: t('settingsKeySearch'),
  };
}

/**
 * Chrome's names for the keys that are not a letter or a digit, as the manifest spells them
 * ("Comma", "PageUp", "MediaPlayPause") and as Chrome's own shortcut text spells some of them
 * ("Page Up", "Up Arrow", "Media Play/Pause"), compared without spaces and case. A key that is not
 * here (a letter, a digit, an arrow glyph, a name in Chrome's UI language) is shown as Chrome wrote it.
 */
const NAMED_KEYS: Readonly<Record<string, MessageKey>> = {
  comma: 'settingsKeyNameComma',
  period: 'settingsKeyNamePeriod',
  space: 'settingsKeyNameSpace',
  up: 'settingsKeyNameUp',
  uparrow: 'settingsKeyNameUp',
  down: 'settingsKeyNameDown',
  downarrow: 'settingsKeyNameDown',
  left: 'settingsKeyNameLeft',
  leftarrow: 'settingsKeyNameLeft',
  right: 'settingsKeyNameRight',
  rightarrow: 'settingsKeyNameRight',
  home: 'settingsKeyNameHome',
  end: 'settingsKeyNameEnd',
  pageup: 'settingsKeyNamePageUp',
  pagedown: 'settingsKeyNamePageDown',
  insert: 'settingsKeyNameInsert',
  ins: 'settingsKeyNameInsert',
  delete: 'settingsKeyNameDelete',
  del: 'settingsKeyNameDelete',
  tab: 'settingsKeyNameTab',
  esc: 'settingsKeyNameEscape',
  escape: 'settingsKeyNameEscape',
  enter: 'settingsKeyNameEnter',
  return: 'settingsKeyNameEnter',
  backspace: 'settingsKeyNameBackspace',
  medianexttrack: 'settingsKeyNameMediaNextTrack',
  mediaplaypause: 'settingsKeyNameMediaPlayPause',
  'mediaplay/pause': 'settingsKeyNameMediaPlayPause',
  mediaprevtrack: 'settingsKeyNameMediaPrevTrack',
  mediaprevioustrack: 'settingsKeyNameMediaPrevTrack',
  mediastop: 'settingsKeyNameMediaStop',
};

/** The key itself (not a modifier) in the UI language when it has a name, else as written. */
function keyName(key: string): string {
  const named = NAMED_KEYS[key.replace(/\s+/g, '').toLowerCase()];
  return named === undefined ? key : t(named);
}

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
  const names = isMac ? macNames() : otherNames();

  if (text.includes('+') && text.length > 1) {
    // "Ctrl++" would be the Plus key; keep a trailing "+" as the key rather than losing it.
    const words = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
    return words
      .map((word) => word.trim())
      .filter((word) => word !== '')
      .map((word) => {
        const modifier = wordModifier(word, isMac);
        return modifier === null ? keyName(word) : names[modifier];
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
    keys.push(keyName(key));
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
