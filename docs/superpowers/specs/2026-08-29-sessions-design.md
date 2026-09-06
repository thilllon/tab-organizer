# Sessions (Session Buddy-style save/restore) — Design Spec

Status: **approved design — decisions recorded in §15** (2026-08-29)
Branch: `feat/sessions`

This spec was produced by a three-way design panel (identity-first / MV3-robustness / user-first lenses), judged, synthesized, and then cross-checked against an independent MV3 + privacy critique. Repo facts were verified against `src/background/index.ts`, `vite.config.ts`, `src/types.ts`, `docs/README.md`, `PRIVACY_POLICY.md`, `lefthook.yml`, `.github/workflows/ci.yml`.

Owner decisions (2026-08-29): history snapshots ON by default; `favicon` permission included; headline relaunch as **v7.0.0**; first store release only after Phases 0–5 are complete; lazy restore default `'auto'`. See §15.

---

## 1. Goals & non-goals

**Goals**

- Session Buddy parity for the core loop: save all/current windows in one action, restore exactly (windows, tab order, pinned, active tab, tab groups title/color/collapsed, window state), a full-page dashboard with open windows + saved sessions + history, crash/restart recovery, unified search, import/export (JSON/CSV/Markdown/text/Netscape HTML), copy links, thousands of tabs, local-first.
- The icon click stays byte-for-byte `sortTabGroups()`: no `default_popup`, no dialogs on the click path. The sort code (`sort.ts`, `sortTabGroups`, `sortTabs`, duplicate handlers) is not edited in any phase. (Amended — see §16.A.)
- Zero network requests, no content scripts, no accounts. The service worker wakes on user actions (click, context menu, shortcut, dashboard) and — because history snapshots are on by default — on the snapshot alarm; turning history off returns it to user-action-only.
- Every phase is independently shippable with accurate docs/privacy text and typecheck/biome/vitest/build green.

**Non-goals (deferred or rejected)**

