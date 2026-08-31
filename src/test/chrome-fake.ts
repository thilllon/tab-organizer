/**
 * In-memory fake of the subset of `chrome.*` used by this extension.
 *
 * Only the promise-returning overloads are implemented. The fake keeps a real
 * tab-strip model (ids, index bookkeeping, pinned-first ordering, groups) so
 * capture/restore code can be tested end to end without a browser.
 *
 * The single cast to `typeof chrome` lives at the end of `createChromeFake()` and is explained there.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface FakeEvent<T extends (...args: never[]) => void> {
  addListener(callback: T): void;
  removeListener(callback: T): void;
  hasListener(callback: T): boolean;
  hasListeners(): boolean;
  emit(...args: Parameters<T>): void;
}

export function makeEvent<T extends (...args: never[]) => void>(): FakeEvent<T> {
  const listeners = new Set<T>();
  return {
    addListener(callback) {
      listeners.add(callback);
    },
    removeListener(callback) {
      listeners.delete(callback);
    },
    hasListener(callback) {
      return listeners.has(callback);
    },
    hasListeners() {
      return listeners.size > 0;
    },
    emit(...args) {
      // Copy so a listener that removes itself does not break iteration.
      for (const callback of [...listeners]) {
        callback(...args);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type FakeWindowState = `${chrome.windows.WindowState}`;
export type FakeGroupColor = `${chrome.tabGroups.Color}`;
export type FakeTabStatus = `${chrome.tabs.TabStatus}`;

export interface FakeWindow {
  id: number;
  focused: boolean;
  state: FakeWindowState;
  incognito: boolean;
  type: 'normal';
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  pendingUrl?: string;
  title: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  discarded: boolean;
  incognito: boolean;
  status: FakeTabStatus;
}

export interface FakeGroup {
  id: number;
  windowId: number;
  title: string;
  color: FakeGroupColor;
  collapsed: boolean;
}

export interface FakeState {
  windows: Map<number, FakeWindow>;
  tabs: Map<number, FakeTab>;
  groups: Map<number, FakeGroup>;
  local: Map<string, unknown>;
  sync: Map<string, unknown>;
  badge: { text: string; color?: string };
  menus: chrome.contextMenus.CreateProperties[];
  alarms: Map<string, chrome.alarms.AlarmCreateInfo>;
  createdTabs: chrome.tabs.CreateProperties[];
  nextId: { tab: number; window: number; group: number };
  fileAccessAllowed: boolean;
  /** Testing-only knob (Task 8 fix round 2): when true, `tabs.create` leaves the tab
   * uncommitted (`url: ''`, `pendingUrl` set, `status: 'loading'`) until `commitNavigation`
   * is called for it, modelling a real browser navigation that has not finished yet. */
  deferCommit: boolean;
}

export type FailableApi =
  | 'tabs.create'
  | 'tabs.group'
  | 'tabs.discard'
  | 'tabGroups.update'
  | 'windows.create'
  | 'storage.local.set';

export interface FakeFire {
  installed(details: chrome.runtime.InstalledDetails): void;
  startup(): void;
  menuClicked(menuItemId: string): void;
  command(name: string): void;
  alarm(name: string): void;
  actionClicked(tab?: chrome.tabs.Tab): void;
}

export interface ChromeFake {
  chrome: typeof chrome;
  state: FakeState;
  fire: FakeFire;
  failNext(api: FailableApi, times: number, message: string): void;
  /** Moves `pendingUrl` -> `url` and sets `status: 'complete'`, as Chrome does on commit. */
  commitNavigation(tabId: number): void;
}

const NO_GROUP = -1;

// ---------------------------------------------------------------------------
// Converters (fake state -> @types/chrome shapes)
// ---------------------------------------------------------------------------

function toChromeTab(tab: FakeTab): chrome.tabs.Tab {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    pinned: tab.pinned,
    active: tab.active,
    highlighted: tab.active,
    selected: tab.active,
    groupId: tab.groupId,
    discarded: tab.discarded,
    incognito: tab.incognito,
    frozen: false,
    autoDiscardable: true,
    lastAccessed: 0,
    status: tab.status,
  };
}

