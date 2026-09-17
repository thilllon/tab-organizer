import { errorMessage } from '@/dashboard/lib/errors';
import type { RestoreTarget } from '@/sessions/restore';

export type ActionResult = { ok: true } | { ok: false; reason: string };

async function run(action: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await action();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: errorMessage(err) };
  }
}

/**
 * "Go to tab": activates a live tab and brings its window forward. Two calls, in that order — a
 * `windows.update({ focused: true })` on a window whose active tab has not changed yet would show
 * the wrong tab for a frame. Never throws; a tab closed between render and click comes back as
 * `{ ok: false }` for the row to show inline.
 */
export function goToTab(tabId: number, windowId: number): Promise<ActionResult> {
  return run(async () => {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  });
}

/** "Close tab". The pane refreshes from `tabs.onRemoved`, not from this result. */
export function closeTab(tabId: number): Promise<ActionResult> {
  return run(() => chrome.tabs.remove(tabId));
}

/** "Close window" — every tab in it goes with it, which is why the UI confirms first. */
export function closeWindow(windowId: number): Promise<ActionResult> {
  return run(() => chrome.windows.remove(windowId));
}

/**
 * The restore target for "Restore into this window": the window the dashboard itself is in, read
 * fresh at click time rather than from the pane's snapshot (the dashboard tab can be dragged into
 * another window while the page stays mounted).
 */
export async function currentWindowTarget(): Promise<RestoreTarget> {
  const current = await chrome.windows.getCurrent();
  if (current.id === undefined) {
    throw new Error('Could not identify this window.');
  }
  return { kind: 'window', windowId: current.id };
}
