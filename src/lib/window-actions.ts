import { errorMessage } from '@/lib/error-message';
import type { RestoreTarget } from '@/lib/session-restore';

type ActionResult = { ok: true } | { ok: false; reason: string };

async function run(action: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await action();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: errorMessage(err) };
  }
}

/**
 * "Go to tab": activates a live tab and brings its window forward. Two calls, in that order - a
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

/**
 * Closes several tabs in one call. Chrome rejects the whole call when any id is unknown, and a
 * selection can outlive one of its tabs by a moment, so on a failure the ids are retried one by
 * one and only the tabs that are really still open and would not close are reported.
 */
export async function closeTabs(tabIds: readonly number[]): Promise<ActionResult> {
  if (tabIds.length === 0) {
    return { ok: true };
  }
  const all = await run(() => chrome.tabs.remove([...tabIds]));
  if (all.ok) {
    return all;
  }
  let failure: ActionResult = { ok: true };
  for (const tabId of tabIds) {
    const open = await chrome.tabs.get(tabId).then(
      () => true,
      () => false,
    );
    if (!open) {
      continue;
    }
    const one = await closeTab(tabId);
    if (!one.ok) {
      failure = one;
    }
  }
  return failure;
}

/** "Close window" - every tab in it goes with it, which is why the UI confirms first. */
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
