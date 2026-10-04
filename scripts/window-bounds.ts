/**
 * Where the demo browser's window is on a Mac's screen, and its window id for `screencapture -l`.
 *
 * macOS only exposes its window list through CoreGraphics. `osascript -l JavaScript` (JXA) ships
 * with the system and can call it, so this needs nothing installed -- it replaced a Python script
 * that pulled in pyobjc for the same one call.
 */

import { execFileSync } from 'node:child_process';

export interface WindowBounds {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenWindow extends WindowBounds {
  owner: string;
}

/**
 * The applications a release run drives: Playwright's Chromium and Chrome for Testing. The
 * owner's everyday "Google Chrome" is deliberately not here. It cannot be the demo browser
 * (branded Chrome ignores --load-extension), and matching it meant a capture could take the
 * owner's own window, tabs and all, into a file that is committed to a public repository.
 */
const DEMO_BROWSERS = new Set(['Chromium', 'Google Chrome for Testing']);

// Chrome also puts slivers on the window layer (the link-preview bubble at the bottom edge is a
// 244x22 "window"); anything this small is not the browser window.
const MIN_WINDOW_SIZE = 200;

// Layer 0 is where ordinary app windows live. The list comes front to back. The script's last
// expression is what osascript prints.
const JXA = `
ObjC.import('CoreGraphics');
const windows = ObjC.deepUnwrap(
  ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID),
  ),
);
JSON.stringify(
  windows
    .filter((w) => w.kCGWindowLayer === 0)
    .map((w) => ({
      owner: w.kCGWindowOwnerName || '',
      id: w.kCGWindowNumber,
      x: w.kCGWindowBounds.X,
      y: w.kCGWindowBounds.Y,
      width: w.kCGWindowBounds.Width,
      height: w.kCGWindowBounds.Height,
    })),
);
`;

function isScreenWindow(value: unknown): value is ScreenWindow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.owner === 'string' &&
    ['id', 'x', 'y', 'width', 'height'].every((key) => Number.isFinite(record[key]))
  );
}

/** Parses what the JXA script printed; `[]` for anything unexpected. */
export function parseWindowList(output: string): ScreenWindow[] {
  try {
    const parsed: unknown = JSON.parse(output.trim());
    return Array.isArray(parsed) ? parsed.filter(isScreenWindow) : [];
  } catch {
    return [];
  }
}

/** The frontmost window of a demo browser, in whole points; `null` when there is none. */
export function pickDemoWindow(windows: ScreenWindow[]): WindowBounds | null {
  const win = windows.find(
    (w) => DEMO_BROWSERS.has(w.owner) && w.width >= MIN_WINDOW_SIZE && w.height >= MIN_WINDOW_SIZE,
  );
  if (!win) {
    return null;
  }
  return {
    id: Math.trunc(win.id),
    x: Math.trunc(win.x),
    y: Math.trunc(win.y),
    width: Math.trunc(win.width),
    height: Math.trunc(win.height),
  };
}

/** The demo browser's frontmost window, or `null` off macOS or when it has none on screen. */
export function getChromeWindowBounds(): WindowBounds | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const output = execFileSync('osascript', ['-l', 'JavaScript', '-e', JXA], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return pickDemoWindow(parseWindowList(output));
  } catch {
    return null;
  }
}