- Collections/folders/tags, drag-and-drop editing, merging sessions, bookmarks management (revisit after Phase 6 on demand).
- `chrome.sidePanel` (400 px wide, extra permission, `openPanelOnActionClick` would hijack the click).
- Syncing session data via `chrome.storage.sync` (100 KB total / 8 KB per item / write-rate limits).
- Tab-event listeners (`chrome.tabs.on*`, `chrome.windows.on*`) in the service worker — ever. History uses alarms only.
- Session Buddy JSON import adapter (undocumented format; the importer is pluggable so it can be added later).
- IndexedDB, encryption, cloud backup, fuzzy search, i18n (`_locales`).
- Storing favicon URLs/data URIs (render from Chrome's local favicon cache instead).

---

## 2. Entry point UX

Left-click on the icon: unchanged. Four additive surfaces, none modal:

1. **Action-icon context menu** (`chrome.contextMenus`, `contexts: ['action']`, permission `contextMenus`). Created in `runtime.onInstalled` for every `reason` after `contextMenus.removeAll()` (idempotent). Items (ids): `save-window` "Save this window as session", `save-all` "Save all windows as session", separator, `open-dashboard` "Open Sessions". Feedback for a save: `chrome.action.setBadgeText({ text: '✓' })` + `setBadgeBackgroundColor`, cleared by a 2 s `setTimeout` (the worker stays alive ≥ 30 s after an event) **and** defensively by `clearBadge()` at the start of every handler in `src/background/sessions.ts` and in `onStartup`, so a stale badge cannot outlive the next interaction.
2. **Keyboard commands** (manifest `commands`, no permission): `save-session` (current window) and `open-dashboard`. Shipped **unbound** (no `suggested_key`) — Chrome silently drops conflicting suggestions and the UI must not promise a key. The dashboard empty state and the Options card have a "Set keyboard shortcuts" button that runs `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })` (allowed from extension pages). `_execute_action` is never defined.
3. **Options page**: a "Sessions" card with "Open Sessions dashboard" (`openDashboard()`) and, from Phase 3, the history toggle/interval.
4. **Dashboard** `dashboard.html` (full tab; React 19 + Tailwind 4 + shadcn, same stack as options). Header: "Save this window", "Save all windows", search box (Phase 4), Import/Export (Phase 5). Body: left "Open windows" pane (Phase 2), main "Saved sessions" list, collapsible "History" section (Phase 3). The dashboard talks to `chrome.*` directly — no service-worker round trip.

`openDashboard()` (`src/sessions/open-dashboard.ts`, used by the SW and the options page): `chrome.tabs.query({ url: chrome.runtime.getURL('dashboard.html') + '*' })`; if found, `tabs.update(id, { active: true })` + `windows.update(windowId, { focused: true })`; else `tabs.create`. This singleton behaviour also protects the dashboard from the sorter's own "close duplicates" option. Own extension pages (`url.startsWith(chrome.runtime.getURL(''))`) are excluded from every capture; a window containing only the dashboard yields no `WindowSnapshot`.

---

## 3. Data model (TypeScript) — `src/types.ts`

```ts
export const SESSION_SCHEMA_VERSION = 1 as const;
export type SessionId = string; // crypto.randomUUID()
export type SessionKind = "saved" | "history";
export type SessionOrigin =
  "manual" | "alarm" | "startup" | "recovered" | "import";
export type TabGroupColor = `${chrome.tabGroups.Color}`; // same form as hashStringToColor()

export interface TabSnapshot {
  url: string; // pendingUrl ?? url; suspender wrappers unwrapped via unwrapSuspendedUrl()
  title: string;
  pinned: boolean;
  active: boolean; // at most one true per window
  groupIndex?: number; // index into WindowSnapshot.groups; MUST be absent when pinned (Chrome cannot group pinned tabs)
}

export interface GroupSnapshot {
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowSnapshot {
  state: "normal" | "minimized" | "maximized" | "fullscreen";
  focused: boolean;
  bounds?: WindowBounds; // only when state === 'normal'
  groups: GroupSnapshot[]; // first-appearance order
  tabs: TabSnapshot[]; // tab-strip order; pinned first (Chrome invariant)
}

export interface Session {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: SessionId;
  kind: SessionKind;
  name: string;
  origin: SessionOrigin;
  createdAt: number; // epoch ms
  updatedAt: number;
  protected?: boolean; // history only: exempt from pruning (recovered / user-pinned)
  autoProtected?: boolean; // the pin came from promoteRecoveredSnapshot(), not from the user
  contentHash?: string; // FNV-1a over windows->tabs (url, pinned, groupIndex, group title); titles excluded
  windows: WindowSnapshot[]; // normal, non-incognito windows only; empty windows dropped
}

export interface SessionSummary {
  // what the index holds
  id: SessionId;
  kind: SessionKind;
  name: string;
  origin: SessionOrigin;
  createdAt: number;
  updatedAt: number;
  protected?: boolean;
  autoProtected?: boolean;
  contentHash?: string;
  windowCount: number;
  tabCount: number;
  bytes: number; // JSON length at last write
}

export interface SessionIndex {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessions: SessionSummary[]; // newest first
}

export interface SessionSettings {
  // chrome.storage.local key 'sessionSettings' (device-local; NOT sync)
  historyEnabled: boolean; // default true (owner decision)
  historyIntervalMinutes: 5 | 10 | 30; // default 5
  historyMaxSnapshots: number; // default 20 unprotected
  restoreLazy: "auto" | "always" | "never"; // default 'auto' = discard when tabCount > 50
}
export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  historyEnabled: true,
  historyIntervalMinutes: 5,
  historyMaxSnapshots: 20,
  restoreLazy: "auto",
};

export type ExportFormat = "json" | "markdown" | "text" | "html" | "csv";
export interface ExportBundle {
  app: "tab-organizer";
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  exportedAt: number;
  sessions: Session[];
}
```

Rules: Chrome runtime ids (tab/window/group) are never persisted; groups are referenced by index for portability; `SortSettings` in `chrome.storage.sync` is untouched. `migrate(record)` in `src/sessions/migrate.ts` is the identity for v1 and throws `UnknownSchemaVersionError` for newer versions (UI shows the record read-only).

---

## 4. Storage & quotas

- **Backend**: `chrome.storage.local` + `unlimitedStorage` (no install warning; the default quota is 10 MB and a power user — 10 sessions × 1,000 tabs + 20 snapshots × 500 tabs ≈ 5 MB at ~250 B/tab — gets too close).
- **Keys**: `session:<id>` → `Session`; `sessionIndex` → `SessionIndex`; `sessionSettings` → `SessionSettings`; `historyMeta` → `{ lastHash: string; lastSnapshotAt: number }`. Never one big array.
- **Writes** go through `src/sessions/storage.ts` (`sessionRepo`) and are serialized with `navigator.locks.request('tab-organizer:sessions', fn)` (Web Locks are shared across the SW and extension pages of the same origin). Order: body first, then index. Delete: body first, then index.
- **Reconcile** (`sessionRepo.reconcile()`): run on dashboard mount and `runtime.onStartup`/`onInstalled`. Uses `chrome.storage.local.getKeys()` (Chrome 130+; typed in @types/chrome 0.2.x) with a `get(null)`-then-`Object.keys` fallback guarded by `typeof chrome.storage.local.getKeys === 'function'`. Orphan `session:*` bodies are loaded one at a time and re-indexed; index entries without a body are dropped; an entry whose body no longer matches it (a rename interrupted between the two writes) is re-derived. Reconcile is the repair path, so it is the one reader that tolerates an unreadable index: it treats it as empty and rebuilds it from the bodies. Every _mutation_ still rejects on a future-schema index — a build must not overwrite a store written by a newer one. The index is the authoritative key source for everything else (search, export-all), so `get(null)` never runs on the hot path.
- **Reads**: the dashboard loads the index only; bodies are read on demand (expand/restore/search/export) through `sessionRepo`, never `chrome.storage` directly, and a read that needs more than one body batches them into a single request.
- **Quota errors**: every `set` wrapped; on quota rejection show a toast with a link to the storage meter (`getBytesInUse()`) and "Delete old history".
- **Migration**: `schemaVersion` on `Session` and `SessionIndex`; `migrate()` lazily on read and eagerly (one key at a time, under the lock) in `onInstalled` when `details.reason === 'update'`.
- **Delete all data**: a "Delete all session data" action (dashboard settings row, Phase 6 `StorageMeter`) that removes every `session:*` key, `sessionIndex`, `historyMeta` under the lock; required by the privacy policy wording.

---

## 5. Background / service-worker design

`src/background/index.ts` gains exactly one line: `import './sessions';` (amended — see §16.B). `src/background/sessions.ts` registers all listeners synchronously at module top level:

| Listener                                        | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.onInstalled`                           | `contextMenus.removeAll()` → create 3 items; `reconcile()`; run migrations on `update`; `ensureHistoryAlarm()` (P3). The existing onInstalled handler in `index.ts` remains as is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `runtime.onStartup`                             | `clearBadge()`; `reconcile()`; P3: `promoteRecoveredSnapshot()` then `ensureHistoryAlarm()` with a one-shot `alarms.create('history-first', { delayInMinutes: 1 })` so the first post-launch snapshot happens after Chrome finishes restoring tabs.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `contextMenus.onClicked` / `commands.onCommand` | `clearBadge()`; switch on id: `saveSession('window' \| 'all')` → `captureSession()` → `sessionRepo.put()` → badge ✓; or `openDashboard()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `alarms.onAlarm` (P3)                           | `history-snapshot` / `history-first` → `takeHistorySnapshot({ origin: 'alarm' })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `action.onClicked` (P3)                         | Second listener added in `sessions.ts` (not in `index.ts`), registered unconditionally at top level — MV3 forbids adding it later, so the `historyEnabled` gate lives inside `takeHistorySnapshot`, which returns `'disabled'` before touching any window: a click while history is off costs one storage read. Fire-and-forget, concurrently with the sort. The sort path is untouched and not awaited on; the snapshot captures URLs before `closeAllButOne` closes them (order may reflect an in-progress sort — acceptable, recovery is about URLs). The handler also calls `clearBadge()` first, so a worker torn down mid-timeout cannot leave a stale badge. |

Deliberately absent: `chrome.tabs.*`, `chrome.windows.*`, `chrome.tabGroups.*` listeners. Alarms are created/cleared only when `historyEnabled` changes (`storage.onChanged` on `sessionSettings` in the SW) and re-asserted in `onStartup`/`onInstalled` (alarms are cleared on extension update/reload). `alarms.create` with an existing name replaces it (no churn). No module-scope mutable state is relied on between events.

`captureSession(scope)` opens with one `Promise.all` of four calls: `chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })`, `chrome.tabGroups.query({})`, `chrome.windows.getLastFocused({ windowTypes: ['normal'] })` (which window the `'window'` scope means — the `{ windowId }` scope names its own) and a `chrome.storage.sync.get` for the suspender id, which the Options page can override. Then pure `captureWindows(windows, groups, { ownUrlPrefix, suspendedPrefix })` in `src/sessions/capture.ts`: filter `incognito`, drop own-extension tabs, drop empty windows, unwrap suspended urls, build `groups[]` by first appearance, strip `groupIndex` from pinned tabs, keep `bounds` only when `state === 'normal'`. Default name: `defaultSessionName(date, windowCount, tabCount)` → `"Session 2026-08-29 14:03 · 3 windows · 87 tabs"`.

**Suspender unwrapping** is deliberately split from the sorter: `capture.ts` imports `isSuspended` from `src/background/sort.ts` but not `tabToUrl`. `tabToUrl` parses the wrapper suffix with `URLSearchParams`, which corrupts the inner url — it cuts at its first `&` (`?v=abc&list=PL123` → `?v=abc`), decodes `%XX` and turns `+` into a space — a data-loss bug in the Phase 0–1 code, harmless for a sort key but not for a url we must reopen years later. `src/sessions/suspender.ts` (`unwrapSuspendedUrl`) instead mirrors the suspender's own parser: take everything after the first `uri=` parameter verbatim.

**Messaging protocol**: none required — dashboard/options are extension pages with full `chrome.*` access and share `sessionRepo` under the Web Lock. Restore runs in the dashboard page (never in the SW, so the 30 s idle / 5 min limits are irrelevant); progress is React state; `window.onbeforeunload` warns while a restore is in flight. If a page ever needs the SW, add `src/messages.ts` with `type Message = { type: 'open-dashboard' } | ...` and `sendMessage<T extends Message>()` returning `{ ok: true, data } | { ok: false, error }`; not planned in any phase.

---

## 6. Restore algorithm — `src/sessions/restore.ts`

Pure `planRestore(session, opts): RestorePlan` (unit-tested) + `executeRestore(plan, onProgress, signal)` (Chrome calls, runs in the page).

```
sanitizeRestoreUrl(url): string | null
  unwrap suspender wrapper (unwrapSuspendedUrl) → real url
  http(s), ftp, chrome://, chrome-extension://<own id>, about:blank → url
  file://  → url only if await chrome.extension.isAllowedFileSchemeAccess() else null
  javascript:, data:, view-source:, chrome-extension://<other id>, blob: → null
  windows.create/tabs.create rejections are still caught per tab (belt and braces)

