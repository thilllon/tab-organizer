import { describe, expect, it } from 'vitest';

import { DEFAULT_SHORTCUTS } from '@/constants';
import { t } from '@/lib/i18n';
import { COMMAND_IDS } from '@/service-worker';

describe('DEFAULT_SHORTCUTS', () => {
  it('only names commands the manifest declares', () => {
    const declared = ['_execute_action', ...Object.values(COMMAND_IDS)];
    for (const id of Object.keys(DEFAULT_SHORTCUTS)) {
      expect(declared).toContain(id);
    }
  });

  it('uses keys Chrome accepts as a suggested_key, each one once', () => {
    const keys = Object.values(DEFAULT_SHORTCUTS);
    for (const key of keys) {
      // Chrome wants Ctrl or Alt in a suggestion, and at most one more modifier before the key.
      expect(key).toMatch(/^(Ctrl|Alt)(\+Shift)?\+[A-Z0-9]$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the Assemble! label', () => {
  it('is the name followed by its explanation in brackets', () => {
    expect(t('cmdAssembleTabs')).toBe("Assemble! (move every window's tabs into this one)");
    expect(t('cmdAssembleTabs').startsWith(`${t('assembleName')} (`)).toBe(true);
  });
});
