import { describe, expect, it } from 'vitest';

import { openShortcutSettings, SHORTCUTS_URL } from '@/lib/open-shortcut-settings';

import { getChromeFake } from './chrome-fake';

describe('openShortcutSettings', () => {
  it('opens chrome://extensions/shortcuts in a new tab', async () => {
    const fake = getChromeFake();
    await openShortcutSettings();
    expect(SHORTCUTS_URL).toBe('chrome://extensions/shortcuts');
    expect(fake.state.createdTabs).toEqual([{ url: SHORTCUTS_URL }]);
  });
});