planRestore(session, { target: {kind:'newWindows'} | {kind:'window', windowId}, lazy: 'auto'|'always'|'never', chunkSize = 25 })
  for each window w (non-empty after sanitize; skipped ones reported):
    tabs = w.tabs with url := sanitize(url), skip null (collect in plan.skipped)
    assert pinned tabs have no groupIndex; assert at most one active
    lazy := lazy==='always' || (lazy==='auto' && totalTabs > 50)
    emit steps: createWindow(w) | createTabs(chunks) | groupTabs | collapseGroups | activate | removePlaceholder | applyWindowState(w)

executeRestore(plan):
  for each window step-set:
    if target.kind === 'newWindows':
      win = await chrome.windows.create({ url: 'about:blank', focused: false,
              state: 'normal',                   // ALWAYS normal; any other state is applied post-hoc below
              ...(w.state==='normal' && clampToScreen(w.bounds, screen)) })
              // retried once without left/top/width/height if Chrome refuses the bounds
      placeholderId = win.tabs[0].id           // avoids: unopenable first URL aborting the window, unpinned seed
    else: windowId = target.windowId; placeholderId = undefined
    created: (number|undefined)[] = []
    for chunk of chunks(tabs, 25):             // pinned tabs are first in strip order by capture
      results = await Promise.all(chunk.map(t =>
        withRetryOnce(() => chrome.tabs.create({ windowId, url: t.url, pinned: t.pinned, active: false }),
                      isTabsCannotBeEditedError)          // "Tabs cannot be edited right now" (user dragging a tab)
          .catch(err => { errors.push({url:t.url, err}); return undefined })))
      created.push(...results.map(r => r?.id))
      if lazy: for each r where r && !t.active && !t.pinned:   // concurrently within the chunk
        if await waitForCommit(r.id):                      // poll tabs.get until url !== '' (50 ms, 5 s cap)
          await chrome.tabs.discard(r.id).catch(() => {})  // may return a NEW id; ignore "still initializing"
      onProgress(created.length, tabs.length); if signal.aborted break
      await new Promise(r => setTimeout(r, 0))            // yield
    // groups only after ALL tabs of this window exist (groups cannot be empty; order already contiguous)
    for gi, g of w.groups:
      ids = created.filter((id,i) => id && tabs[i].groupIndex === gi)
      if ids.length === 0 continue
      groupId = await chrome.tabs.group({ tabIds: [ids[0], ...ids.slice(1)], createProperties: { windowId } })
      await chrome.tabGroups.update(groupId, { title: g.title, color: g.color })
    for each group: await chrome.tabGroups.update(groupId, { collapsed: g.collapsed })  // last; placeholder is active so no active-tab conflict
    activeId = created[tabs.findIndex(t => t.active)] ?? first defined created
    if target.kind === 'newWindows' && activeId: await chrome.tabs.update(activeId, { active: true })
    if placeholderId: await chrome.tabs.remove(placeholderId).catch(()=>{})   // after activation so focus doesn't jump
    if target.kind === 'newWindows' && w.state !== 'normal': await chrome.windows.update(windowId, { state: w.state })
  focus the window whose snapshot had focused:true (or the last created non-minimized one)
  return { restored, discarded, skipped: plan.skipped, errors }   // dashboard toast: "Restored 410 of 412 tabs · 120 tabs will load when clicked · 2 could not be opened" with URL list
