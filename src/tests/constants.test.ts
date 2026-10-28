import { describe, expect, it } from 'vitest';

import {
  CLOUD_SYNC,
  cloudSyncConfigured,
  cloudSyncPermissions,
  DEFAULT_SHORTCUTS,
} from '@/constants';
import { cloudSyncConfig, isCloudSyncEnabled, overrideCloudSyncConfig } from '@/lib/cloud-config';
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

describe('cloud sync configuration', () => {
  it('ships dormant: no server, no Google client, no identity permission', () => {
    expect(CLOUD_SYNC).toEqual({ apiBase: '', googleClientId: '' });
    expect(cloudSyncConfigured()).toBe(false);
    expect(cloudSyncPermissions()).toEqual([]);
    expect(isCloudSyncEnabled()).toBe(false);
  });

  it('needs both values before the feature and its permission switch on', () => {
    const server = { apiBase: 'https://sync.test', googleClientId: '' };
    expect(cloudSyncConfigured(server)).toBe(false);
    expect(cloudSyncConfigured({ apiBase: ' ', googleClientId: 'id' })).toBe(false);
    const both = { apiBase: 'https://sync.test', googleClientId: 'id' };
    expect(cloudSyncConfigured(both)).toBe(true);
    expect(cloudSyncPermissions(both)).toEqual(['identity']);
  });

  it('can be switched on for a test and back', () => {
    overrideCloudSyncConfig(() => ({ apiBase: 'https://sync.test', googleClientId: 'id' }));
    expect(isCloudSyncEnabled()).toBe(true);
    expect(cloudSyncConfig().apiBase).toBe('https://sync.test');
    overrideCloudSyncConfig();
    expect(isCloudSyncEnabled()).toBe(false);
  });
});
