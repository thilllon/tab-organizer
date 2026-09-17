import { isTabsCannotBeEditedError, withRetryOnce } from '@/sessions/restore';

/**
 * "Assemble tabs": pull every tab of the other normal windows into the last-focused one.
 *
 * Tabs are relocated with `chrome.tabs.move` / `chrome.tabGroups.move` only — never reopened by
 * URL and closed — so tab ids, back/forward history and page state survive, and a failed call
 * leaves a tab where it was instead of losing it. Verified in Chrome 152: a cross-window
 * `tabs.move` keeps the id and history but drops `pinned`, and pinning again in the original
 * order appends each tab to the target's pinned area; `tabGroups.move` keeps the group's id,
 * title, colour and collapsed state.
 *
 * One exception, verified in Chrome for Testing 151 (and modelled by the test fake): a group that
 * holds its source window's active tab carries that "active" along — the tab becomes the target's
 * active tab, and a collapsed group is expanded because it now holds the active tab. `tabs.move`
 * does not do this. So the target's active tab id is read before anything moves (exactly, never
 * guessed from `lastAccessed`) and put back afterwards, then the groups that arrived collapsed are
 * collapsed again.
 */

/** `chrome.tabGroups.TAB_GROUP_ID_NONE`, spelled out so this module stays importable in tests. */
const NO_GROUP = -1;

export type AssembleStep =
  /** Move these pinned tabs together, then pin each again in this order. */
  | { kind: 'pinned'; tabIds: number[] }
  /** A run of consecutive ungrouped tabs, moved as one block. */
  | { kind: 'tabs'; tabIds: number[] }
  /** A whole tab group, moved once. */
  | { kind: 'group'; groupId: number };

export type AssembleResult =
  | { status: 'busy' }
  | { status: 'nothing-to-do' }
  | { status: 'done'; mergedWindows: number; failures: AssembleFailure[] };

export interface AssembleFailure {
  windowId: number;
  error: unknown;
}

/**
 * The windows whose tabs move: normal windows other than the target that share its incognito
 * mode. Popups, app windows and devtools are never touched, and a private window's tabs never
 * land in a regular one (or the other way round).
 */
export function pickSourceWindows(
  windows: chrome.windows.Window[],
  target: chrome.windows.Window,
): chrome.windows.Window[] {
  return windows.filter(
    (win) =>
      win.id !== undefined &&
      win.id !== target.id &&
      win.type === 'normal' &&
      win.incognito === target.incognito,
  );
}

/**
 * One source window's moves, in tab-strip order. Every move appends to the end of the target
 * (`index: -1`), so replaying the steps in order keeps the window's own order: its pinned tabs
 * first, then ungrouped runs and whole groups as they appear.
 */
export function planWindowMoves(tabs: chrome.tabs.Tab[]): AssembleStep[] {
  const ordered = tabs
    .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
    .sort((a, b) => a.index - b.index);
  const steps: AssembleStep[] = [];

  const pinned = ordered.filter((tab) => tab.pinned).map((tab) => tab.id);
  if (pinned.length > 0) {
    steps.push({ kind: 'pinned', tabIds: pinned });
  }

  let run: number[] = [];
  const flushRun = (): void => {
    if (run.length > 0) {
      steps.push({ kind: 'tabs', tabIds: run });
      run = [];
    }
  };
  const movedGroups = new Set<number>();
  for (const tab of ordered) {
    if (tab.pinned) {
      continue;
    }
    if (tab.groupId === NO_GROUP) {
      run.push(tab.id);
      continue;
    }
    flushRun();
    if (!movedGroups.has(tab.groupId)) {
      movedGroups.add(tab.groupId);
      steps.push({ kind: 'group', groupId: tab.groupId });
    }
  }
  flushRun();
  return steps;
}

/** "Tabs cannot be edited right now (user may be dragging a tab)" clears up after a moment. */
function retrying<T>(fn: () => Promise<T>): Promise<T> {
  return withRetryOnce(fn, isTabsCannotBeEditedError);
}

