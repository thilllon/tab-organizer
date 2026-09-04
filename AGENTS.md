# AGENTS.md

## Project Overview

**Tab Organizer** is a Chrome extension (Manifest V3) that sorts and organizes browser tabs and saves/restores sets of windows and tabs as sessions. It groups tabs by hostname/domain, handles duplicate tabs, supports suspended tab detection, and keeps a local-only session store (saved sessions plus automatic history snapshots, on by default) with unified search, import and export. All operations are entirely local with zero external data transmission.

- Repository: `https://github.com/thilllon/tab-organizer`
- Chrome Web Store: `https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg`
- License: Private

---

## Architecture

### Runtime Model

This is a **Chrome Extension** with three execution contexts:

1. **Background Service Worker** (`src/background/index.ts` + `src/background/sessions.ts`) — The core engine. Runs as a Manifest V3 service worker. `index.ts` handles tab sorting, grouping and duplicate detection, triggered by the icon click (`chrome.action.onClicked`). `sessions.ts` (imported by `index.ts` with a single `import './sessions';` line) registers, synchronously at module top level, the sessions listeners: `runtime.onInstalled` (recreate context menus; `sessionRepo.migrateAll()` when `details.reason === 'update'`, then `sessionRepo.reconcile()`, then `ensureHistoryAlarm()`), `runtime.onStartup` (clear badge, reconcile, `promoteRecoveredSnapshot()`, re-arm the periodic alarm, one-shot `history-first` alarm), `contextMenus.onClicked` and `commands.onCommand` (save window / save all / open dashboard), `alarms.onAlarm` (`takeHistorySnapshot({ origin: 'alarm' })`), a **second** `action.onClicked` listener (fire-and-forget `takeHistorySnapshot({ origin: 'manual' })` alongside the sort, which it never awaits or alters) and `storage.onChanged` (re-arm or clear the alarm when `sessionSettings` changes). The worker wakes only on those events — plus the history alarm while snapshots are enabled (the default); with snapshots off no alarm exists and it wakes on user actions only. There are **no** `chrome.tabs.on*` / `chrome.windows.on*` / `chrome.tabGroups.on*` listeners in the worker.
2. **Options Page** (`src/options/`) — A React SPA rendered in `options.html`. Configures sort settings (`chrome.storage.sync`) and has a "Sessions" card that renders the shared `SessionSettingsFields` — the snapshot switch, interval, "Keep last N snapshots" and lazy-restore mode (written to `sessionSettings` in `chrome.storage.local` through `sessionRepo.setSettings()`; the worker's `storage.onChanged` listener re-arms the alarm) — plus buttons that open the dashboard and the Chrome shortcuts page.
3. **Sessions Dashboard** (`src/dashboard/`) — A React SPA rendered in `dashboard.html` (second Vite/crxjs HTML entry, `build.rollupOptions.input`). Header: save buttons, the search box, Import and Export. Body: a live **Open windows** pane (`useOpenWindows` registers `chrome.tabs/windows/tabGroups.on*` listeners _in the page_ and refetches with a short coalescing delay), the **Saved sessions** list (index only; bodies on demand; rename, delete, remove a tab/window, export/copy, restore to new windows or into the window the dashboard itself is in), a collapsible **History** section (snapshots: restore, save as session, protect, delete, delete all unprotected; recovered banner after a browser restart) and a settings row (`SessionSettingsRow`: the same four `SessionSettingsFields` as the Options card, plus `StorageMeter` with its two-step "Delete all session data", which keeps `sessionSettings`). There is no theme control anywhere: both pages call `followSystemTheme()` (`src/lib/theme.ts`) once at startup and follow `prefers-color-scheme`. It **runs restores in the page** (never in the service worker, so the worker's idle/lifetime limits do not apply) and talks to `chrome.*` directly — there is no message passing to the worker. `openDashboard()` (`src/sessions/open-dashboard.ts`) is a singleton: it focuses an existing dashboard tab or creates one.

There is **no popup**, **no content script**, **no message-passing protocol** and **no external server**. The extension icon click directly triggers sorting and nothing else.

### Data Flow

Sorting (unchanged):

```
User clicks extension icon
-> chrome.action.onClicked listener (src/background/index.ts)
-> sortTabGroups()
-> Load settings from chrome.storage.sync
-> Query pinned tabs, tab groups, ungrouped tabs
-> Sort each set independently
-> Move tabs via chrome.tabs.move()
-> Handle duplicates (close or group)
```

Saving a session:

```
Right-click icon menu item / keyboard command / dashboard button
-> handleMenuOrCommand(id) (src/background/sessions.ts) or Dashboard.tsx
-> captureSession('window' | 'all' | { windowId }) (src/sessions/capture.ts)
-> chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
-> chrome.tabGroups.query({})
-> captureWindows(windows, groups, options) (pure: drops incognito, own pages, empty windows;
   unwraps suspended tabs; groups by first appearance)
-> sessionRepo.put(session) (src/sessions/storage.ts, under the Web Lock)
-> chrome.storage.local.set({ 'session:<id>': body })  // body first
-> chrome.storage.local.set({ sessionIndex })          // then index (newest first)
-> showSavedBadge() (worker only; cleared after 2 s and at the start of every handler)
```

Restoring a session (dashboard page only):

```
SessionCard Restore -> useRestore()
-> sessionRepo.get(id) + sessionRepo.getSettings()
-> planRestore(session, { target, lazy, sanitize }) (pure: sanitizeRestoreUrl, chunks of 25)
-> executeRestore(plan, { onProgress, signal, screen })
-> windows.create placeholder -> tabs.create per chunk (retry once on "cannot be edited")
-> tabs.discard non-active/non-pinned when lazy -> tabs.group + tabGroups.update after all tabs
-> collapse groups -> activate -> remove placeholder -> apply minimized/maximized/fullscreen
-> ProgressToast with restored / skipped / errors
```

History snapshot (service worker; the alarm, or the icon click while snapshots are on):

```
alarms.onAlarm('history-snapshot' | 'history-first') / second action.onClicked listener
-> takeHistorySnapshot({ origin }) (src/sessions/history.ts)
-> sessionRepo.getSettings(): 'disabled' when historyEnabled is false (no window query at all)
-> captureSession('all') -> contentHash(windows) vs historyMeta.lastHash -> 'skipped-unchanged'
-> sessionRepo.put({ kind: 'history', name: 'Snapshot <stamp> · N windows · M tabs' })
-> sessionRepo.pruneHistory(historyMaxSnapshots)   // oldest unprotected history first; never 'saved'
-> sessionRepo.setHistoryMeta({ lastHash, lastSnapshotAt })
```

Search, export and import run entirely in the dashboard page: `useSearchCorpus` builds `SearchEntry[]` per session body (pre-warmed on idle, invalidated per key by `storage.onChanged`) plus the open-windows snapshot and feeds `search()` from `src/sessions/search.ts`; `ExportMenu` calls the pure serializers in `src/sessions/export.ts` and hands the text to `src/dashboard/lib/download.ts` (Blob URL + `<a download>` — no `downloads` permission) or to the clipboard; `ImportDialog` runs `importSessions()` from `src/sessions/import.ts` (type guards in `guards.ts`), shows a preview, then `sessionRepo.put()` per session.

Sort settings are persisted in `chrome.storage.sync` and loaded fresh on every sort invocation. Session data and `sessionSettings` live in `chrome.storage.local` and are read through `sessionRepo` only. The dashboard reloads its list when `chrome.storage.onChanged` reports a change to `sessionIndex`, and `useSessionSettings` re-reads on a `sessionSettings` change.

### Directory Structure

```
tab-organizer/
├── src/
│   ├── background/
│   │   ├── index.ts          # Service worker: sort orchestration, Chrome API calls, action.onClicked; imports './sessions'
│   │   ├── sessions.ts       # Service worker: context menus, commands, badge, reconcile on install/startup
│   │   ├── sessions.test.ts  # Tests against the chrome fake
│   │   ├── sort.ts           # Pure sorting/grouping logic (extracted for testability)
│   │   └── sort.test.ts      # Unit tests for sort.ts (vitest)
│   ├── sessions/              # Session domain logic (pure where possible, thin chrome wrappers)
│   │   ├── naming.ts (+test)      # defaultSessionName(), slugify()
│   │   ├── migrate.ts (+test)     # migrateSession(), migrateIndex(), UnknownSchemaVersionError
│   │   ├── hash.ts (+test)        # contentHash() — FNV-1a over urls/pinned/group index/group title
│   │   ├── capture.ts (+test)     # captureWindows()/captureWindowsWithIds() (pure) + captureSession(),
│   │   │                          #   loadSuspendedPrefix() (the one chrome.storage.sync read)
│   │   ├── storage.ts (+test)     # sessionRepo, withLock(), storage keys — the ONLY writer of session data
│   │   ├── restore.ts (+test)     # sanitizeRestoreUrl(), clampToScreen(), planRestore() (pure), executeRestore()
│   │   ├── suspender.ts (+test)   # unwrapSuspendedUrl() — verbatim remainder after `uri=` (capture + restore)
│   │   ├── history.ts (+test)     # takeHistorySnapshot(), promoteRecoveredSnapshot(), ensureHistoryAlarm(), scheduleFirstSnapshot()
│   │   ├── search.ts (+test)      # tokenizer / matcher / ranker over SearchEntry[] (open > saved > history)
│   │   ├── export.ts (+test)      # toJson/toMarkdown/toText/toHtml/toCsv, scopeToSession(), exportFilename()
│   │   ├── import.ts (+test)      # detectFormat(), parseJson/parseNetscapeHtml/parseTextOrMarkdown, importSessions()
│   │   ├── guards.ts (+test)      # hand-written type guards for external data (isSession, isExportBundle, …)
│   │   ├── open-dashboard.ts      # openDashboard() singleton
│   │   └── shortcuts.ts           # openShortcutSettings() — shared by Options and the dashboard
│   ├── dashboard/
│   │   ├── index.tsx          # React entry point for dashboard.html
│   │   ├── index.css          # @import '../options/index.css'
│   │   ├── Dashboard.tsx      # Header (save/search/import/export) + open-windows pane + session list + history + settings
│   │   ├── hooks/             # useSessionIndex, useSessionBody, useRestore, useOpenWindows (page-side tab listeners),
│   │   │                      #   useSessionSettings, useSearchCorpus
│   │   ├── lib/               # Page-side helpers (+ adjacent tests): download, errors, export-actions, format,
│   │   │                      #   group-colors, import-preview, open-tab, open-windows, quota, restore-progress,
│   │   │                      #   restore-summary, row-keys, sanitize-options, search-corpus, search-nav,
│   │   │                      #   segments, session-edit, session-settings, session-utils, settings-change,
│   │   │                      #   storage-meter, tab-paging, ui-state (sessionStorage), window-actions
│   │   └── components/        # SessionCard, WindowTree, GroupSection, TabRow, Favicon, ProgressToast, EmptyState,
│   │                          #   RestoreConfirmDialog, DeleteSessionDialog, DeleteAllHistoryDialog,
│   │                          #   DeleteAllDataDialog, CloseWindowDialog, OpenWindowsPane, HistorySection,
│   │                          #   HistoryRow, RecoveredBanner, SessionSettingsRow, SessionSettingsFields,
│   │                          #   SearchBar, SearchResults, ExportMenu, ImportDialog, StorageMeter, QuotaNotice
│   ├── options/
│   │   ├── index.tsx          # React entry point
│   │   ├── Options.tsx        # Settings UI component + "Sessions" card
│   │   └── index.css          # Tailwind CSS with shadcn theme
│   ├── components/ui/         # Reusable UI components (shadcn/ui via the CLI: button, radio-group, label, input,
│   │                          #   dialog, dropdown-menu, badge, separator, collapsible, switch)
│   ├── lib/
│   │   ├── utils.ts           # cn() utility (clsx + tailwind-merge)
│   │   └── theme.ts (+test)   # followSystemTheme()/withDarkClass() — dark mode follows the OS, no setting
│   ├── test/
│   │   ├── chrome-fake.ts     # Typed in-memory chrome.* fake (storage, tabs, windows, tabGroups, menus, alarms)
│   │   ├── chrome-fake.test.ts # Tests for the fake itself
│   │   └── setup.ts           # vitest setupFiles: installs the fake on globalThis.chrome + navigator.locks shim
│   ├── types.ts               # Shared TypeScript types (SortSettings + Session* types)
│   └── global.d.ts            # Vite client type declarations
├── public/
│   └── img/                   # Extension logos (SVG, ICO, 16/32/48/128px PNG)
├── scripts/
│   ├── qa/                    # Committed real-Chrome QA harness (tsx, not vitest)
│   │   ├── smoke.ts           # 11-step sessions smoke test: pnpm build && pnpm exec tsx scripts/qa/smoke.ts
│   │   ├── browser.ts         # launchExtension() — a real Chromium with dist/ loaded (shared with screenshots)
│   │   ├── server.ts          # startDemoServer() — 127.0.0.1 fixture pages (the QA browser has no network)
│   │   └── fixtures.ts        # Session fixtures seeded straight into chrome.storage.local
│   ├── zip.ts                 # Packages dist/ into package/<name>-<version>.zip for Web Store (archiver 8)
│   ├── generate-ico.ts        # Generates multi-size .ico from SVG (macOS: qlmanage + sips)
│   ├── prepare-registration.ts # Full visual-asset pipeline (build, sort + the five dashboard-*.png screenshots,
│   │                          #   video, promo images, demo.gif, description.txt); every optional step has a SKIP_* flag
│   ├── build-listing.ts       # docs/README.md `### Description` -> docs/description.txt (CWS plain text); + build-listing.test.ts
│   ├── promo-template.html    # HTML template for CWS promotional images
│   ├── tab-bar-template.html  # HTML template for tab bar mockup screenshots
│   └── get-window-id.py       # macOS window-bounds helper for screenshot cropping
├── screenshots/               # Generated CWS assets (sort + dashboard-*.png screenshots, promo images, demo video)
├── docs/
│   ├── README.md              # Chrome Web Store listing — single source of truth (text, assets, privacy answers)
│   └── description.txt        # GENERATED by `pnpm listing`; paste into the store's Description field
├── .github/
│   ├── workflows/
│   │   ├── ci.yml             # CI pipeline (typecheck, format, build; tools via mise)
│   │   └── codeql.yml         # CodeQL security scanning
│   └── dependabot.yml         # Weekly npm + GitHub Actions updates (minor/patch grouped)
├── options.html               # Options page HTML entry
├── dashboard.html             # Sessions dashboard HTML entry (second rollup input)
├── docs/superpowers/specs/    # Design specs (2026-08-29-sessions-design.md is the sessions spec)
├── vite.config.ts             # Vite + CRX plugin config (manifest defined here)
├── tsconfig.json              # TypeScript config (strict mode)
├── tsconfig.node.json         # TypeScript config for vite.config.ts
├── biome.json                 # Biome linter/formatter config
├── .prettierrc.json           # Prettier config (Markdown/YAML; pnpm-lock.yaml ignored via .prettierignore)
├── .release-it.json           # release-it config (hooks run prepare-registration, build, zip)
├── lefthook.yml               # Git hooks (pre-commit: format + listing; pre-push: typecheck/test/build/docs)
├── mise.toml                  # Tool versions (Node, pnpm, Python, uv, ruff, lefthook) + `format` task (ruff)
├── pyproject.toml             # Python deps for scripts/ (pyobjc Quartz) + ruff config
├── components.json            # shadcn/ui configuration
├── PRIVACY_POLICY.md          # Privacy policy (update when permissions change)
└── package.json
```

---

## Key Source Files

### `src/background/index.ts` — Orchestration & Chrome APIs

Handles event listeners, settings loading, Chrome API calls (`tabs.move`, `tabs.group`, `tabGroups.update`), and duplicate tab handling. Imports pure sorting logic from `sort.ts`.

| Function                | Purpose                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `sortTabGroups()`       | Main orchestrator. Loads settings, queries tabs, delegates to sort functions, handles duplicates.      |
| `sortTabs()`            | Sorts a set of tabs and moves them via Chrome API. Dispatches to `sortByTitleOrUrl` or `sortByCustom`. |
| `handleDuplicateTabs()` | Finds duplicate URLs and either closes extras or groups them.                                          |
| `closeDuplicateTabs()`  | Keeps active/first tab, closes the rest.                                                               |
| `groupDuplicateTabs()`  | Groups duplicate tabs into a Chrome tab group.                                                         |

### `src/background/sort.ts` — Pure Sorting Logic

Contains all pure sorting and grouping functions, extracted for testability. No Chrome API side effects.

| Function                   | Purpose                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `sortByTitleOrUrl()`       | Sorts tabs alphabetically by title or URL. Handles suspended tab grouping and pinned tab exclusion. |
| `sortByCustom()`           | Groups tabs by hostname/domain, preserving first-seen order. Supports LTR/RTL grouping direction.   |
| `findDuplicateTabs()`      | Returns a `Map<url, Tab[]>` of URLs with more than one tab.                                         |
| `extractGroupingKey()`     | Parses hostname into grouping key. In `domain` mode, handles two-part TLDs (e.g., `co.uk`).         |
| `isSuspended()`            | Checks if a tab is suspended by The Marvellous Suspender.                                           |
| `tabToUrl()`               | Extracts real URL from suspended tabs by parsing the `uri` query parameter.                         |
| `compareByUrlComponents()` | Compares URLs by hostname (without `www.`) + path + search + hash.                                  |
| `hashStringToColor()`      | Deterministically maps a string to a Chrome tab group color.                                        |
| `updateTabGroupMap()`      | Tracks first-seen ordering of tab groups by hostname or title.                                      |

### `src/background/sessions.ts` — Sessions listeners (service worker)

Registers listeners synchronously at module top level; imported by `index.ts`. Exports for tests: `MENU_IDS = { saveWindow: 'save-window', saveAll: 'save-all', openDashboard: 'open-dashboard' }`, `COMMAND_IDS = { saveSession: 'save-session', openDashboard: 'open-dashboard' }` (must equal the `commands` block in `vite.config.ts`), `registerContextMenus()`, `handleMenuOrCommand(id)`, `showSavedBadge()`, `showErrorBadge()`, `clearBadge()`. Alarm names come from `src/sessions/history.ts` (`HISTORY_ALARM = 'history-snapshot'`, `HISTORY_FIRST_ALARM = 'history-first'`).

| Listener                                        | Behaviour                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.onInstalled`                           | `contextMenus.removeAll()` then create the 3 menu items plus a separator (idempotent); on `details.reason === 'update'` runs `sessionRepo.migrateAll()` first (errors caught locally); then `sessionRepo.reconcile()`; then `ensureHistoryAlarm()` (Chrome drops every alarm on update/reload). |
| `runtime.onStartup`                             | `clearBadge()`; `sessionRepo.reconcile()`; `promoteRecoveredSnapshot()` (errors caught locally); `ensureHistoryAlarm(settings)`; `scheduleFirstSnapshot(settings)` (one-shot `history-first`, 1 min out, so the first capture happens after Chrome has restored its tabs).                      |
| `contextMenus.onClicked` / `commands.onCommand` | `clearBadge()`; `save-window`/`save-session` → capture current window; `save-all` → all windows; `open-dashboard`. A save runs the name through `ensureUniqueName()` and shows `showErrorBadge()` when nothing was capturable or the write failed.                                              |
| `alarms.onAlarm`                                | `history-snapshot` / `history-first` → `takeHistorySnapshot({ origin: 'alarm' })`; other alarm names ignored. `takeHistorySnapshot` returns `'disabled'` itself when history is off, so no settings read here.                                                                                  |
| `action.onClicked` (second listener)            | `takeHistorySnapshot({ origin: 'manual' })`, fire-and-forget, concurrent with the sort in `index.ts` (never awaited by it, never alters it). Costs one storage read while history is off. Errors are reported, never thrown — the click must keep sorting.                                      |
| `storage.onChanged`                             | `areaName === 'local'` and `sessionSettings` in `changes` → `ensureHistoryAlarm()` (re-reads through `sessionRepo.getSettings()` for the same normalisation as every other read). Re-arms on interval change, clears both alarms when history is turned off.                                    |

### `src/sessions/` — Session domain

| Module              | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming.ts`         | `defaultSessionName(date, windowCount, tabCount)`, `ensureUniqueName(name, existingNames)`, `slugify(name)`                                                                                                                                                                                                                                                                                                                                                           |
| `migrate.ts`        | `migrateSession(record)`, `migrateIndex(record)`, `UnknownSchemaVersionError` (identity for v1; unknown versions throw and the UI shows the record read-only)                                                                                                                                                                                                                                                                                                         |
| `hash.ts`           | `contentHash(windows)`, `fnv1a32(input)` — titles excluded, so a title change never produces a new snapshot                                                                                                                                                                                                                                                                                                                                                           |
| `capture.ts`        | `captureWindows(windows, groups, options)` (pure), `captureWindowsWithIds(...)` (same, runtime ids kept, in-memory only — the open-windows pane), `captureSession(scope, name?)` with `CaptureScope = 'window' \| 'all' \| { windowId }`, `loadSuspendedPrefix()`, `THE_MARVELLOUS_SUSPENDER_EXTENSION_ID`                                                                                                                                                            |
| `storage.ts`        | `sessionRepo` (`listSummaries`, `get`, `put`, `rename`, `update` (read-modify-write under the lock; return `null` to delete), `remove`, `removeAll`, `reconcile`, `migrateAll`, `getSettings`, `setSettings`, `getHistoryMeta`, `setHistoryMeta`, `pruneHistory`, `setProtected`, `markRecovered`, `duplicateAsSaved`, `removeAllHistory`), `withLock`, `toSummary`, `HistoryMeta`, `INDEX_KEY`, `SETTINGS_KEY`, `HISTORY_META_KEY`, `sessionKey`, `LOCK_NAME`        |
| `restore.ts`        | `sanitizeRestoreUrl`, `clampToScreen`, `planRestore` (pure), `executeRestore`, `withRetryOnce`, `isTabsCannotBeEditedError`, `isLazyRestore(lazy, tabCount)`, `screenRectOf(screen)`; `RestoreTarget = { kind: 'newWindows' } \| { kind: 'window'; windowId }`; `DEFAULT_CHUNK_SIZE = 25`, `LAZY_AUTO_THRESHOLD = 50`                                                                                                                                                 |
| `suspender.ts`      | `unwrapSuspendedUrl(url, prefix)` — returns the raw remainder after the first `uri=` parameter (the suspender appends the real url unencoded, so `URLSearchParams` would corrupt it); `null` for a wrapper without `uri=`                                                                                                                                                                                                                                             |
| `history.ts`        | `takeHistorySnapshot({ origin })` → `{ outcome: 'saved' \| 'skipped-empty' \| 'skipped-unchanged' \| 'disabled', sessionId?, pruned }`, `promoteRecoveredSnapshot()` (newest unprotected alarm/manual/startup snapshot captured after the last recovered one → `origin: 'recovered'`, protected, renamed), `ensureHistoryAlarm(settings?)`, `scheduleFirstSnapshot(settings?)`, `defaultHistoryName`, `recoveredSnapshotName`, `HISTORY_ALARM`, `HISTORY_FIRST_ALARM` |
| `search.ts`         | `SearchEntry`, `SEARCH_SOURCES` (`'open' \| 'saved' \| 'history'`), `entriesFrom*` builders (hostname precomputed once), `search(entries, query, { limitPerSource, includeHistory })` (`DEFAULT_LIMIT_PER_SOURCE = 200`), `splitOnMatches` for result highlighting — lowercase whitespace tokens, AND over title/url/hostname, rank hostname-prefix > title > url, then source order, then recency; per-source `count`/`hasMore`                                      |
| `export.ts`         | `ExportScope` (session / window / group), `scopeToSession`, `toJson` (`ExportBundle`), `toMarkdown`, `toText`, `toHtml` (Netscape bookmark file), `toCsv` (`CSV_HEADER = 'session,window,group,index,pinned,title,url'`, RFC 4180 `csvEscape`), `escapeHtml`, `serialize(format, …)`, `exportFilename(base, format, date)` → `tab-organizer-<slug>-<yyyyMMdd-HHmm>.<ext>`, `extensionFor`, `mimeTypeFor`                                                              |
| `import.ts`         | `ImportFormat = 'json' \| 'html' \| 'markdown' \| 'text'` (CSV is export-only), `detectFormat(text)`, `parseJson`, `parseNetscapeHtml` (own tokenizer — no `DOMParser`, so it runs under vitest), `parseTextOrMarkdown` (blank line = new window, `(pinned)` marker), `importSessions(text, now)` → sessions with fresh ids, `kind: 'saved'`, `origin: 'import'`, name suffix "(imported)"                                                                            |
| `guards.ts`         | `isRecord`, `isTabSnapshot`, `isGroupSnapshot`, `isWindowSnapshot` (checks `groupIndex` bounds and ≤ 1 active tab), `isSession`, `isExportBundle` — tolerant of extra fields, strict on required ones; the only validation path for pasted/uploaded data                                                                                                                                                                                                              |
| `open-dashboard.ts` | `openDashboard()` — focuses the existing dashboard tab or opens one                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shortcuts.ts`      | `openShortcutSettings()`, `SHORTCUTS_URL` — `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })`, used by Options and the dashboard                                                                                                                                                                                                                                                                                                                         |

### `src/types.ts` — Shared Types

All shared types are defined here. Both the service worker and the options page import from this file.

```typescript
type SortBy = "url" | "title" | "custom";
type GroupFrom = "leftToRight" | "rightToLeft";
type DuplicateTabHandling = "none" | "closeAllButOne" | "group";
type GroupingMode = "subdomain" | "domain";

interface SortSettings {
  sortBy: SortBy;
  groupFrom: GroupFrom;
  preserveOrderWithinGroups: boolean;
  groupSuspendedTabs: boolean;
  tabSuspenderExtensionId: string;
  sortPinnedTabs: boolean;
  duplicateTabHandling: DuplicateTabHandling;
  groupingMode: GroupingMode;
}
```

Session types (spec §3): `SESSION_SCHEMA_VERSION`, `SessionId`, `SessionKind` (`'saved' | 'history'`), `SessionOrigin`, `TabGroupColor`, `TabSnapshot`, `GroupSnapshot`, `WindowSnapshot`, `WindowBounds`, `Session`, `SessionSummary`, `SessionIndex`, `SessionSettings` + `DEFAULT_SESSION_SETTINGS`, `ExportFormat`, `ExportBundle`. Chrome runtime ids (tab/window/group) are never persisted; groups are referenced by index. `SortSettings` is untouched.

### `src/options/Options.tsx` — Settings UI

React component using shadcn/ui (Radix UI + Tailwind). It exposes every field of `SortSettings`:

- **Sort Mode**: `url` / `title` / `custom`
- **Grouping direction** (`leftToRight` / `rightToLeft`) and **Preserve order within groups** — both
  apply to the `custom` mode only and are disabled, with an explanation, under the other two
- **Pinned Tabs**: sort pinned tabs, off by default
- **Suspended Tabs**: group suspended tabs together, plus the suspender extension id (32 letters
  `a`–`p`; empty resolves to the default before it reaches storage, because the sort engine has no
  empty-id fallback). A malformed id blocks Save.
- **Tab Grouping**: `subdomain` (full hostname) vs `domain` (base domain)
- **Duplicate Tabs**: `none` / `closeAllButOne` / `group`

The parsing, validation and disabled-control rules live in `src/options/lib/sort-settings.ts`
(`parseSortSettings`, `toStoredSortSettings`, `isExtensionId`, `disabledSortControls`, …) with tests;
`Options.tsx` stays a thin component. Adding a sort setting means adding it there, to the section
list above and to `SORT_SETTING_KEYS`, so the load path reads every key the Save path writes.

Settings are loaded from `chrome.storage.sync` on mount and saved explicitly via a "Save" button. The footer displays the extension version (from `chrome.runtime.getManifest()`) and a link to the GitHub repository. A "Sessions" card below the two radio-group sections renders `SessionSettingsFields` (shared with the dashboard's settings row): the automatic-snapshot switch, the interval (5 / 10 / 30 min), "Keep last N snapshots" (1–200, default 20) and the lazy-restore mode (`auto` / `always` / `never`). Every field writes through `useSessionSettings` → `sessionRepo.setSettings()` into `chrome.storage.local` immediately, rather than through the sort settings' "Save" button and two buttons: "Open Sessions dashboard" → `openDashboard()` (`src/sessions/open-dashboard.ts`) and "Set keyboard shortcuts" → `openShortcutSettings()` (`src/sessions/shortcuts.ts`).

### `vite.config.ts` — Build & Manifest

The Chrome extension manifest is **defined inline** in `vite.config.ts` using `@crxjs/vite-plugin`'s `defineManifest()`. There is no separate `manifest.json` file. When modifying extension metadata, permissions, or entry points, edit this file.

Permissions: `tabs`, `tabGroups`, `storage`, `contextMenus`, `unlimitedStorage`, `favicon`, `alarms`. `minimum_chrome_version: '123'` (promise-form `contextMenus.removeAll()` is awaited unguarded; `favicon` needs 104; `storage.local.getKeys()` (130) is behind a `typeof` guard so it does not raise the floor). Commands: `save-session`, `open-dashboard` — shipped without `suggested_key`; `_execute_action` is never defined. Second HTML entry `dashboard.html` is registered via `build.rollupOptions.input` because crxjs only auto-builds manifest-referenced pages. `defineConfig` comes from `vitest/config` so `test.setupFiles: ['src/test/setup.ts']` applies.

---

## Tech Stack

| Category         | Tool                                                                |
| ---------------- | ------------------------------------------------------------------- |
| Language         | TypeScript (strict mode, ESNext target)                             |
| UI Framework     | React 19                                                            |
| CSS              | Tailwind CSS 4                                                      |
| UI Components    | shadcn/ui (Radix UI + CVA)                                          |
| Build            | Vite 8 + @crxjs/vite-plugin                                         |
| Linter/Formatter | Biome (JS/TS/CSS) + Prettier (Markdown/YAML) + ruff (Python)        |
| Git Hooks        | Lefthook                                                            |
| Testing          | Vitest (unit) + `scripts/qa/smoke.ts` (real Chrome, via Playwright) |
| Release          | release-it (GitHub release + ZIP via `scripts/zip.ts`)              |
| CI               | GitHub Actions (tool versions from `mise.toml`) + Dependabot        |
| Tool Versions    | mise                                                                |

---

## Development Commands

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Vite build -> dist/ (no type check; run typecheck separately)
pnpm typecheck        # Type check only (tsc --noEmit)
pnpm format           # Biome check --write + Prettier (md/mdx/yml/yaml) + mise format (ruff)
pnpm test             # Run tests (vitest)
pnpm listing          # Regenerate docs/description.txt from docs/README.md (also runs on commit and in release)
pnpm release          # release-it: regenerate CWS assets, bump version, build, ZIP, GitHub release

pnpm exec tsx scripts/qa/smoke.ts   # Real-Chrome sessions smoke test (run `pnpm build` first)
pnpm exec tsx scripts/zip.ts        # Package the current dist/ into package/<name>-<version>.zip
```

### Local Development Workflow

1. `pnpm install`
2. `pnpm dev`
3. Open `chrome://extensions`, enable Developer mode
4. Click "Load unpacked" and select the `dist/` folder
5. The extension auto-reloads on code changes via CRX plugin HMR

---

## Code Style & Conventions

### Enforced by Biome (`biome.json`)

- **Indent**: 2 spaces
- **Line width**: 100 characters
- **Line endings**: LF
- **Quotes**: Single quotes for JS/TS, double quotes for JSX
- **Semicolons**: Always
- **Trailing commas**: Always
- **Block statements**: Required (`useBlockStatements: error`)
- **Import organization**: Automatic via Biome assist

### TypeScript

- Strict mode enabled
- Path alias: `@/*` maps to `./src/*`
- No `any` types — use proper type narrowing (see type guards in `Options.tsx`)
- Chrome API types from `@types/chrome`

### Git Conventions

- **Commit format**: Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`)
- **DO NOT** add `Co-Authored-By` lines to commit messages
- **Pre-commit hook**: `pnpm format` (Biome check + Prettier + mise format, staged files auto-fixed) and `pnpm listing` when `docs/README.md`, `package.json` or `scripts/build-listing.ts` is staged (regenerated `docs/description.txt` is auto-staged)
- **Pre-push hook** (parallel): `pnpm typecheck`, `pnpm test`, `pnpm build`, and an `update-docs` step that, when `src/**`, `scripts/**`, `package.json`, or `vite.config.ts` changed in the last commit, runs `claude -p` to refresh `AGENTS.md`/`README.md` and amends the commit

### Component Patterns

- UI components use shadcn/ui conventions: `cn()` for class merging, CVA for variants
- Components are in `src/components/ui/` and are generated via `shadcn` CLI
- Application components (like `Options.tsx`) are in feature directories

---

## Chrome Extension Specifics

### Manifest V3

The manifest is generated at build time from `vite.config.ts`. Key points:

- **Service Worker**: `src/background/index.ts` (module type)
- **Options Page**: `options.html` (not `options_ui` — uses full-page, not embedded)
- **No popup**: Extension icon click triggers sorting directly
- **No content scripts**: All operations use Chrome APIs only
- **Second page**: `dashboard.html` (Sessions dashboard). Opened only through `openDashboard()`, so there is only ever one dashboard tab.
- **Commands**: `save-session`, `open-dashboard`, unbound by default (users assign keys at `chrome://extensions/shortcuts`).
- **Minimum Chrome**: `minimum_chrome_version: '123'`. Raise it only for an API used without a runtime guard, and say why in the `vite.config.ts` comment.

### Permissions Explained

| Permission         | Why                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`             | Read tab URLs and titles for sorting and session capture; create/discard tabs on restore                                                        |
| `tabGroups`        | Create, move, and update tab groups; recreate groups on restore                                                                                 |
| `storage`          | `chrome.storage.sync` for `SortSettings`; `chrome.storage.local` for sessions, index, session settings                                          |
| `contextMenus`     | "Save this window / Save all windows / Open Sessions" on the action icon (`contexts: ['action']`)                                               |
| `unlimitedStorage` | Sessions with thousands of tabs exceed the 10 MB local quota; data stays on the device                                                          |
| `favicon`          | `chrome-extension://<id>/_favicon/?pageUrl=…` in the dashboard, from Chrome's local cache — zero network                                        |
| `alarms`           | Timer for automatic history snapshots (`history-snapshot` periodic + one-shot `history-first`); no alarm exists while `historyEnabled` is false |

No `host_permissions`, no `downloads` (export uses a Blob URL + `<a download>` in the page), no `default_popup`, no `side_panel`. Every permission change must be mirrored in the same PR in `docs/README.md` (Description permissions list + Privacy justifications table + the CWS privacy-form note), `PRIVACY_POLICY.md` (Permissions + Last Updated), `README.md` (Privacy bullet) and this table (spec §10).

### Storage Schema

**`chrome.storage.sync`** — `SortSettings` (defaults `DEFAULT_SETTINGS` in `src/background/index.ts`) plus `installedVersion`, `newInstall`, `newUpdate` written by the existing `onInstalled` handler. Sessions code **reads** exactly one key from it and never writes: `loadSuspendedPrefix()` in `src/sessions/capture.ts` reads `tabSuspenderExtensionId` (falling back to the Marvellous Suspender id) to build the `chrome-extension://<id>/suspended.html#` prefix. That one function is the only sync access in the sessions feature, and both capture and the dashboard's restore sanitiser (`src/dashboard/lib/sanitize-options.ts`) go through it. Nothing else in `src/sessions/**` or `src/dashboard/**` touches `chrome.storage.sync`. Session data and `sessionSettings` must never go to sync (100 KB total, 8 KB per item, write-rate limits).

**`chrome.storage.local`** — session data, one key per record, never one big array:

| Key               | Value                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `session:<uuid>`  | `Session` body (windows → groups/tabs)                                                                                                   |
| `sessionIndex`    | `SessionIndex` — `SessionSummary[]` newest-first by `updatedAt`, authoritative key list                                                  |
| `sessionSettings` | `SessionSettings` (device-local; defaults `DEFAULT_SESSION_SETTINGS` in `src/types.ts`)                                                  |
| `historyMeta`     | `{ lastHash, lastSnapshotAt }` — dedupe baseline for `takeHistorySnapshot()`; removed again when the snapshot it fingerprints is deleted |

Write order is body → index (put) and body → index (delete). `sessionRepo.reconcile()` (dashboard mount, `onInstalled`, `onStartup`) re-indexes orphan `session:*` bodies via `chrome.storage.local.getKeys()` (guarded fallback to `get(null)`) and drops index entries without a body. `sessionRepo.removeAll()` ("Delete all session data" in the dashboard's `StorageMeter`) removes every `session:*` body, `sessionIndex` and `historyMeta` under the lock; `sessionSettings` survives. `chrome.storage.local.getBytesInUse()` feeds the meter.

**`sessionStorage`** (dashboard tab only) — `src/dashboard/lib/ui-state.ts` keeps two per-tab UI flags there (`tab-organizer:history-open`, `tab-organizer:recovered-dismissed`). Not user data, never `chrome.storage`, never through `sessionRepo`; both accessors are guarded because `sessionStorage` is absent under vitest and throws when the browser blocks site data.

### Sessions rules (do not break)

- **Single write path.** Every write to session keys goes through `sessionRepo` in `src/sessions/storage.ts`, which serializes with `withLock()` (`navigator.locks.request('tab-organizer:sessions', …)`, shared by the service worker and both extension pages; promise-chain fallback when Web Locks are unavailable). Never call `chrome.storage.local.set/remove` for session keys anywhere else.
- **Never add tab listeners to the service worker.** No `chrome.tabs.on*`, `chrome.windows.on*`, `chrome.tabGroups.on*` in `src/background/**` — ever. History uses `chrome.alarms` only; the dashboard's live open-windows pane registers its listeners inside the page (`useOpenWindows`), where they die with the tab. Every worker listener is registered synchronously at module top level of `src/background/sessions.ts` — never inside an async callback or after an `await`.
- **`chrome.storage.sync` is read-only for sessions code** — one key, `tabSuspenderExtensionId`, through `loadSuspendedPrefix()` in `capture.ts`. Session data and session settings live in `chrome.storage.local` only.
- **The icon click stays `sortTabGroups()` only.** No `default_popup`, no dialogs, no `openDashboard()` on `action.onClicked`. `sort.ts` and the duplicate handlers are not edited by session work.
- **Restore runs in the dashboard page**, never in the worker. Own extension pages are excluded from every capture.
- **No Chrome runtime ids in stored data** — groups are referenced by `groupIndex`; pinned tabs never carry `groupIndex`; at most one `active` tab per window.
- **A chrome namespace touched at module-evaluation time needs its permission in the same commit.** Anything `src/background/sessions.ts` (or any module it imports) reads or calls while the module body runs — `chrome.alarms.onAlarm.addListener(…)`, `chrome.something.CONSTANT`, a top-level `chrome.x.y()` — runs before `index.ts`'s own body, because `import './sessions';` is hoisted. A missing permission makes that line throw, the whole service-worker module fails to evaluate, `chrome.action.onClicked` is never registered, and **tab sorting dies too** — a permission typo takes out the unrelated core feature, not just sessions. So add the permission to `vite.config.ts` in the very same commit as the code that touches the namespace (never "wire it up now, add the permission later"). `alarms` is the live example: `chrome.alarms.onAlarm.addListener` in `sessions.ts` and `'alarms'` in `permissions` landed together and must stay together.

---

## CI/CD

### GitHub Actions (`ci.yml`)

Runs on push to `main`, PRs to `main`, and manual dispatch:

1. Setup mise tools (`jdx/mise-action`; installs Node, pnpm, ruff, etc. from `mise.toml` — no Node version matrix)
2. Restore the pnpm store cache (keyed on `pnpm-lock.yaml`)
3. `pnpm install --frozen-lockfile`
4. `pnpm typecheck`
5. `pnpm test` (vitest)
6. `pnpm format` (Biome check + Prettier + ruff; fails on unfixable lint errors)
7. `pnpm listing` + `git diff --exit-code -- docs/description.txt` (fails if the generated store text is stale)
8. `pnpm build`

Dependabot (`dependabot.yml`) opens weekly PRs for npm and GitHub Actions updates, grouping minor/patch bumps.

### CodeQL (`codeql.yml`)

Scheduled security scanning for JavaScript/TypeScript (Fridays at 19:42 UTC).

### Release procedure (Chrome Web Store)

`pnpm release` runs release-it (`.release-it.json`): `before:bump` executes `scripts/prepare-registration.ts` (build, options + the five `screenshots/dashboard-*.png` captures, demo video/GIF, promo tiles, `docs/description.txt`), then the version is bumped, `after:bump` runs `pnpm build` + `scripts/zip.ts` (→ `package/<name>-<version>.zip`), and a GitHub release is created. It requires the `main` branch and hooks/CI green. Every optional step of `prepare-registration.ts` is skippable on its own (`SKIP_BUILD`, `SKIP_OPTIONS`, `SKIP_DASHBOARD`, `SKIP_DEMO`, `SKIP_VIDEO`, `SKIP_NATIVE`, `SKIP_MOCKUPS`, `SKIP_PROMO`, `SKIP_GIF`, `SKIP_LISTING`), so one asset can be regenerated without a full run; `pnpm exec tsx scripts/zip.ts` packages an existing `dist/` on its own.

1. Merge the feature branch into `main`; make sure `docs/README.md`, `PRIVACY_POLICY.md` (Last Updated), `README.md` and this file describe what ships, and that `package.json` `description` (the store Summary) is ≤ 132 characters.
2. `pnpm release --increment major` for a relaunch like v7.0.0 — or `pnpm release --no-increment` when `package.json` already carries the version to publish (release-it then only regenerates assets, builds, zips and tags).
3. In the CWS Developer Dashboard: upload `package/*.zip`, paste `docs/description.txt` into Description, upload the screenshots and promo tiles listed in `docs/README.md` (Graphic assets) in that order, copy the Privacy answers, and re-review the privacy form's data-type rows ("Web history": stored locally on the device, not transmitted).
4. Submit for review. Never run `pnpm release` from a feature branch or a worktree, and never edit `docs/description.txt` by hand.

---

## Testing

Unit tests use **Vitest** and live adjacent to their source files. Pure sorting logic in `src/background/sort.ts` is tested in `src/background/sort.test.ts`, covering:

- `compareByUrlComponents` — hostname normalization (`www.` stripping), pathname/search/hash ordering, special schemes (`chrome://`, `chrome-extension://`, `file://`, `about:blank`)
- `extractGroupingKey` — subdomain vs domain mode, two-part TLDs (`co.uk`, `ac.kr`, `com.au`)
- `isSuspended` / `tabToUrl` — suspended tab detection and URL extraction
- `findDuplicateTabs` — duplicate detection, `pendingUrl` fallback, special scheme handling
- `sortByTitleOrUrl` — title/URL sorting, pinned tab exclusion, edge cases (empty arrays, mixed schemes, large diverse tab sets)

`vite.config.ts` sets `test.setupFiles: ['src/test/setup.ts']`, which installs `createChromeFake()` from `src/test/chrome-fake.ts` on `globalThis.chrome` before every test (typed against `@types/chrome`, no `any`) and a `navigator.locks` shim. Tests reach the fake through `getChromeFake()`: `state`, `fire.installed/startup/menuClicked/command/alarm/actionClicked/tabReplaced`, `failNext(api, n, message)` (`tabs.create`, `tabs.group`, `tabs.discard`, `tabGroups.update`, `windows.create`, `storage.local.set`) and `commitNavigation(tabId)` (`state.deferCommit` models a navigation that has not committed). The `chrome.tabs`/`chrome.windows`/`chrome.tabGroups` `on*` events are emitted by the fake's own mutations — creating, moving, grouping or closing a tab fires them, which is what `useOpenWindows` is tested against — so only `actionClicked` (the second `action.onClicked` listener) and `tabReplaced` (no mutation produces it) need `fire.*` helpers of their own. Session tests live next to their modules: `src/sessions/*.test.ts` (naming, migrate, hash, capture invariants, storage order/reconcile/lock/prune/protect, planner chunking and step order, executeRestore against the fake, history dedupe/prune/recovery promotion/alarm re-arm, search tokenising and ranking, export serializers incl. CSV quoting and HTML escaping, import detection/parsers/JSON round-trip, guards on malformed input, suspender unwrap) and `src/background/sessions.test.ts` (menus recreated on install, badge, handlers, alarm / second-click / `storage.onChanged` wiring). Page-side logic is tested in `src/dashboard/hooks/*.test.ts` and `src/dashboard/lib/*.test.ts`; React components themselves are not unit-tested (vitest runs in Node without a DOM) — keep decisions in pure helpers with tests and leave components thin.

**Testing a module that registers `chrome.*` listeners at import time** (`src/background/index.ts`, `src/background/sessions.ts`): `src/test/setup.ts` assigns one throw-away fake to `globalThis.chrome` at module load (just so these modules are importable at all), then installs a **fresh** fake in `beforeEach`. A `import './sessions'` at the top of a test file runs once, before any `beforeEach`, and registers its listeners on the throw-away instance — every later `getChromeFake().fire.*` call reaches a different fake, so nothing fires. The fix is to defer the import into the test body, after `beforeEach` has installed that test's fake: `vi.resetModules(); await import('./sessions');`. `src/background/sessions.test.ts`'s `describe('listener wiring', …)` block does exactly this per test (`onInstalled`/`onStartup`/menu-click/command tests); the same file's other tests call the statically-imported `handleMenuOrCommand()`, `registerContextMenus()`, etc. directly, which is fine since those don't depend on which fake the listeners were registered against. (`src/sessions/storage.test.ts` also calls `vi.resetModules()` before re-importing `./storage`, but for an unrelated reason — getting a fresh copy of that module's own `fallbackChain` state to test the no-`navigator.locks` code path in isolation, not a listener-registration issue.)

### Real-Chrome smoke test (committed)

`scripts/qa/smoke.ts` is a committed end-to-end harness that loads the built extension into a real Chromium and drives the dashboard: build a fixture window (pinned tabs, a titled coloured group, a collapsed group) → save all windows → expand the card → restore → rename → delete, verifying each result through `chrome.tabs`/`chrome.tabGroups` inside the extension's own service worker rather than through the UI it just clicked. 11 steps, about 3 s.

```bash
pnpm build && pnpm exec tsx scripts/qa/smoke.ts
```

It runs under `tsx`, not vitest, so `pnpm test` does not include it — run it by hand after touching restore, capture or the worker's listeners. Steps run in order and a failure stops the run (the rest report `SKIP`); the process exits 1 if any step failed. Flags: `PW_CHROMIUM` (binary, default `/opt/pw-browsers/chromium`), `HEADLESS=0`, `SMOKE_TIMEOUT_MS`, `SMOKE_KEEP_OPEN=1`. `scripts/qa/browser.ts` (`launchExtension()`), `server.ts` (127.0.0.1 fixture pages — the QA browser has no outbound network) and `fixtures.ts` (sessions seeded straight into `chrome.storage.local`) are shared with `scripts/prepare-registration.ts`. Extend it by appending a `Step` to `STEPS`; history, search, export and import are not covered yet.

Playwright itself is a devDependency, used by this harness and by `scripts/prepare-registration.ts` for the release screenshots and demo video. The manual CDP passes described below are what produced the `waitForCommit` and window-state fixes in `src/sessions/restore.ts`.

### Real-Chrome QA (manual, beyond what the smoke test covers)

Vitest + the chrome fake cannot catch Chrome's own argument validation or its navigation timing, and the smoke test only covers the save/restore/rename/delete path. For anything else — history, search, export, import, window states — drive a real Chrome for Testing build once. What was learned doing it:

- **Do not let Playwright launch the browser when the run can reach `chrome.tabs.discard`.** Its default Chromium launch flags make Chrome for Testing 151 **SIGSEGV on `chrome.tabs.discard`** (i.e. exactly the lazy-restore path). For that path, launch Chrome for Testing yourself with `--load-extension=<dist>` plus `--remote-debugging-port=<port>` (and a scratch `--user-data-dir`), then attach with `chromium.connectOverCDP('http://127.0.0.1:<port>')`. `scripts/qa/browser.ts` does use `chromium.launchPersistentContext`, which is safe only because its fixture is far below `LAZY_AUTO_THRESHOLD` and so never discards a tab — keep it that way, or move that harness to CDP first.
- **Pick the right service worker.** Component extensions register service workers too, so `context.serviceWorkers()` has several entries. Select ours by its URL ending in `/service-worker-loader.js` — never by index — and `evaluate` the `chrome.*` calls inside it.
- **`--load-extension` is ignored by branded Chrome ≥ 137.** Use a Chrome for Testing binary (`npx @puppeteer/browsers install chrome@<version>`), not the installed Chrome.
- **Verified this way (do not "simplify" these back):** `chrome.windows.create` rejects `{ state: 'minimized', focused: true }`, `{ state: 'maximized' | 'fullscreen', focused: false }`, and any non-`'normal'` state combined with `left/top/width/height`, all with `Invalid value for state` — so restore always creates a `'normal'`, unfocused window and applies the real state afterwards with `windows.update`. And `chrome.tabs.discard` on a tab whose navigation has not committed silently unloads it with `url: ''`, losing the URL — hence `waitForCommit`. `src/test/chrome-fake.ts` models both behaviours so the unit tests hold the line.

---

## Common Tasks for Agents

### Adding a new setting

1. Add the type to `src/types.ts`
2. Add a default value to `DEFAULT_SETTINGS` in `src/background/index.ts`
3. Add UI controls in `src/options/Options.tsx` (with type guard function)
4. Use the setting in the relevant sort/handler function in `src/background/index.ts`

### Adding a new UI component

1. Run `pnpm dlx shadcn@latest add <component-name>` or create manually in `src/components/ui/`
2. Use the `cn()` utility from `src/lib/utils.ts` for class merging
3. Follow CVA pattern for variant-based components

### Modifying extension permissions

1. Edit the `permissions` array in the `defineManifest()` call in `vite.config.ts`
2. In the same PR update `docs/README.md` (Description permissions bullets + Privacy justifications table), `PRIVACY_POLICY.md` (Permissions + Last Updated), `README.md` (the Privacy bullet's permission count and list) and the Permissions Explained table above; `docs/description.txt` is regenerated by the pre-commit hook

### Adding a sessions feature

1. Put pure logic in `src/sessions/<module>.ts` with an adjacent `*.test.ts` (use `getChromeFake()` only for the thin chrome wrapper)
2. Persist through `sessionRepo` only — extend `src/sessions/storage.ts` if a new operation is needed, inside `withLock()`
3. UI goes in `src/dashboard/` (hooks under `hooks/`, components under `components/`, pure page helpers under `lib/` with tests); the service worker only gets new _event_ listeners (`onInstalled`, `onStartup`, menus, commands, alarms, `storage.onChanged`) in `src/background/sessions.ts`, registered at module top level
4. Icon-only buttons need `aria-label`; dialogs use the shadcn `Dialog`, menus the shadcn `DropdownMenu`; comment non-obvious Chrome behaviour at the call site

### Changing a session setting

1. Extend `SessionSettings` / `DEFAULT_SESSION_SETTINGS` in `src/types.ts` and `normalizeSettings()` in `src/sessions/storage.ts` (unknown or invalid stored values must fall back to the default)
2. Read/write through `sessionRepo.getSettings()` / `setSettings(patch)` — `useSessionSettings` in the dashboard and the Options "Sessions" card; never `chrome.storage.local` directly
3. Add the control once, in `src/dashboard/components/SessionSettingsFields.tsx` (parsing/clamping in `src/dashboard/lib/session-settings.ts`): both the dashboard's `SessionSettingsRow` and the Options "Sessions" card render that one component, so a field added there appears on both surfaces
4. If the setting affects the alarm, `ensureHistoryAlarm()` already re-runs on every `sessionSettings` change via the worker's `storage.onChanged` listener — do not add another listener
5. Document the new setting in `docs/README.md` (Settings + FAQ) and, if it changes what is stored or for how long, in `PRIVACY_POLICY.md`

### Adding a new sort mode

1. Add the mode to `SortBy` type in `src/types.ts`
2. Add a `case` in the `switch` statement inside `sortTabs()` in `src/background/index.ts`
3. Implement the sort function following existing patterns (`sortByTitleOrUrl`, `sortByCustom`)

---

## Gotchas & Edge Cases

- **No `manifest.json` file**: The manifest is defined inline in `vite.config.ts`. Don't look for a separate manifest file.
- **Suspended tabs**: The extension integrates with "The Marvellous Suspender". Suspended tab URLs are wrapped in `chrome-extension://<id>/suspended.html#ttl=…&pos=…&uri=<real-url>` with the real URL appended raw (not percent-encoded). Sorting unwraps with `tabToUrl()` in `sort.ts`; capture and the restore sanitiser use `unwrapSuspendedUrl()` in `src/sessions/suspender.ts`, which returns the verbatim remainder after `uri=` — parsing it with `URLSearchParams` would cut the URL at its first `&`. A wrapper that cannot be unwrapped keeps the raw wrapper URL at capture time and is skipped by `sanitizeRestoreUrl` (foreign `chrome-extension://`) at restore time.
- **Tab group IDs**: `-1` means ungrouped in the Chrome API. The code uses this convention throughout.
- **Module-scoped state**: `tabSuspenderExtensionId`, `suspendedPrefix`, and `suspendedPrefixLen` are module-level variables in `index.ts`, updated in `sortTabs()`. Sort functions in `sort.ts` receive these as parameters rather than accessing globals, keeping them pure and testable.
- **Tab ID arrays**: Chrome's `tabs.move()` and `tabs.group()` require `[number, ...number[]]` tuple type for non-empty arrays.
- **`scripts/zip.ts` and archiver 8**: archiver 8 is ESM and exports no callable default — the archive classes come by name (`import { ZipArchive } from 'archiver'`). `finalize()` resolves before the file is complete, so the script also waits for the write stream's `close` event; don't "simplify" either back.
- **`pnpm-workspace.yaml`**: Exists but this is not a monorepo — it only configures `allowBuilds` for esbuild and msw, and `minimumReleaseAgeExclude` for select packages.
- **`docs/description.txt` is generated**: edit `docs/README.md`; the pre-commit `listing` hook regenerates and stages the text file, CI diffs it.
- **Pre-push `update-docs` hook amends commits**: on feature branches push with `LEFTHOOK_EXCLUDE=update-docs git push …` and do one manual docs pass per phase.
- **`chrome.tabs.Tab.id` and `chrome.windows.Window.id/state/type/left/top/width/height` are optional** in `@types/chrome` 0.2.x — always narrow before use; never `!`. `Tab.windowId`/`groupId` are required (`-1` = no group).
- **`chrome.storage.local.getKeys()`** needs Chrome 130+; only `reconcile()` uses it, behind a `typeof … === 'function'` guard.
- **Dashboard singleton**: the sorter still moves/dedupes the dashboard tab like any tab; `openDashboard()` focusing an existing tab is what keeps "close duplicates" harmless.
- **Alarms do not survive an extension update or reload**: `ensureHistoryAlarm()` re-asserts the periodic alarm from `onInstalled` and `onStartup` (`alarms.create` with an existing name replaces it, no churn). If `historyEnabled` is true and `chrome.alarms.getAll()` in the worker console shows nothing, history has silently stopped — that is the first thing to check.
- **The first post-launch snapshot is delayed on purpose**: `onStartup` arms the one-shot `history-first` alarm 1 minute out because Chrome is still restoring tabs while `onStartup` runs; a capture then would record half-loaded windows.
- **`promoteRecoveredSnapshot()` is idempotent**: only snapshots captured _after_ the newest existing recovered one qualify, so a restart with no new snapshot in between never turns another ring entry into a protected one.
- **History dedupe hashes URLs, not titles**: `contentHash()` covers url/pinned/groupIndex/group title, so a page changing its `<title>` never produces a new snapshot; deleting the snapshot that `historyMeta.lastHash` points at also drops `historyMeta`, otherwise the next capture of that layout would be skipped forever.
- **Import never trusts input**: everything pasted or uploaded goes through `src/sessions/guards.ts`; imported sessions get fresh ids, `kind: 'saved'`, `origin: 'import'` and never keep `protected`. Netscape HTML is parsed with the module's own tokenizer — `DOMParser` is unavailable under vitest (Node, no DOM).
- **Open-windows pane listeners live in the page**: `useOpenWindows` registers `chrome.tabs/windows/tabGroups.on*` in `dashboard.html` and coalesces refetches; `windowId`/`tabId` in `SearchEntry` for open tabs are in-memory only and are never written to storage.