```

- **Restore into current window** (Phase 2): appended at the end; pinned tabs are created `pinned: true` and Chrome places them at the pinned edge (documented); groups recreated fresh; the session's active tab is not activated (user stays on the dashboard).
- **Single tab**: `chrome.tabs.create({ url, active: false })` in the current window.
- **Confirm** (shadcn dialog in the dashboard, not on the click path) when `tabCount > 100`, with the lazy checkbox; also before deleting a session.
- **Large sessions**: chunk 25 + yield; lazy discard above 50 tabs; cancel button (checked between chunks; created tabs stay); restoring never deletes the session; history snapshots restore identically.
- **Incognito**: never captured (filtered; invisible anyway unless "Allow in Incognito"); restore always creates normal windows.
- **Window state**: every window is created `{ state: 'normal', focused: false }` and _any_ non-normal state is applied afterwards with `windows.update`. Chrome rejects `windows.create` with "Invalid value for state" for `{ state: 'minimized', focused: true }`, for `{ state: 'maximized' | 'fullscreen', focused: false }`, and for any non-normal state combined with bounds — so no non-normal state can be created directly without either stealing focus or losing the bounds. Both the create-time restriction and the post-hoc path are asserted in the chrome fake and in `execute-restore.test.ts`. Consequence: a minimized window is not eligible for the "focus something" fallback, since focusing it would undo the state just applied.
- **Lazy discard** waits for the tab's navigation to commit (poll `tabs.get` until `url` is no longer `''`, 50 ms apart, 5 s cap) before calling `tabs.discard`. `tabs.discard` does _not_ reject on an uncommitted tab: it silently unloads it with `url: ''`, losing the URL for good — the exact opposite of what a restore is for. A tab that never commits within the cap is simply left loaded, not an error. Discarding may hand back a new tab id, so the plan keeps the returned one.
- `clampToScreen(bounds, screen)` fits saved bounds to the screen the dashboard is on. Bounds are virtual-desktop coordinates, so a window from a second monitor legitimately has `left >= availWidth` or `left < 0`. Rule: bounds overlapping this screen by at least 200×200 are clamped into it; bounds that overlap less than that — including not at all — are passed through unchanged, because dropping them default-places the window on the primary screen and a window straddling the seam must never be punished harder than one wholly on the other monitor; while its own monitor is attached Chrome puts it back exactly where it was, and when it is not, Chrome pulls an entirely off-screen window onto the nearest display itself. Only bounds whose _own_ size is under 200×200 are dropped (Chrome then places the window).

---

## 7. Search — `src/sessions/search.ts` (Phase 4)

- Two tiers. Tier 1 (instant, index only): session names. Tier 2 (bodies): tabs of saved sessions + open tabs (+ history when "Include history" is checked).
- Body cache: `Map<SessionId, SearchEntry[]>` in a `useSearchCorpus` hook; saved bodies are pre-warmed via `requestIdleCallback` after mount (bounded: stop after 5 MB, rest lazily on first query), invalidated per key by `storage.onChanged`; open tabs from `useOpenWindows`. Hostname precomputed once (`try { new URL() }`).
- `matchTab(entry, tokens)`: lowercase, whitespace tokens, every token substring of title | url | hostname (AND). Rank: hostname prefix > title match > url match, then source order open > saved > history, then recency. Debounce 100 ms; 200 results per source with "show more".
- Results render as **flat lists grouped by source** — matching session names, then open tabs, saved sessions, history — each with its count and a "Show more" button, not as the tree with matches auto-expanded. A flat ranked list is the better search UI (the ranking above is the point; the tree would re-impose capture order on it), and it is what makes one flat arrow-key index over all rows possible — a tree would need the index to track expand/collapse state. Enter opens the highlighted result; `/` focuses search, Esc clears, arrows navigate (the list scrolls the highlighted row into view itself, since focus stays in the search box). Highlighting via `splitOnMatches()`; no `dangerouslySetInnerHTML`.

---

## 8. Import / Export (Phase 5) — `src/sessions/export.ts`, `import.ts`, `guards.ts`

Pure functions, executed in the dashboard (`navigator.clipboard.writeText` and `<a download>` on a Blob URL need no permissions in extension pages; `downloads` permission is not added).

- **Export** (session / window / group / everything): `toJson` (`ExportBundle`), `toMarkdown` (`## Session` / `### Window N` / `#### Group` / `- [title](url)`, `(pinned)` marker), `toText` (one URL per line, blank line between windows), `toHtml` (Netscape bookmark format: `<!DOCTYPE NETSCAPE-Bookmark-file-1>`, `<DL><DT><H3>` per window/group, `<A HREF ADD_DATE>`), `toCsv` (`session,window,group,index,pinned,title,url`, RFC 4180 `csvEscape`). Filenames `tab-organizer-<slug>-<yyyyMMdd-HHmm>.<ext>`. Implementation order inside the phase: JSON + text + copy first (the round-trippable core), then Markdown/HTML/CSV.
- **Copy**: "Copy links" (text) and "Copy as Markdown" on tab/group/window/session rows.
- **Import** (file picker + paste textarea; `detectFormat(text)`): JSON via hand-written guards `isSession`/`isExportBundle` (no zod, no `any`) → `migrate()` → fresh ids, `origin: 'import'`, name suffix "(imported)"; Netscape HTML via a hand-written tokenizer over `<DL>`/`</DL>`/`<H3>`/`<A HREF>` plus an entity decoder (H3 nesting → window/group), **not** `DOMParser`: the parsers stay pure and run under Node with no DOM, so every one of them is unit-tested the same way as the rest of `src/sessions/`; text/Markdown via URL regex + `[title](url)` pairs, blank-line blocks → windows. Preview tree with counts before commit. `parsers: Array<(text) => Session[] | null>` so a Session Buddy adapter can be added.