async function runSteps(steps: AssembleStep[], targetWindowId: number): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case 'pinned':
        await retrying(() =>
          chrome.tabs.move(step.tabIds, { windowId: targetWindowId, index: -1 }),
        );
        for (const tabId of step.tabIds) {
          await retrying(() => chrome.tabs.update(tabId, { pinned: true }));
        }
        break;
      case 'tabs':
        await retrying(() =>
          chrome.tabs.move(step.tabIds, { windowId: targetWindowId, index: -1 }),
        );
        break;
      case 'group':
        await retrying(() =>
          chrome.tabGroups.move(step.groupId, { windowId: targetWindowId, index: -1 }),
        );
        break;
    }
  }
}

/**
 * Undoes what a group move can do to the target (see the module comment): re-activates the tab
 * that was active before, then collapses again every moved group that arrived collapsed and was
 * expanded on the way. Activation goes first — Chrome will not keep a group collapsed while it
 * holds the active tab.
 */
async function restoreTargetView(
  targetWindowId: number,
  activeTabId: number | undefined,
  collapsedGroupIds: Set<number>,
): Promise<void> {
  const strip = await chrome.tabs.query({ windowId: targetWindowId });
  const stillHere = strip.some((tab) => tab.id === activeTabId);
  const nowActive = strip.find((tab) => tab.active)?.id;
  if (activeTabId !== undefined && stillHere && nowActive !== activeTabId) {
    await retrying(() => chrome.tabs.update(activeTabId, { active: true }));
  }
  if (collapsedGroupIds.size === 0) {
    return;
  }
  const expanded = await chrome.tabGroups.query({ windowId: targetWindowId, collapsed: false });
  for (const group of expanded) {
    if (collapsedGroupIds.has(group.id)) {
      await retrying(() => chrome.tabGroups.update(group.id, { collapsed: true }));
    }
  }
}

// Worker state for the length of one run only: a second trigger while tabs are still moving is
// ignored rather than interleaved with the first.
let running = false;

/**
 * Moves every tab of the other normal windows into the last-focused normal window, then focuses
 * it. Each source window is handled on its own: when one fails, whatever of it had not moved yet
 * stays in its window, and the remaining windows still merge. A window emptied by the moves is
 * closed by Chrome itself.
 */
export async function assembleTabs(): Promise<AssembleResult> {
  if (running) {
    return { status: 'busy' };
  }
  running = true;
  try {
    let target: chrome.windows.Window;
    try {
      target = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    } catch {
      // No normal window exists at all, so there is nothing to gather into.
      return { status: 'nothing-to-do' };
    }
    const targetWindowId = target.id;
    if (targetWindowId === undefined) {
      return { status: 'nothing-to-do' };
    }

    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const sources = pickSourceWindows(windows, target);
    if (sources.length === 0) {
      return { status: 'nothing-to-do' };
    }
    const activeTabId = target.tabs?.find((tab) => tab.active)?.id;
    const sourceIds = new Set(sources.map((source) => source.id));
    const collapsedGroupIds = new Set(
      (await chrome.tabGroups.query({ collapsed: true }))
        .filter((group) => sourceIds.has(group.windowId))
        .map((group) => group.id),
    );

    const failures: AssembleFailure[] = [];
    let mergedWindows = 0;
    for (const source of sources) {
      try {
        await runSteps(planWindowMoves(source.tabs ?? []), targetWindowId);
        mergedWindows += 1;
      } catch (error) {
        failures.push({ windowId: source.id ?? -1, error });
      }
    }

    try {
      await restoreTargetView(targetWindowId, activeTabId, collapsedGroupIds);
      await chrome.windows.update(targetWindowId, { focused: true });
    } catch (error) {
      failures.push({ windowId: targetWindowId, error });
    }
    return { status: 'done', mergedWindows, failures };
  } finally {
    running = false;
  }
}
