import { describe, expect, it } from 'vitest';
import { parseWindowList, pickDemoWindow, type ScreenWindow } from './window-bounds';

function win(owner: string, id: number, overrides: Partial<ScreenWindow> = {}): ScreenWindow {
  return { owner, id, x: 0, y: 33, width: 1280, height: 800, ...overrides };
}

describe('parseWindowList', () => {
  it('reads the windows the script printed', () => {
    const output = '[{"owner":"Chromium","id":223,"x":0,"y":33,"width":1728,"height":1020}]\n';
    expect(parseWindowList(output)).toEqual([
      { owner: 'Chromium', id: 223, x: 0, y: 33, width: 1728, height: 1020 },
    ]);
  });

  it('drops entries that are not the expected shape', () => {
    expect(parseWindowList('[{"owner":"Chromium","id":223},null,7]')).toEqual([]);
  });

  it('returns nothing for output that is not a JSON list', () => {
    expect(parseWindowList('')).toEqual([]);
    expect(parseWindowList('execution error: not allowed')).toEqual([]);
    expect(parseWindowList('{"id":1}')).toEqual([]);
  });
});

describe('pickDemoWindow', () => {
  it('takes the frontmost window of a demo browser', () => {
    const windows = [win('Terminal', 1), win('Chromium', 2), win('Chromium', 3)];
    expect(pickDemoWindow(windows)?.id).toBe(2);
  });

  it('accepts Chrome for Testing', () => {
    expect(pickDemoWindow([win('Google Chrome for Testing', 5)])?.id).toBe(5);
  });

  it("never takes the owner's own Chrome, even when it is in front", () => {
    expect(pickDemoWindow([win('Google Chrome', 1), win('Chromium', 2)])?.id).toBe(2);
    expect(pickDemoWindow([win('Google Chrome', 1), win('Google Chrome Canary', 3)])).toBeNull();
  });

  it('skips slivers such as the link-preview bubble', () => {
    const bubble = win('Chromium', 1, { y: 1032, width: 244, height: 22 });
    expect(pickDemoWindow([bubble, win('Chromium', 2)])?.id).toBe(2);
  });

  it('truncates fractional points, as ffmpeg crop and screencapture want integers', () => {
    const windows = [win('Chromium', 7, { x: 10.5, y: 33.9, width: 800.2, height: 600 })];
    expect(pickDemoWindow(windows)).toEqual({ id: 7, x: 10, y: 33, width: 800, height: 600 });
  });

  it('returns null when no demo browser has a window on screen', () => {
    expect(pickDemoWindow([win('Terminal', 1)])).toBeNull();
    expect(pickDemoWindow([])).toBeNull();
  });
});