---

## 9. Manifest & permission changes (`vite.config.ts` `defineManifest`)

| Phase | Change                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `build.rollupOptions.input = { options: 'options.html', dashboard: 'dashboard.html' }` (crxjs 2.x only auto-builds manifest-referenced HTML); `test: { setupFiles: ['src/test/setup.ts'] }` via `defineConfig` from `vitest/config`. `ci.yml`: add `pnpm test` (today CI runs typecheck/format/build only). |
| 1     | `permissions: ['tabs','tabGroups','storage','contextMenus','unlimitedStorage','favicon']` ; `commands: { 'save-session': { description: 'Save the current window as a session' }, 'open-dashboard': { description: 'Open the Sessions dashboard' } }` (no `suggested_key`).                                 |
| 3     | add `'alarms'`.                                                                                                                                                                                                                                                                                             |

The shipped manifest also declares `minimum_chrome_version: '123'` — the floor for the APIs used without a runtime guard: promise-form `contextMenus.removeAll()` (123) and the `favicon` permission / `_favicon/` endpoint (104). `storage.local.getKeys()` (130) sits behind a `typeof` guard, so it does not raise the floor. The build sets `build.modulePreload: { polyfill: false }`: Chrome has supported `<link rel="modulepreload">` natively since long before that floor, so the polyfill is dead code — and it ships a bare `fetch()` that a store reviewer auditing the zero-network claim would otherwise have to rule out by hand.

No `host_permissions`, no `default_popup`, no `side_panel`, no `downloads`, no `web_accessible_resources` change. None of the new permissions adds an install-time warning. Because the first store release (v7.0.0) ships after Phase 5, all four new permissions reach users in one update. Favicons render as `<img src={chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32')}>` from Chrome's local cache with a lucide `Globe` fallback on error — zero network.

---

## 10. Privacy / listing text that must change (shipped in the same PR as the manifest change)

- `docs/README.md` (Description section) "Only requests the three permissions it absolutely needs" → list all (with one-line reasons: contextMenus "adds Save/Open items to the icon's right-click menu"; unlimitedStorage "lets large saved sessions exceed the 10 MB local quota; data stays on device"; favicon "shows site icons from Chrome's local cache, no network"; alarms (P3) "timer for optional automatic snapshots, off by default").
- `docs/README.md` (Description section) "The service worker only activates when you click the icon" → "The service worker runs only when you click the icon, use its right-click menu or a keyboard shortcut — and, only if you turn on automatic snapshots, briefly on the interval you choose. It never contacts the network."
- `docs/README.md` (Description section) storage bullet → "…preferences via Chrome sync storage; saved sessions and snapshots (tab URLs, titles, group names, window layout) in local storage on this device only."
- Add a "SESSIONS" feature section + FAQ "Where are my saved sessions stored?" (local, not synced, never uploaded, delete anytime, Export for backup). v7.0.0 relaunch: the hero becomes "One-click tab sorting + a full session manager" — the one-click/no-popup promise stays in the first paragraph, followed by "Right-click the icon → Save session / Open Sessions." History being on by default must be disclosed up front ("automatic snapshots every 5 minutes, stored only on this device, can be turned off").
- `docs/README.md` Privacy → Permission justifications: replace "No personal or browsing data is stored" with the local-only disclosure; add sections for contextMenus, unlimitedStorage, favicon, (P3) alarms.
- `PRIVACY_POLICY.md`: Data Collection ("does not collect or transmit; when you save a session or enable automatic snapshots, tab URLs and titles are stored locally on your device only"), Permissions list, Data Usage, new "Data retention" paragraph (snapshot ring buffer, user deletion incl. "Delete all session data", uninstall clears), bump Last Updated.
- CWS privacy form: still "does not collect or transmit"; review the "Web history" data-type row with the "stored locally, not transmitted" justification.
- `AGENTS.md`: Runtime Model (three contexts), data flow, directory tree, permissions table, storage keys, "single write path through `sessionRepo` under the Web Lock" rule, "never add tab listeners to the SW" rule. `README.md` where it repeats claims.

(These edits land in whichever listing document is canonical at the time — see the store-listing docs work on `main`, which is expected to move the description into `docs/README.md`.)

---

## 11. File layout

As built (v7.0.0):