function toChromeGroup(group: FakeGroup): chrome.tabGroups.TabGroup {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    shared: false,
  };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createChromeFake(): ChromeFake {
  const state: FakeState = {
    windows: new Map(),
    tabs: new Map(),
    groups: new Map(),
    local: new Map(),
    sync: new Map(),
    badge: { text: '' },
    menus: [],
    alarms: new Map(),
    createdTabs: [],
    nextId: { tab: 1, window: 1, group: 1 },
    fileAccessAllowed: false,
    deferCommit: false,
  };

  // One focused, empty, normal window so `tabs.create()` without a windowId works.
  state.windows.set(state.nextId.window, {
    id: state.nextId.window,
    focused: true,
    state: 'normal',
    incognito: false,
    type: 'normal',
    left: 0,
    top: 0,
    width: 1280,
    height: 800,
  });
  state.nextId.window += 1;

  // ---- failure injection -------------------------------------------------

  const failures = new Map<FailableApi, { remaining: number; message: string }>();

  function maybeFail(api: FailableApi): void {
    const entry = failures.get(api);
    if (!entry) {
      return;
    }
    if (entry.remaining <= 0) {
      failures.delete(api);
      return;
    }
    entry.remaining -= 1;
    if (entry.remaining === 0) {
      failures.delete(api);
    }
    throw new Error(entry.message);
  }

  // ---- tab-strip helpers -------------------------------------------------

  function stripOf(windowId: number): FakeTab[] {
    return [...state.tabs.values()]
      .filter((tab) => tab.windowId === windowId)
      .sort((a, b) => a.index - b.index);
  }

  /** Enforces Chrome's invariant: pinned tabs first, indices 0..n-1 contiguous. */
  function reindex(windowId: number): void {
    const strip = stripOf(windowId);
    const pinned = strip.filter((tab) => tab.pinned);
    const unpinned = strip.filter((tab) => !tab.pinned);
    [...pinned, ...unpinned].forEach((tab, index) => {
      tab.index = index;
    });
  }

  function activate(tab: FakeTab): void {
    for (const sibling of stripOf(tab.windowId)) {
      sibling.active = sibling.id === tab.id;
    }
  }

  /**
   * Last-focused window, honouring `QueryOptions.windowTypes` like Chrome does. Every fake
   * window is `type: 'normal'`, so the filter is a no-op today; it exists so
   * `getLastFocused({ windowTypes: ['normal'] })` (capture, Task 9) is exercised as written.
   */
  function focusedWindow(windowTypes?: chrome.windows.QueryOptions['windowTypes']): FakeWindow {
    const candidates = [...state.windows.values()].filter(
      (window) => windowTypes === undefined || windowTypes.includes(window.type),
    );
    const focused = candidates.find((window) => window.focused);
    const fallback = candidates[0];
    const window = focused ?? fallback;
    if (!window) {
      throw new Error('No window.');
    }
    return window;
  }

  function requireWindow(windowId: number): FakeWindow {
    const window = state.windows.get(windowId);
    if (!window) {
      throw new Error(`No window with id: ${windowId}.`);
    }
    return window;
  }

  function requireTab(tabId: number): FakeTab {
    const tab = state.tabs.get(tabId);
    if (!tab) {
      throw new Error(`No tab with id: ${tabId}.`);
    }
    return tab;
  }

  function requireGroup(groupId: number): FakeGroup {
    const group = state.groups.get(groupId);
    if (!group) {
      throw new Error(`No group with id: ${groupId}.`);
    }
    return group;
  }

  function insertTab(
    windowId: number,
    props: { url?: string; pinned?: boolean; active?: boolean; index?: number },
  ): FakeTab {
    requireWindow(windowId);
    const strip = stripOf(windowId);
    const tab: FakeTab = {
      id: state.nextId.tab,
      windowId,
      index: 0,
      url: props.url ?? 'about:blank',
      title: props.url ?? 'about:blank',
      pinned: props.pinned ?? false,
      active: false,
      groupId: NO_GROUP,
      discarded: false,
      incognito: false,
      status: 'complete',
    };
    state.nextId.tab += 1;
    const position = Math.min(props.index ?? strip.length, strip.length);
    strip.splice(position, 0, tab);
    strip.forEach((entry, index) => {
      entry.index = index;
    });
    state.tabs.set(tab.id, tab);
    reindex(windowId);
    const shouldActivate = (props.active ?? true) || strip.length === 1;
    if (shouldActivate) {
      activate(tab);
    }
    return tab;
  }

  function removeTab(tabId: number): void {
    const tab = requireTab(tabId);
    state.tabs.delete(tabId);
    const strip = stripOf(tab.windowId);
    if (strip.length === 0) {
      state.windows.delete(tab.windowId);
    } else {
      reindex(tab.windowId);
      if (tab.active) {
        const next = strip[Math.min(tab.index, strip.length - 1)];
        if (next) {
          activate(next);
        }
      }
    }
    dropEmptyGroups();
  }

  function dropEmptyGroups(): void {
    for (const group of state.groups.values()) {
      const members = [...state.tabs.values()].some((tab) => tab.groupId === group.id);
      if (!members) {
        state.groups.delete(group.id);
      }
    }
  }

  function toChromeWindow(window: FakeWindow, populate: boolean): chrome.windows.Window {
    return {
      id: window.id,
      focused: window.focused,
      state: window.state,
      incognito: window.incognito,
      type: window.type,
      left: window.left,
      top: window.top,
      width: window.width,
      height: window.height,
      alwaysOnTop: false,
      tabs: populate ? stripOf(window.id).map(toChromeTab) : undefined,
    };
  }

  // ---- storage -------------------------------------------------------------

  type Changes = { [key: string]: chrome.storage.StorageChange };
  type AreaName = `${chrome.storage.AreaName}`;

  const storageChanged = makeEvent<(changes: Changes, areaName: AreaName) => void>();

  function bytesOf(key: string, value: unknown): number {
    return key.length + JSON.stringify(value).length;
  }

  function makeArea(map: Map<string, unknown>, areaName: AreaName, failKey?: FailableApi) {
    const onChanged = makeEvent<(changes: Changes) => void>();

    function emit(changes: Changes): void {
      if (Object.keys(changes).length === 0) {
        return;
      }
      onChanged.emit(changes);
      storageChanged.emit(changes, areaName);
    }

    function keysOf(
      keys: string | string[] | Record<string, unknown> | null | undefined,
    ): string[] {
      if (keys === null || keys === undefined) {
        return [...map.keys()];
      }
      if (typeof keys === 'string') {
        return [keys];
      }
      if (Array.isArray(keys)) {
        return keys;
      }
      return Object.keys(keys);
    }

    return {
      onChanged,
      async get(
        keys?: string | string[] | Record<string, unknown> | null,
      ): Promise<Record<string, unknown>> {
        const result: Record<string, unknown> = {};
        const defaults =
          keys !== null && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        for (const key of keysOf(keys)) {
          if (map.has(key)) {
            result[key] = structuredClone(map.get(key));
          } else if (key in defaults) {
            result[key] = defaults[key];
          }
        }
        return result;
      },
      async set(items: Record<string, unknown>): Promise<void> {
        if (failKey) {
          maybeFail(failKey);
        }
        const changes: Changes = {};
        for (const [key, value] of Object.entries(items)) {
          if (value === undefined) {
            continue;
          }
          const oldValue = map.has(key) ? structuredClone(map.get(key)) : undefined;
          const newValue = structuredClone(value);
          map.set(key, newValue);
          changes[key] = { oldValue, newValue: structuredClone(newValue) };
        }
        emit(changes);
      },
      async remove(keys: string | string[]): Promise<void> {
        const changes: Changes = {};
        for (const key of keysOf(keys)) {
          if (map.has(key)) {
            changes[key] = { oldValue: structuredClone(map.get(key)) };
            map.delete(key);
          }
        }
        emit(changes);
      },
      async clear(): Promise<void> {
        const changes: Changes = {};
        for (const [key, value] of map) {
          changes[key] = { oldValue: structuredClone(value) };
        }
        map.clear();
        emit(changes);
      },
      async getKeys(): Promise<string[]> {
        return [...map.keys()];
      },
      async getBytesInUse(keys?: string | string[] | null): Promise<number> {
        let total = 0;
        for (const key of keysOf(keys)) {
          if (map.has(key)) {
            total += bytesOf(key, map.get(key));
          }
        }
        return total;
      },
    };
  }

  const local = makeArea(state.local, 'local', 'storage.local.set');
  const sync = makeArea(state.sync, 'sync');

  // ---- tabs ----------------------------------------------------------------

  const tabs = {
    async query(info: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
      const urlPatterns =
        info.url === undefined
          ? []
          : (Array.isArray(info.url) ? info.url : [info.url]).map(globToRegExp);
      const focusedId =
        info.currentWindow || info.lastFocusedWindow ? focusedWindow().id : undefined;
      return [...state.tabs.values()]
        .filter((tab) => info.windowId === undefined || tab.windowId === info.windowId)
        .filter((tab) => focusedId === undefined || tab.windowId === focusedId)
        .filter((tab) => info.active === undefined || tab.active === info.active)
        .filter((tab) => info.pinned === undefined || tab.pinned === info.pinned)
        .filter((tab) => info.groupId === undefined || tab.groupId === info.groupId)
        .filter((tab) => info.index === undefined || tab.index === info.index)
        .filter((tab) => info.title === undefined || tab.title === info.title)
        .filter((tab) => info.discarded === undefined || tab.discarded === info.discarded)
        .filter((tab) => urlPatterns.length === 0 || urlPatterns.some((re) => re.test(tab.url)))
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index)
        .map(toChromeTab);
    },
    async create(props: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
      maybeFail('tabs.create');
      const windowId = props.windowId ?? focusedWindow().id;
      const tab = insertTab(windowId, {
        url: props.url,
        pinned: props.pinned,
        active: props.active,
        index: props.index,
      });
      // Models a real browser: `tabs.create` resolves before navigation commits. The URL
      // moves from `pendingUrl` to `url` only when `commitNavigation` is called for this tab.
      if (state.deferCommit && props.url !== undefined) {
        tab.pendingUrl = tab.url;
        tab.url = '';
        tab.status = 'loading';
      }
      // Recorded only after insertTab succeeds: a rejected create (failNext, or an
      // unknown windowId thrown by requireWindow inside insertTab) must not appear here.
      state.createdTabs.push({ ...props });
      return toChromeTab(tab);
    },
    async update(tabId: number, props: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
      const tab = requireTab(tabId);
      if (props.url !== undefined) {
        tab.url = props.url;
      }
      if (props.pinned !== undefined) {
        tab.pinned = props.pinned;
        if (props.pinned) {
          tab.groupId = NO_GROUP;
          dropEmptyGroups();
        }
        reindex(tab.windowId);
      }
      if (props.active) {
        activate(tab);
      }
      return toChromeTab(tab);
    },
    async remove(tabIds: number | number[]): Promise<void> {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) {
        removeTab(id);
      }
    },
    async move(
      tabIds: number | number[],
      props: chrome.tabs.MoveProperties,
    ): Promise<chrome.tabs.Tab | chrome.tabs.Tab[]> {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      const moved: FakeTab[] = [];
      for (const id of ids) {
        const tab = requireTab(id);
        const targetWindowId = props.windowId ?? tab.windowId;
        requireWindow(targetWindowId);
        const sourceWindowId = tab.windowId;
        tab.windowId = targetWindowId;
        const strip = stripOf(targetWindowId).filter((entry) => entry.id !== tab.id);
        const position = props.index < 0 ? strip.length : Math.min(props.index, strip.length);
        strip.splice(position, 0, tab);
        strip.forEach((entry, index) => {
          entry.index = index;
        });
        reindex(targetWindowId);
        if (sourceWindowId !== targetWindowId) {
          reindex(sourceWindowId);
        }
        moved.push(tab);
      }
      const converted = moved.map(toChromeTab);
      const single = converted[0];
      return Array.isArray(tabIds) || single === undefined ? converted : single;
    },
    async group(options: chrome.tabs.GroupOptions): Promise<number> {
      maybeFail('tabs.group');
      const ids = Array.isArray(options.tabIds)
        ? options.tabIds
        : options.tabIds === undefined
          ? []
          : [options.tabIds];
      const members = ids.map(requireTab);
      const first = members[0];
      if (!first) {
        throw new Error('No tabs given.');
      }
      if (members.some((tab) => tab.pinned)) {
        throw new Error('Tabs cannot be pinned and grouped.');
      }
      let group: FakeGroup;
      if (options.groupId !== undefined) {
        group = requireGroup(options.groupId);
      } else {
        const windowId = options.createProperties?.windowId ?? first.windowId;
        requireWindow(windowId);
        group = {
          id: state.nextId.group,
          windowId,
          title: '',
          color: 'grey',
          collapsed: false,
        };
        state.nextId.group += 1;
        state.groups.set(group.id, group);
      }
      for (const tab of members) {
        tab.groupId = group.id;
      }
      dropEmptyGroups();
      return group.id;
    },
    async ungroup(tabIds: number | number[]): Promise<void> {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) {
        requireTab(id).groupId = NO_GROUP;
      }
      dropEmptyGroups();
    },
    async discard(tabId?: number): Promise<chrome.tabs.Tab | undefined> {
      maybeFail('tabs.discard');
      if (tabId === undefined) {
        return undefined;
      }
      const tab = requireTab(tabId);
      if (tab.active) {
        throw new Error('Cannot discard active tab');
      }
      tab.discarded = true;
      // Chrome does NOT reject when the tab's navigation has not committed yet: it silently
      // unloads the still-blank tab instead, permanently losing the intended URL.
      if (tab.url === '') {
        tab.status = 'unloaded';
      }
      return toChromeTab(tab);
    },
    async get(tabId: number): Promise<chrome.tabs.Tab> {
      return toChromeTab(requireTab(tabId));
    },
  };

  // ---- windows -------------------------------------------------------------

  /**
   * Chrome's own `windows.create` validation, verified against Chrome for Testing 151:
   * a minimized window can never be focused, a maximized/fullscreen one can never be created
   * unfocused, and no non-'normal' state may be combined with explicit bounds. All three reject
   * with the same message. Modelled here so `src/sessions/restore.ts` cannot regress into passing
   * a combination Chrome refuses (see the comment in `openTargetWindow`).
   */
  function rejectInvalidCreateState(data?: chrome.windows.CreateData): void {
    const state = data?.state;
    if (state === undefined) {
      return;
    }
    const invalidState =
      (state === 'minimized' && data?.focused === true) ||
      ((state === 'maximized' || state === 'fullscreen') && data?.focused === false);
    const hasBounds =
      data?.left !== undefined ||
      data?.top !== undefined ||
      data?.width !== undefined ||
      data?.height !== undefined;
    if (invalidState || (state !== 'normal' && hasBounds)) {
      throw new Error('Invalid value for state');
    }
  }

  const windows = {
    async getAll(options?: chrome.windows.QueryOptions): Promise<chrome.windows.Window[]> {
      const populate = options?.populate ?? false;
      const windowTypes = options?.windowTypes;
      return [...state.windows.values()]
        .filter((window) => windowTypes === undefined || windowTypes.includes(window.type))
        .map((window) => toChromeWindow(window, populate));
    },
    async getLastFocused(options?: chrome.windows.QueryOptions): Promise<chrome.windows.Window> {
      return toChromeWindow(focusedWindow(options?.windowTypes), options?.populate ?? false);
    },
    async getCurrent(options?: chrome.windows.QueryOptions): Promise<chrome.windows.Window> {
      return toChromeWindow(focusedWindow(options?.windowTypes), options?.populate ?? false);
    },
    async create(data?: chrome.windows.CreateData): Promise<chrome.windows.Window> {
      maybeFail('windows.create');
      rejectInvalidCreateState(data);
      const window: FakeWindow = {
        id: state.nextId.window,
        focused: data?.focused ?? true,
        state: data?.state ?? 'normal',
        incognito: data?.incognito ?? false,
        type: 'normal',
        left: data?.left ?? 0,
        top: data?.top ?? 0,
        width: data?.width ?? 1280,
        height: data?.height ?? 800,
      };
      state.nextId.window += 1;
      if (window.focused) {
        for (const other of state.windows.values()) {
          other.focused = false;
        }
      }
      state.windows.set(window.id, window);
      const urls =
        data?.url === undefined ? ['about:blank'] : Array.isArray(data.url) ? data.url : [data.url];
      urls.forEach((url, index) => {
        insertTab(window.id, { url, active: index === 0 });
      });
      return toChromeWindow(window, true);
    },
    async update(
      windowId: number,
      info: chrome.windows.UpdateInfo,
    ): Promise<chrome.windows.Window> {
      const window = requireWindow(windowId);
      if (info.state !== undefined) {
        window.state = info.state;
      }
      if (info.focused !== undefined) {
        if (info.focused) {
          for (const other of state.windows.values()) {
            other.focused = false;
          }
        }
        window.focused = info.focused;
      }
      if (info.left !== undefined) {
        window.left = info.left;
      }
      if (info.top !== undefined) {
        window.top = info.top;
      }
      if (info.width !== undefined) {
        window.width = info.width;
      }
      if (info.height !== undefined) {
        window.height = info.height;
      }
      return toChromeWindow(window, false);
    },
    async remove(windowId: number): Promise<void> {
      requireWindow(windowId);
      for (const tab of stripOf(windowId)) {
        state.tabs.delete(tab.id);
      }
      state.windows.delete(windowId);
      dropEmptyGroups();
    },
  };

  // ---- tabGroups -----------------------------------------------------------

  const tabGroups = {
    async query(info: chrome.tabGroups.QueryInfo): Promise<chrome.tabGroups.TabGroup[]> {
      return [...state.groups.values()]
        .filter((group) => info.windowId === undefined || group.windowId === info.windowId)
        .filter((group) => info.collapsed === undefined || group.collapsed === info.collapsed)
        .filter((group) => info.color === undefined || group.color === info.color)
        .filter((group) => info.title === undefined || group.title === info.title)
        .map(toChromeGroup);
    },
    async update(
      groupId: number,
      props: chrome.tabGroups.UpdateProperties,
    ): Promise<chrome.tabGroups.TabGroup> {
      maybeFail('tabGroups.update');
      const group = requireGroup(groupId);
      if (props.title !== undefined) {
        group.title = props.title;
      }
      if (props.color !== undefined) {
        group.color = props.color;
      }
      if (props.collapsed !== undefined) {
        group.collapsed = props.collapsed;
      }
      return toChromeGroup(group);
    },
    async move(
      groupId: number,
      props: chrome.tabGroups.MoveProperties,
    ): Promise<chrome.tabGroups.TabGroup> {
      const group = requireGroup(groupId);
      if (props.windowId !== undefined) {
        requireWindow(props.windowId);
        group.windowId = props.windowId;
      }
      return toChromeGroup(group);
    },
    async get(groupId: number): Promise<chrome.tabGroups.TabGroup> {
      return toChromeGroup(requireGroup(groupId));
    },
  };

  // ---- runtime / contextMenus / commands / action / alarms / extension -----

  const onInstalled = makeEvent<(details: chrome.runtime.InstalledDetails) => void>();
  const onStartup = makeEvent<() => void>();
  const onMenuClicked =
    makeEvent<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void>();
  const onCommand = makeEvent<(command: string, tab?: chrome.tabs.Tab) => void>();
  const onActionClicked = makeEvent<(tab: chrome.tabs.Tab) => void>();
  const onAlarm = makeEvent<(alarm: chrome.alarms.Alarm) => void>();

  const runtime = {
    id: 'fakeextid',
    lastError: undefined,
    getURL(path: string): string {
      return `chrome-extension://fakeextid/${path.replace(/^\//, '')}`;
    },
    getManifest(): chrome.runtime.Manifest {
      // Only `version` is read by the app; the rest of ManifestV3 is optional.
      return { manifest_version: 3, name: 'Tab Organizer', version: '7.0.0' };
    },
    onInstalled,
    onStartup,
  };

  const contextMenus = {
    create(props: chrome.contextMenus.CreateProperties, callback?: () => void): number | string {
      state.menus.push({ ...props });
      callback?.();
      return props.id ?? state.menus.length;
    },
    async removeAll(): Promise<void> {
      state.menus.length = 0;
    },
    onClicked: onMenuClicked,
  };

  const commands = { onCommand };

  const action = {
    async setBadgeText(details: chrome.action.BadgeTextDetails): Promise<void> {
      state.badge.text = details.text ?? '';
    },
    async setBadgeBackgroundColor(details: chrome.action.BadgeColorDetails): Promise<void> {
      state.badge.color =
        typeof details.color === 'string' ? details.color : details.color.join(',');
    },
    onClicked: onActionClicked,
  };

  const alarms = {
    async create(
      nameOrInfo: string | chrome.alarms.AlarmCreateInfo | undefined,
      maybeInfo?: chrome.alarms.AlarmCreateInfo,
    ): Promise<void> {
      const name = typeof nameOrInfo === 'string' ? nameOrInfo : '';
      const info =
        typeof nameOrInfo === 'string' || nameOrInfo === undefined ? maybeInfo : nameOrInfo;
      if (!info) {
        throw new Error('alarms.create: alarmInfo is required');
      }
      state.alarms.set(name, { ...info });
    },
    async clear(name?: string): Promise<boolean> {
      return state.alarms.delete(name ?? '');
    },
    async getAll(): Promise<chrome.alarms.Alarm[]> {
      return [...state.alarms.entries()].map(([name, info]) => ({
        name,
        periodInMinutes: info.periodInMinutes,
        persistAcrossSessions: true,
        scheduledTime: info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000,
      }));
    },
    onAlarm,
  };

  const extension = {
    async isAllowedFileSchemeAccess(): Promise<boolean> {
      return state.fileAccessAllowed;
    },
  };

  const api = {
    storage: { local, sync, onChanged: storageChanged },
    tabs,
    windows,
    tabGroups,
    runtime,
    contextMenus,
    commands,
    action,
    alarms,
    extension,
  };

  const fire: FakeFire = {
    installed(details) {
      onInstalled.emit(details);
    },
    startup() {
      onStartup.emit();
    },
    menuClicked(menuItemId) {
      onMenuClicked.emit({ menuItemId, editable: false }, undefined);
    },
    command(name) {
      onCommand.emit(name, undefined);
    },
    alarm(name) {
      onAlarm.emit({ name, persistAcrossSessions: true, scheduledTime: Date.now() });
    },
    actionClicked(tab) {
      if (tab) {
        onActionClicked.emit(tab);
        return;
      }
      const active = [...state.tabs.values()].find((entry) => entry.active);
      if (active) {
        onActionClicked.emit(toChromeTab(active));
      }
    },
  };

  return {
    // CAST (the only one that touches chrome typings): `api` implements just the
    // promise overloads of a subset of namespaces, while `typeof chrome` declares every
    // namespace plus callback overloads, `events.Event` rule methods, etc. Structural
    // assignability is therefore impossible; tests and app code only ever call the
    // members implemented above. Going through `unknown` keeps the cast honest (no
    // partial overlap check is silently satisfied).
    chrome: api as unknown as typeof chrome,
    state,
    fire,
    failNext(apiName, times, message) {
      failures.set(apiName, { remaining: times, message });
    },
    commitNavigation(tabId) {
      const tab = requireTab(tabId);
      if (tab.pendingUrl !== undefined) {
        tab.url = tab.pendingUrl;
        tab.pendingUrl = undefined;
      }
      tab.status = 'complete';
    },
  };
}

// ---------------------------------------------------------------------------
// Access from tests
// ---------------------------------------------------------------------------

declare global {
  // Installed by src/test/setup.ts before each test; `var` is required for a globalThis member.
  var __chromeFake: ChromeFake | undefined;
}

/**
 * Returns the fake installed by `src/test/setup.ts` for the current test.
 *
 * A module imported statically (at the top of a test file) evaluates before any
 * `beforeEach`, so listeners it registers at import time land on setup.ts's
 * throw-away module-level fake, not the one this function returns — load such a
 * module per test instead (`vi.resetModules(); await import(...)`) if its listeners
 * need to be reachable via `fire.*`. See the comment in setup.ts.
 */
export function getChromeFake(): ChromeFake {
  const fake = globalThis.__chromeFake;
  if (!fake) {
    throw new Error('Chrome fake not installed; is src/test/setup.ts in vitest setupFiles?');
  }
  return fake;
}
