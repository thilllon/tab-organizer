import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIPBOARD_UNAVAILABLE,
  copyFailureMessage,
  copyText,
  downloadDescriptor,
  downloadExport,
} from './download';

const DATE = new Date(2026, 7, 29, 14, 3);

/** Installs a fake `navigator.clipboard` for one test; the property is removed afterwards. */
function stubClipboard(writeText: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('downloadDescriptor', () => {
  it('names the file after the session and the format', () => {
    expect(downloadDescriptor('Work stuff', 'json', DATE)).toEqual({
      filename: 'tab-organizer-work-stuff-20260829-1403.json',
      mimeType: 'application/json',
    });
  });

  it('resolves the extension and MIME type of every format', () => {
    const formats = ['json', 'markdown', 'text', 'html', 'csv'] as const;
    expect(formats.map((format) => downloadDescriptor('Work', format, DATE))).toEqual([
      { filename: 'tab-organizer-work-20260829-1403.json', mimeType: 'application/json' },
      { filename: 'tab-organizer-work-20260829-1403.md', mimeType: 'text/markdown' },
      { filename: 'tab-organizer-work-20260829-1403.txt', mimeType: 'text/plain' },
      { filename: 'tab-organizer-work-20260829-1403.html', mimeType: 'text/html' },
      { filename: 'tab-organizer-work-20260829-1403.csv', mimeType: 'text/csv' },
    ]);
  });

  it('drops a name that slugifies to nothing', () => {
    expect(downloadDescriptor('!!!', 'csv', DATE).filename).toBe('tab-organizer-20260829-1403.csv');
  });
});

describe('downloadExport', () => {
  it('returns the descriptor it used (and is a no-op without a DOM)', () => {
    expect(downloadExport('Work', 'text', 'https://a.test/\n', DATE)).toEqual({
      filename: 'tab-organizer-work-20260829-1403.txt',
      mimeType: 'text/plain',
    });
  });
});

describe('copyText', () => {
  it('writes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    await expect(copyText('https://a.test/')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('https://a.test/');
  });

  it('reports a rejected write instead of throwing', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('Document is not focused')));
    await expect(copyText('x')).resolves.toEqual({
      ok: false,
      error: 'Could not copy to the clipboard: Document is not focused',
    });
  });

  it('reports a missing clipboard API', async () => {
    stubClipboard(undefined);
    await expect(copyText('x')).resolves.toEqual({ ok: false, error: CLIPBOARD_UNAVAILABLE });
  });
});

describe('copyFailureMessage', () => {
  it('reads non-Error rejections too', () => {
    expect(copyFailureMessage('nope')).toBe('Could not copy to the clipboard: nope');
    expect(copyFailureMessage(undefined)).toBe('Could not copy to the clipboard: Unknown error');
  });
});