```
dashboard.html  options.html
vite.config.ts                         # manifest (permissions, commands, minimum_chrome_version), rollup input,
                                       #   modulePreload.polyfill = false, vitest setupFiles
src/types.ts                           # Session* types + WindowBounds + DEFAULT_SESSION_SETTINGS (SortSettings untouched)
src/global.d.ts
src/sessions/
  naming.ts (+test)                    # defaultSessionName, ensureUniqueName, slug
  capture.ts (+capture.test.ts, capture-session.test.ts)   # captureWindows (pure), captureSession (chrome wrapper),
                                       #   THE_MARVELLOUS_SUSPENDER_EXTENSION_ID + loadSuspendedPrefix (§16.B)
  suspender.ts (+test)                 # unwrapSuspendedUrl — verbatim `uri=` suffix, never URLSearchParams (§5)
  storage.ts (+test)                   # sessionRepo: listSummaries/get/put/rename/update/remove/removeAll/reconcile,
                                       #   migrateAll, settings, historyMeta, prune/protect/duplicate, withLock
  migrate.ts (+test)
  hash.ts (+test)                      # contentHash (FNV-1a)
  restore.ts (+restore.test.ts for the pure half, execute-restore.test.ts against the fake)
                                       # sanitizeRestoreUrl, planRestore, executeRestore, clampToScreen, withRetryOnce
  open-dashboard.ts (+test)
  shortcuts.ts (+test)                 # openShortcutSettings() → chrome://extensions/shortcuts (§2)
  history.ts (+test)                   # P3: takeHistorySnapshot, prune, promoteRecoveredSnapshot, ensureHistoryAlarm
  search.ts (+test)                    # P4
  export.ts, import.ts, guards.ts (+tests)   # P5
src/background/index.ts                # + `import './sessions'` and the shared suspender id (§16.B)
src/background/sessions.ts (+test)     # listeners: onInstalled/onStartup/contextMenus/commands/alarms/action, badge
src/background/sort.ts (+test)         # the sorter — untouched but for two bug fixes (§16.A)
src/dashboard/index.tsx, index.css     # imports ../options/index.css tokens
src/dashboard/Dashboard.tsx
src/dashboard/components/ SessionCard.tsx WindowTree.tsx GroupSection.tsx TabRow.tsx Favicon.tsx EmptyState.tsx
                          OpenWindowsPane.tsx CloseWindowDialog.tsx (P2)
                          SearchBar.tsx SearchResults.tsx (P4)
                          HistorySection.tsx HistoryRow.tsx RecoveredBanner.tsx (P3)
                          ExportMenu.tsx ImportDialog.tsx (P5)
                          StorageMeter.tsx QuotaNotice.tsx (P6) ProgressToast.tsx RestoreConfirmDialog.tsx
                          SessionSettingsRow.tsx SessionSettingsFields.tsx
                          DeleteSessionDialog.tsx DeleteAllHistoryDialog.tsx DeleteAllDataDialog.tsx
src/dashboard/hooks/ useSessionIndex.ts (+test) useSessionBody.ts (+test) useSessionSettings.ts useRestore.ts
                     useOpenWindows.ts (P2) useSearchCorpus.ts (P4)
src/dashboard/lib/                     # 24 pure modules, each with an adjacent test — the decisions the components
                                       #   would otherwise take inline, so the React layer stays thin (§13):
  download errors export-actions format group-colors import-preview open-tab open-windows quota
  restore-progress restore-summary row-keys sanitize-options search-corpus search-nav segments
  session-edit session-settings session-utils settings-change storage-meter tab-paging ui-state window-actions
src/components/ui/                     # via shadcn CLI as needed: badge, button, collapsible, dialog, dropdown-menu,
                                       #   input, label, radio-group, separator, switch. `tooltip` and `scroll-area`
                                       #   were never needed — SessionCard records why Radix's ScrollArea lost to a
                                       #   plain `max-h-96 overflow-y-auto` container.
src/lib/theme.ts (+test), utils.ts     # follow the OS dark mode; withDarkClass is the pure, tested half
src/options/Options.tsx, index.tsx, index.css, lib/sort-settings.ts (+test)   # Sessions card (P1); history toggle (P3)
src/test/setup.ts, chrome-fake.ts (+chrome-fake.test.ts)
                                       # typed in-memory chrome.storage.local (+onChanged, getKeys, getBytesInUse),
                                       #   tabs/windows/tabGroups (real strip model), alarms, navigator.locks. Its own
                                       #   test pins the Chrome behaviours the restore path depends on: the
                                       #   windows.create state rejections (§6) and discard-before-commit losing the url.
scripts/qa/ browser.ts server.ts fixtures.ts smoke.ts
                                       # real-Chrome QA harness: local static site (the QA browser has no network),
                                       #   fixture windows, and a save → restore → rename → delete smoke run
docs/README.md (listing + privacy answers; description.txt is generated) PRIVACY_POLICY.md AGENTS.md README.md
```

---

## 12. Phased implementation plan

Branch: `feat/sessions` off `main`; one PR per phase onto that branch, conventional commits `feat(sessions): …`. **Release plan (owner decision):** no store release until Phases 0–5 are complete; then merge to `main`, run the release-prep step below, and publish as **v7.0.0**. Phase 6 performance work may follow as v7.x. On this branch run pushes with `LEFTHOOK_EXCLUDE=update-docs` and do one deliberate docs pass per phase instead of letting the hook amend commits.

### Phase 0 — Scaffold & spike (no user-visible change; releasable as-is)

Tasks: add `dashboard.html` + `src/dashboard/index.tsx` placeholder and rollup input; verify crxjs builds and HMR-serves it; add `vitest/config` `test.setupFiles`; add `src/test/chrome-fake.ts` + `setup.ts`; add `src/types.ts` session types, `naming.ts`, `migrate.ts` with tests; add `pnpm test` to `ci.yml`.
Acceptance: `pnpm build` emits `dist/dashboard.html`; `pnpm test` runs the new tests locally and in CI; typecheck/biome green; manifest unchanged.

### Phase 1 — Save, list, restore (first release)

