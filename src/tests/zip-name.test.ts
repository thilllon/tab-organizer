import { describe, expect, it } from 'vitest';

import { readDisplayName, zipFileName } from '../../scripts/zip-name';

describe('zipFileName', () => {
  it("names the upload zip after package.json's displayName and the version", () => {
    const displayName = readDisplayName(new URL('../../package.json', import.meta.url).pathname);
    expect(displayName).toBe('Tab Organizer');
    expect(zipFileName(displayName, '7.14.0')).toBe('Tab-Organizer-7.14.0.zip');
  });

  it('refuses the translated manifest name, which is only a message reference', () => {
    expect(() => zipFileName('__MSG_extName__', '7.14.0')).toThrow(/Not a display name/);
  });
});
