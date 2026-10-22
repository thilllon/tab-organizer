import { describe, expect, it, vi } from 'vitest';

import { loadSanitizeOptions } from '@/lib/sanitize-options';

import { getChromeFake } from './chrome-fake';

describe('loadSanitizeOptions', () => {
  it('reports our own id and no file access by default', async () => {
    const options = await loadSanitizeOptions();
    expect(options).toEqual({ ownExtensionId: 'fakeextid', fileAccessAllowed: false });
  });

  it('honours file-scheme access', async () => {
    getChromeFake().state.fileAccessAllowed = true;

    const options = await loadSanitizeOptions();
    expect(options.fileAccessAllowed).toBe(true);
  });

  it('reads nothing from chrome.storage.sync, not even a suspender id an older version stored', async () => {
    const fake = getChromeFake();
    fake.state.sync.set('tabSuspenderExtensionId', 'abcdefghijklmnopabcdefghijklmnop');
    const get = vi.spyOn(fake.chrome.storage.sync, 'get');

    const options = await loadSanitizeOptions();
    expect(options).toEqual({ ownExtensionId: 'fakeextid', fileAccessAllowed: false });
    expect(get).not.toHaveBeenCalled();
  });
});