Tasks: `capture.ts` (+tests: groups by first appearance, pinned stripped of groupIndex, suspended unwrap, own pages/incognito/empty windows dropped, bounds only when normal); `storage.ts` with Web Lock, body-then-index, `reconcile()` via `getKeys()` (+tests incl. orphan/dangling/interrupted write); `hash.ts`; `restore.ts` `sanitizeRestoreUrl` + `planRestore` + `executeRestore` (+planner tests: chunk boundaries 25/26, placeholder step, pinned-first, group-after-all-tabs, collapse-last, activate-before-remove-placeholder, skipped URLs, retry-once); `src/background/sessions.ts` (menus, commands, badge, reconcile/migrate on install/startup) + one import line in `index.ts`; manifest permissions + commands; dashboard: header Save buttons, session list from `useSessionIndex` (`storage.onChanged`), `SessionCard` with inline rename, delete (confirm), Restore (new windows) per session and per window, expandable window→group→tab tree loading the body on demand, favicons, click tab → open in background, restore toast with skipped list, `beforeunload` guard, empty state with context-menu hint + "Set keyboard shortcuts"; Options "Sessions" card; docs/privacy/policy/AGENTS/README updates.
Acceptance: right-click icon → Save saves; ✓ badge appears and clears; dashboard lists it with correct counts; restore of a fixture (2 pinned, 2 groups one collapsed, suspended tab, one `file://` tab) recreates order/pinned/groups/collapsed/active and reports 1 skipped; stopping the SW in `chrome://serviceworker-internals` then using the menu works; reload keeps menus; plain click still only sorts; storage after 10 saves shows one key per session; all checks green.

### Phase 2 — Full dashboard: open windows pane, actions, restore-into-current

Tasks: `useOpenWindows` (`windows.getAll({ populate: true })` + tabs/tabGroups/windows listeners registered in the page, 150 ms coalesced refetch); `OpenWindowsPane` reusing `WindowTree` with Save this window / Close window / Go to tab / Close tab; `target: { windowId }` in restore + "Restore into this window"; per-window restore from a session; remove a tab/window from a saved session (updates body + index counts under lock); dashboard singleton focus tested.
Acceptance: opening/closing tabs updates the pane live without SW involvement (verify the SW stays inactive in `chrome://extensions`); restore-into-current appends tabs and recreates groups; no manifest change.

### Phase 3 — Automatic history & crash recovery

Tasks: add `alarms`; `SessionSettings` in `storage.local` + `useSessionSettings`; `history.ts`: `takeHistorySnapshot` (capture → hash vs `historyMeta.lastHash` → skip or write `kind: 'history'` → prune unprotected beyond `historyMaxSnapshots`, never touching `saved`), `ensureHistoryAlarm`, `promoteRecoveredSnapshot` (on `onStartup`: newest unprotected alarm snapshot → `origin: 'recovered'`, name "Previous session (recovered) <date>", `protected: true`), one-shot `history-first` alarm 1 min after startup; `sessions.ts` alarm handlers + `storage.onChanged` re-arm; optional concurrent pre-sort snapshot listener; dashboard History section (collapsed by default): timestamps, counts, Restore, "Save as session" (copy to `saved`), Protect toggle, Delete, "Delete all unprotected"; toggle/interval in dashboard settings row and Options; recovered banner on first dashboard open after startup; docs wording changes for alarms and the SW sentence.
Acceptance: with history off, no alarm exists (`chrome.alarms.getAll()` in the SW console) and the SW stays idle; with it on at 5 min, identical consecutive states produce no new snapshot (test + manual); the ring holds ≤ N unprotected; kill Chrome and relaunch → "recovered" snapshot present and restorable; extension reload keeps the alarm.

### Phase 4 — Unified search

Tasks: `search.ts` tokenizer/matcher/ranker (+tests incl. unicode, 10k-entry perf < 20 ms); `useSearchCorpus` with idle pre-warm and per-key invalidation; `SearchBar`/`SearchResults` with per-source counts, "Include history" checkbox, keyboard (`/`, Esc, arrows, Enter); highlighting helper.
Acceptance: typing filters open tabs and saved sessions within one frame at 10k tabs; result actions focus/open correctly; no `dangerouslySetInnerHTML`.

### Phase 5 — Import / export / copy

Tasks: `export.ts` five serializers (+tests: CSV quoting, HTML escaping, pinned/group rendering, empty groups); `guards.ts` (+malformed-input tests); `import.ts` detect + parsers (+tests, round-trip JSON exact); `ExportMenu` on rows, header "Export all (JSON backup)" / "Import", `ImportDialog` with preview and commit; docs bullet + FAQ.
Acceptance: JSON export → import round-trips a fixture exactly (new ids); exported HTML imports into Chrome bookmarks; pasting a URL list creates a one-window session; malformed JSON is rejected with a message.

### Release prep — v7.0.0 (after Phase 5, before publishing)

Tasks: `scripts/prepare-registration.ts` gains dashboard screenshots (sessions list, restore progress, search, import dialog) and a rebranded promo template ("Sort tabs in one click · Save and restore sessions"); rewrite the store listing (`docs/README.md` description, permissions, privacy) for v7 per §10; bump `PRIVACY_POLICY.md` date; `pnpm release` with `--increment major`; CWS privacy form re-review ("Web history: stored locally, not transmitted").
Acceptance: `screenshots/` regenerated; listing text mentions every permission and the default-on snapshots; manual QA matrix (§13) passed on the release build.

### Phase 6 — Scale & polish

Tasks: lazy restore 'auto' UX + progress/cancel polish; `content-visibility: auto` on rows, then a minimal windowed list if a 10k-tab fixture shows jank (no new dep unless needed); `StorageMeter` (`getBytesInUse`) with pruning hint and "Delete all session data"; ARIA tree roles, focus rings, `aria-label` on icon-only buttons; optional Playwright smoke test (`launchPersistentContext` with `--load-extension=dist`: save → restore → assert tab count); refresh `scripts/prepare-registration.ts` for dashboard screenshots.
Acceptance: a 1,000-tab restore completes without freezing, cancel works; a dashboard with 10k rows scrolls at 60 fps; smoke test green if included.

---

## 13. Testing strategy

