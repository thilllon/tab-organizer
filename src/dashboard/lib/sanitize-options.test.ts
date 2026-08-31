import { describe, expect, it } from 'vitest';
import { THE_MARVELLOUS_SUSPENDER_EXTENSION_ID } from '@/sessions/capture';
import { getChromeFake } from '@/test/chrome-fake';
import { loadSanitizeOptions } from './sanitize-options';

describe('loadSanitizeOptions', () => {
  it('defaults to the Marvellous Suspender id and no file access', async () => {
    const options = await loadSanitizeOptions();
    expect(options.ownExtensionId).toBe('fakeextid');
    expect(options.fileAccessAllowed).toBe(false);
    expect(options.suspendedPrefix).toBe(
      `chrome-extension://${THE_MARVELLOUS_SUSPENDER_EXTENSION_ID}/suspended.html#`,
    );
    expect(options.suspendedPrefixLen).toBe(options.suspendedPrefix.length);
  });

  it('honours the configured suspender id and file-scheme access', async () => {
    const fake = getChromeFake();
    fake.state.sync.set('tabSuspenderExtensionId', 'abcdefghijklmnopabcdefghijklmnop');
    fake.state.fileAccessAllowed = true;

    const options = await loadSanitizeOptions();
    expect(options.suspendedPrefix).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/suspended.html#',
    );
    expect(options.fileAccessAllowed).toBe(true);
  });

  it('ignores an empty stored id', async () => {
    getChromeFake().state.sync.set('tabSuspenderExtensionId', '');
    const options = await loadSanitizeOptions();
    expect(options.suspendedPrefix).toContain(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
  });
});
