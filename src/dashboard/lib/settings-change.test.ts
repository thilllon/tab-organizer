import { describe, expect, it } from 'vitest';
import { INDEX_KEY, SETTINGS_KEY } from '@/sessions/storage';
import { isSettingsChange } from './settings-change';

describe('isSettingsChange', () => {
  it('is true when the session settings changed in local storage', () => {
    expect(
      isSettingsChange({ [SETTINGS_KEY]: { newValue: { historyEnabled: false } } }, 'local'),
    ).toBe(true);
  });

  it('is true when the settings key changed alongside other keys', () => {
    expect(
      isSettingsChange(
        { [INDEX_KEY]: { newValue: {} }, [SETTINGS_KEY]: { newValue: {} } },
        'local',
      ),
    ).toBe(true);
  });

  it('is false for other keys', () => {
    expect(isSettingsChange({ [INDEX_KEY]: { newValue: {} } }, 'local')).toBe(false);
  });

  it('is false for other storage areas', () => {
    expect(isSettingsChange({ [SETTINGS_KEY]: { newValue: {} } }, 'sync')).toBe(false);
  });
});