- Keep the repo pattern: pure modules with adjacent `*.test.ts`; Chrome calls in thin wrappers. Vitest `setupFiles` installs `src/test/chrome-fake.ts` on `globalThis.chrome` (typed against @types/chrome 0.2.x, no `any`) with a real tab-strip model (ids, index bookkeeping, pinned ordering, groups), `storage.local` (`get/set/remove/getKeys/getBytesInUse/onChanged`), `alarms` with `fire(name)`, and a `navigator.locks` shim.
- Critical scenarios: capture invariants (pinned ⇒ no groupIndex, single active, suspended unwrap, exclusions); planner (chunking, step order, sanitize, skipped reporting); `executeRestore` against the fake (final strip equals snapshot; one failing `tabs.create` does not abort; retry-once on "cannot be edited"; discard never called on active/pinned; collapse after grouping; placeholder removed last); storage (index order, rename, remove, removeAll, reconcile orphan/dangling, interleaved writes under lock); hash stability (title changes don't change hash; order does); history (dedupe skip, prune never touches saved, protected exempt, recovery promotion); search (AND tokens, ranking, perf); export/import (escaping, round-trip, guards on malformed input); migrate (identity, unknown version error).
- React components stay thin; manual QA checklist per phase in the PR description: save/restore matrix (pinned, groups incl. collapsed, suspended, `file://`, `chrome://`, 300 tabs), SW stop via `chrome://serviceworker-internals`, extension reload (menus/alarm persist), plain icon click still only sorts, storage inspection, alarm cadence, crash relaunch.
- CI: typecheck, format, **test** (added in Phase 0), build. Phase 6 optional Playwright smoke test (already a devDependency).

---

## 14. Risks

- Identity drift (popup, click opening dashboard) — refused by plan; QA step "click only sorts" every phase.
- Stale privacy copy — doc edits are tasks in the same PR as each manifest change; the CWS "Web history" row needs the local-only justification.
- Restore fidelity: unopenable URLs skipped with report; discarded tabs show the URL as title until loaded; bounds may be clamped; minimized/maximized/fullscreen applied post-hoc.
- Large restores: chunk 25 + yield, lazy above 50, confirm above 100, cancel; the user closing the dashboard mid-restore leaves partial windows (beforeunload warning; already-created tabs are kept).
- Storage growth with history on: hash dedupe + ring buffer + meter; `unlimitedStorage` from Phase 1.
- Web Locks unavailable on some Chromium forks → `withLock` falls back to a page-local promise chain; reconcile repairs any drift.
- `getKeys()` requires Chrome 130+ → guarded fallback to `get(null)` only inside reconcile.
- Alarm cleared on update/reload → re-asserted in `onInstalled`/`onStartup`; if `historyEnabled` and no alarm, history silently stops — covered by manual QA.
- The sorter still moves the dashboard tab like any other tab; with "close duplicates" on, a second dashboard tab would be closed — the singleton `openDashboard()` makes that a non-issue. The sort code is deliberately not changed.
- crxjs second HTML entry/HMR — resolved in Phase 0 before any UI work.
- `@types/chrome` 0.2.x names (`windowTypes`, `getKeys`, `TabGroups.Color`) — verify in Phase 0; the repo already uses `` `${chrome.tabGroups.Color}` ``.
- Lefthook `update-docs` amending commits on the feature branch — excluded per push (`LEFTHOOK_EXCLUDE=update-docs`), one manual docs pass per phase.

---

## 15. Decisions (owner, 2026-08-29)

1. **History default — ON.** Session Buddy parity; the service-worker claim is reworded from the first release (§10). `ensureHistoryAlarm()` runs in `onInstalled` for fresh installs; the dashboard settings row and Options expose the off switch prominently.
2. **Favicon permission — included** (Phase 1; zero network).
3. **Versioning/branding — v7.0.0 relaunch** with new screenshots/promo and a rewritten listing; first release only after Phases 0–5.
4. **Restore-lazy default — `'auto'`** (discard non-active, non-pinned tabs when a restore exceeds 50 tabs).

---

## 16. Amendments (2026-09, as built)

Two constraints stated above were broken while building v7.0.0. Everything else in this document has been corrected in place to match the shipped code.

### A. §1 "the sort code is not edited in any phase" — `sort.ts` was edited twice

Both edits are bug fixes forced by exposing sort settings the engine already read; neither touches `sortTabGroups`, `sortTabs` or the duplicate handlers, and the icon click is still byte-for-byte `sortTabGroups()`.

1. **`tabToUrl` must never throw** (commit `75701f2`, +29/−3). It gained a total `toUrlOrUnknown()` helper and now prefers `pendingUrl` in the `groupSuspendedTabs` branch too, as the other branch already did. Chrome reports a still-loading tab as `url: ''` with its destination in `pendingUrl`, and the old `new URL(tab.url ?? '')` **threw** on such a tab, aborting the whole sort mid-window with nothing surfaced to the user — reachable from the default url mode, and newly reachable from the custom mode once v7 exposed the `groupSuspendedTabs` switch on the Options page. One behaviour change: a tab with no usable url no longer throws, it collates to a sentinel host (`https://zzzzzzzzzzzzzzzz.invalid/`) that sorts after every real key, so unknown tabs land together at the end of the window.
2. **`preserveOrderWithinGroups` is now honoured while `groupSuspendedTabs` is on.** Its comparator branch in `sortByCustom` was gated on `!gsSuspended`, so the setting silently did nothing for that combination — invisible until v7 put both switches on the Options page. By that point in the comparator the pair is always same-partition (the suspended/normal split returns −1/1 for every cross-partition pair), so honouring the setting there cannot compare a suspended tab against a normal one; the suspended block's order from that pass is discarded anyway and re-sorted with `gsSuspended = false`.

### B. §5 "`src/background/index.ts` gains exactly one line" — it gained two, plus a comment

Besides `import './sessions';`, `index.ts` now imports `THE_MARVELLOUS_SUSPENDER_EXTENSION_ID` from `src/sessions/capture.ts`, where the constant moved.

Reason: the sorter and the sessions feature read the very same `tabSuspenderExtensionId` setting and both need the default. Declaring the literal twice invites the two halves to drift apart on a suspender rename; one exported constant cannot. Behaviour-neutral — same id, same default, no new call at startup.
