import { captureWindowsWithIds, loadSuspendedPrefix } from '@/sessions/capture';
import type { GroupSnapshot, TabSnapshot, WindowSnapshot } from '@/types';

/**
 * One live browser window, shaped like a `WindowSnapshot` so the saved-session tree components
 * render it unchanged, but carrying the Chrome runtime ids the pane's actions need (go to tab,
 * close tab, close window, save this window).
 *
 * These ids are **in-memory only**. Nothing here is ever written to storage — the save path goes
 * through `captureSession()`, which builds its own id-free snapshot (spec §3).
 */
export interface OpenWindowView {
  windowId: number;
  focused: boolean;
  state: WindowSnapshot['state'];
  groups: (GroupSnapshot & { groupId: number })[];
  tabs: (TabSnapshot & { tabId: number })[];
}

export interface SnapshotOpenWindowsOptions {
  /** `chrome.runtime.getURL('')` — tabs whose url starts with this are our own pages, and hidden. */
  excludeUrlPrefix?: string;
}

/**
 * Reads every normal, non-incognito window with `windows.getAll({ populate: true })` +
 * `tabGroups.query({})` (two calls, exactly like `captureSession`) and applies the same capture
 * rules: incognito and non-normal windows dropped, own extension pages hidden, pinned tabs never
 * carrying a `groupIndex`, groups in first-appearance order.
 *
 * Unlike a capture it keeps a window whose tabs were all hidden — that is the window the dashboard
 * itself lives in, which the pane must still show (see `captureWindowsWithIds`).
 */
export async function snapshotOpenWindows(
  options: SnapshotOpenWindowsOptions = {},
): Promise<OpenWindowView[]> {
  // The suspender prefix is read too, so a suspended tab shows the page it stands for rather than
  // `chrome-extension://<suspender>/suspended.html#…` — the same url a save of it would store.
  const [windows, groups, suspendedPrefix] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    loadSuspendedPrefix(),
  ]);
  return captureWindowsWithIds(windows, groups, {
    ownUrlPrefix: options.excludeUrlPrefix ?? '',
    suspendedPrefix,
  }).map((window) => ({
    windowId: window.windowId,
    focused: window.focused,
    state: window.state,
    groups: window.groups,
    tabs: window.tabs,
  }));
}

/** Spec §12 Phase 2: one refetch per burst of tab/window/group activity. */
export const OPEN_WINDOWS_DEBOUNCE_MS = 150;

/**
 * The slice of `chrome.events.Event` this module uses. A zero-argument listener is assignable to
 * every one of these events, so the same callback can be registered on all of them.
 */
interface ChangeEvent {
  addListener(callback: () => void): void;
  removeListener(callback: () => void): void;
}

/**
 * Every event that can change what `snapshotOpenWindows()` returns. All of them are typed in
 * `@types/chrome` and modelled by the test fake.
 *
 * Registered **in the page** (AGENTS.md: the service worker never gets a tab listener) — they die
 * with the dashboard tab, so the worker stays idle while the pane is live.
 */
function changeEvents(): ChangeEvent[] {
  return [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onUpdated,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached,
    chrome.tabs.onActivated,
    chrome.tabs.onReplaced,
    chrome.tabGroups.onCreated,
    chrome.tabGroups.onUpdated,
    chrome.tabGroups.onRemoved,
    chrome.tabGroups.onMoved,
    chrome.windows.onCreated,
    chrome.windows.onRemoved,
    chrome.windows.onFocusChanged,
  ];
}

/**
 * Calls `onChange` once per burst: the first event starts a `debounceMs` timer and every further
 * event until it fires is folded into that same call. Deliberately not a resetting debounce —
 * dragging a tab or closing a window emits a steady stream of events, and a resetting timer would
 * postpone the refetch for as long as the stream lasts.
 *
 * The returned function removes every listener and cancels a pending timer, so nothing fires after
 * the component that subscribed has unmounted.
 */
export function subscribeOpenWindows(
  onChange: () => void,
  options: { debounceMs?: number } = {},
): () => void {
  const delay = options.debounceMs ?? OPEN_WINDOWS_DEBOUNCE_MS;
  const events = changeEvents();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (timer !== undefined) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, delay);
  };

  for (const event of events) {
    event.addListener(schedule);
  }

  return () => {
    for (const event of events) {
      event.removeListener(schedule);
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
