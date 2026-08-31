# AGENTS.md

## Project Overview

**Tab Organizer** is a Chrome extension (Manifest V3) that sorts and organizes browser tabs and saves/restores sets of windows and tabs as sessions. It groups tabs by hostname/domain, handles duplicate tabs, supports suspended tab detection, and keeps a local-only session store (saved sessions plus, from Phase 3, automatic history snapshots). All operations are entirely local with zero external data transmission.

- Repository: `https://github.com/thilllon/tab-organizer`
- Chrome Web Store: `https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg`
- License: Private

---

## Architecture

### Runtime Model

This is a **Chrome Extension** with three execution contexts:

1. **Background Service Worker** (`src/background/index.ts` + `src/background/sessions.ts`) — The core engine. Runs as a Manifest V3 service worker. `index.ts` handles tab sorting, grouping and duplicate detection, triggered by the icon click (`chrome.action.onClicked`). `sessions.ts` (imported by `index.ts` with a single `import './sessions';` line) registers, synchronously at module top level, the sessions listeners: `runtime.onInstalled` (recreate context menus; `sessionRepo.migrateAll()` when `details.reason === 'update'`, then `sessionRepo.reconcile()`), `runtime.onStartup` (clear badge, reconcile), `contextMenus.onClicked` and `commands.onCommand` (save window / save all / open dashboard). The worker wakes only on those events (and, from Phase 3, on the history alarm); there are **no** `chrome.tabs.on*` / `chrome.windows.on*` / `chrome.tabGroups.on*` listeners in the worker.
2. **Options Page** (`src/options/`) — A React SPA rendered in `options.html`. Configures sort settings (`chrome.storage.sync`) and has a "Sessions" card that opens the dashboard and the Chrome shortcuts page.
3. **Sessions Dashboard** (`src/dashboard/`) — A React SPA rendered in `dashboard.html` (second Vite/crxjs HTML entry, `build.rollupOptions.input`). Lists saved sessions from the index, loads bodies on demand, renames/deletes, and **runs restores in the page** (never in the service worker, so the worker's idle/lifetime limits do not apply). It talks to `chrome.*` directly — there is no message passing to the worker. `openDashboard()` (`src/sessions/open-dashboard.ts`) is a singleton: it focuses an existing dashboard tab or creates one.

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
-> captureSession('window' | 'all') (src/sessions/capture.ts)
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

Settings are persisted in `chrome.storage.sync` and loaded fresh on every sort invocation. Session data lives in `chrome.storage.local` and is read through `sessionRepo` only. The dashboard reloads its list when `chrome.storage.onChanged` reports a change to `sessionIndex`.

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
│   │   ├── capture.ts (+test)     # captureWindows() (pure) + captureSession() (chrome wrapper)
│   │   ├── storage.ts (+test)     # sessionRepo, withLock(), storage keys — the ONLY writer of session data
│   │   ├── restore.ts (+test)     # sanitizeRestoreUrl(), clampToScreen(), planRestore() (pure), executeRestore()
│   │   ├── open-dashboard.ts      # openDashboard() singleton
│   │   └── shortcuts.ts           # openShortcutSettings() — shared by Options and the dashboard empty state
│   ├── dashboard/
│   │   ├── index.tsx          # React entry point for dashboard.html
│   │   ├── index.css          # @import '../options/index.css'
│   │   ├── Dashboard.tsx      # Header (save buttons) + session list + empty state
│   │   ├── hooks/             # useSessionIndex, useSessionBody, useRestore
│   │   ├── lib/               # Page-side helpers (+ adjacent tests): errors, format, group-colors,
│   │   │                      #   open-tab, restore-summary, sanitize-options, segments, session-utils
│   │   └── components/        # SessionCard, WindowTree, GroupSection, TabRow, Favicon, ProgressToast,
│   │                          #   EmptyState, RestoreConfirmDialog, DeleteSessionDialog
│   ├── options/
│   │   ├── index.tsx          # React entry point
│   │   ├── Options.tsx        # Settings UI component + "Sessions" card
│   │   └── index.css          # Tailwind CSS with shadcn theme
│   ├── components/ui/         # Reusable UI components (shadcn/ui: button, radio-group, label, input,
│   │                          #   dialog, dropdown-menu, badge, separator, collapsible)
│   ├── lib/
│   │   └── utils.ts           # cn() utility (clsx + tailwind-merge)
│   ├── test/
│   │   ├── chrome-fake.ts     # Typed in-memory chrome.* fake (storage, tabs, windows, tabGroups, menus, alarms)
│   │   └── setup.ts           # vitest setupFiles: installs the fake on globalThis.chrome + navigator.locks shim
│   ├── types.ts               # Shared TypeScript types (SortSettings + Session* types)
│   └── global.d.ts            # Vite client type declarations
├── public/
│   └── img/                   # Extension logos (SVG, ICO, 16/32/48/128px PNG)
├── scripts/
│   ├── zip.ts                 # Packages dist/ into package/<name>-<version>.zip for Web Store
│   ├── generate-ico.ts        # Generates multi-size .ico from SVG (macOS: qlmanage + sips)
│   ├── prepare-registration.ts # Full visual-asset pipeline (build, screenshots, video, promo images, demo.gif, description.txt)
│   ├── build-listing.ts       # docs/README.md `### Description` -> docs/description.txt (CWS plain text); + build-listing.test.ts
│   ├── promo-template.html    # HTML template for CWS promotional images
│   ├── tab-bar-template.html  # HTML template for tab bar mockup screenshots
│   └── get-window-id.py       # macOS window-bounds helper for screenshot cropping
├── screenshots/               # Generated CWS assets (screenshots, promo images, demo video)
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

Registers listeners synchronously at module top level; imported by `index.ts`. Exports for tests: `MENU_IDS = { saveWindow: 'save-window', saveAll: 'save-all', openDashboard: 'open-dashboard' }`, `COMMAND_IDS = { saveSession: 'save-session', openDashboard: 'open-dashboard' }` (must equal the `commands` block in `vite.config.ts`), `registerContextMenus()`, `handleMenuOrCommand(id)`, `showSavedBadge()`, `clearBadge()`.

| Listener                                        | Behaviour                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.onInstalled`                           | `contextMenus.removeAll()` then create the 3 menu items (idempotent); on `details.reason === 'update'` runs `sessionRepo.migrateAll()` first (errors caught locally); then `sessionRepo.reconcile()`. |
| `runtime.onStartup`                             | `clearBadge()`; `sessionRepo.reconcile()`.                                                                                                                                                            |
| `contextMenus.onClicked` / `commands.onCommand` | `clearBadge()`; `save-window`/`save-session` → capture current window; `save-all` → all windows; `open-dashboard`.                                                                                    |

### `src/sessions/` — Session domain

| Module              | Exports                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming.ts`         | `defaultSessionName(date, windowCount, tabCount)`, `slugify(name)`                                                                                                                                                                           |
| `migrate.ts`        | `migrateSession(record)`, `migrateIndex(record)`, `UnknownSchemaVersionError` (identity for v1; unknown versions throw and the UI shows the record read-only)                                                                                |
| `hash.ts`           | `contentHash(windows)` — titles excluded, so a title change never produces a new snapshot                                                                                                                                                    |
| `capture.ts`        | `captureWindows(windows, groups, options)` (pure), `captureSession(scope, name?)`                                                                                                                                                            |
| `storage.ts`        | `sessionRepo` (`listSummaries`, `get`, `put`, `rename`, `remove`, `removeAll`, `reconcile`, `migrateAll`, `getSettings`, `setSettings`), `withLock`, `toSummary`, `INDEX_KEY`, `SETTINGS_KEY`, `HISTORY_META_KEY`, `sessionKey`, `LOCK_NAME` |
| `restore.ts`        | `sanitizeRestoreUrl`, `clampToScreen`, `planRestore` (pure), `executeRestore`, `withRetryOnce`, `isTabsCannotBeEditedError`                                                                                                                  |
| `open-dashboard.ts` | `openDashboard()` — focuses the existing dashboard tab or opens one                                                                                                                                                                          |
| `shortcuts.ts`      | `openShortcutSettings()` — `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })`, used by Options and the dashboard empty state                                                                                                     |

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

React component using shadcn/ui (Radix UI + Tailwind). Provides radio groups for:

- **Tab Grouping**: `subdomain` (full hostname) vs `domain` (base domain)
- **Duplicate Tabs**: `none` / `closeAllButOne` / `group`

Settings are loaded from `chrome.storage.sync` on mount and saved explicitly via a "Save" button. The footer displays the extension version (from `chrome.runtime.getManifest()`) and a link to the GitHub repository. A "Sessions" card below the two radio-group sections has two buttons: "Open Sessions dashboard" → `openDashboard()` (`src/sessions/open-dashboard.ts`) and "Set keyboard shortcuts" → `openShortcutSettings()` (`src/sessions/shortcuts.ts`).

### `vite.config.ts` — Build & Manifest

The Chrome extension manifest is **defined inline** in `vite.config.ts` using `@crxjs/vite-plugin`'s `defineManifest()`. There is no separate `manifest.json` file. When modifying extension metadata, permissions, or entry points, edit this file.

Permissions: `tabs`, `tabGroups`, `storage`, `contextMenus`, `unlimitedStorage`, `favicon` (Phase 3 adds `alarms`). Commands: `save-session`, `open-dashboard` — shipped without `suggested_key`; `_execute_action` is never defined. Second HTML entry `dashboard.html` is registered via `build.rollupOptions.input` because crxjs only auto-builds manifest-referenced pages. `defineConfig` comes from `vitest/config` so `test.setupFiles: ['src/test/setup.ts']` applies.

---

## Tech Stack

| Category         | Tool                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Language         | TypeScript (strict mode, ESNext target)                               |
| UI Framework     | React 19                                                              |
| CSS              | Tailwind CSS 4                                                        |
| UI Components    | shadcn/ui (Radix UI + CVA)                                            |
| Build            | Vite 8 + @crxjs/vite-plugin                                           |
| Linter/Formatter | Biome (JS/TS/CSS) + Prettier (Markdown/YAML) + ruff (Python)          |
| Git Hooks        | Lefthook                                                              |
| Testing          | Vitest; Playwright drives release screenshots + manual real-Chrome QA |
| Release          | release-it (GitHub release + ZIP via `scripts/zip.ts`)                |
| CI               | GitHub Actions (tool versions from `mise.toml`) + Dependabot          |
| Tool Versions    | mise                                                                  |

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
- **Second page**: `dashboard.html` (Sessions dashboard). Opened only through `openDashboard()` so there is ever one dashboard tab.
- **Commands**: `save-session`, `open-dashboard`, unbound by default (users assign keys at `chrome://extensions/shortcuts`).

### Permissions Explained

| Permission         | Why                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `tabs`             | Read tab URLs and titles for sorting and session capture; create/discard tabs on restore                 |
| `tabGroups`        | Create, move, and update tab groups; recreate groups on restore                                          |
| `storage`          | `chrome.storage.sync` for `SortSettings`; `chrome.storage.local` for sessions, index, session settings   |
| `contextMenus`     | "Save this window / Save all windows / Open Sessions" on the action icon (`contexts: ['action']`)        |
| `unlimitedStorage` | Sessions with thousands of tabs exceed the 10 MB local quota; data stays on the device                   |
| `favicon`          | `chrome-extension://<id>/_favicon/?pageUrl=…` in the dashboard, from Chrome's local cache — zero network |
| `alarms` (Phase 3) | Timer for automatic history snapshots; no alarm exists while `historyEnabled` is false                   |

Every permission change must be mirrored in the same PR in `docs/README.md` (Description permissions list + Privacy justifications table), `PRIVACY_POLICY.md` (Permissions + Last Updated) and this table (spec §10).

### Storage Schema

**`chrome.storage.sync`** — `SortSettings` (defaults `DEFAULT_SETTINGS` in `src/background/index.ts`) plus `installedVersion`, `newInstall`, `newUpdate` written by the existing `onInstalled` handler. Untouched by the sessions feature.

**`chrome.storage.local`** — session data, one key per record, never one big array:

| Key               | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| `session:<uuid>`  | `Session` body (windows → groups/tabs)                                                  |
| `sessionIndex`    | `SessionIndex` — `SessionSummary[]` newest-first by `updatedAt`, authoritative key list |
| `sessionSettings` | `SessionSettings` (device-local; defaults `DEFAULT_SESSION_SETTINGS` in `src/types.ts`) |
| `historyMeta`     | `{ lastHash, lastSnapshotAt }` (Phase 3)                                                |

Write order is body → index (put) and body → index (delete). `sessionRepo.reconcile()` (dashboard mount, `onInstalled`, `onStartup`) re-indexes orphan `session:*` bodies via `chrome.storage.local.getKeys()` (guarded fallback to `get(null)`) and drops index entries without a body.

### Sessions rules (do not break)

- **Single write path.** Every write to session keys goes through `sessionRepo` in `src/sessions/storage.ts`, which serializes with `withLock()` (`navigator.locks.request('tab-organizer:sessions', …)`, shared by the service worker and both extension pages; promise-chain fallback when Web Locks are unavailable). Never call `chrome.storage.local.set/remove` for session keys anywhere else.
- **Never add tab listeners to the service worker.** No `chrome.tabs.on*`, `chrome.windows.on*`, `chrome.tabGroups.on*` in `src/background/**` — ever. History (Phase 3) uses `chrome.alarms` only; live open-window views (Phase 2) register their listeners inside the dashboard page.
- **The icon click stays `sortTabGroups()` only.** No `default_popup`, no dialogs, no `openDashboard()` on `action.onClicked`. `sort.ts` and the duplicate handlers are not edited by session work.
- **Restore runs in the dashboard page**, never in the worker. Own extension pages are excluded from every capture.
- **No Chrome runtime ids in stored data** — groups are referenced by `groupIndex`; pinned tabs never carry `groupIndex`; at most one `active` tab per window.
- **A chrome namespace touched at module-evaluation time needs its permission in the same commit.** Anything `src/background/sessions.ts` (or any module it imports) reads or calls while the module body runs — `chrome.alarms.onAlarm.addListener(…)`, `chrome.something.CONSTANT`, a top-level `chrome.x.y()` — runs before `index.ts`'s own body, because `import './sessions';` is hoisted. A missing permission makes that line throw, the whole service-worker module fails to evaluate, `chrome.action.onClicked` is never registered, and **tab sorting dies too** — a permission typo takes out the unrelated core feature, not just sessions. So add the permission to `vite.config.ts` in the very same commit as the code that touches the namespace (never "wire it up now, add the permission later"). Phase 3's `alarms` is the next case: `chrome.alarms.onAlarm.addListener` and `'alarms'` in `permissions` must land together.

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

---

## Testing

Unit tests use **Vitest** and live adjacent to their source files. Pure sorting logic in `src/background/sort.ts` is tested in `src/background/sort.test.ts`, covering:

- `compareByUrlComponents` — hostname normalization (`www.` stripping), pathname/search/hash ordering, special schemes (`chrome://`, `chrome-extension://`, `file://`, `about:blank`)
- `extractGroupingKey` — subdomain vs domain mode, two-part TLDs (`co.uk`, `ac.kr`, `com.au`)
- `isSuspended` / `tabToUrl` — suspended tab detection and URL extraction
- `findDuplicateTabs` — duplicate detection, `pendingUrl` fallback, special scheme handling
- `sortByTitleOrUrl` — title/URL sorting, pinned tab exclusion, edge cases (empty arrays, mixed schemes, large diverse tab sets)

`vite.config.ts` sets `test.setupFiles: ['src/test/setup.ts']`, which installs `createChromeFake()` from `src/test/chrome-fake.ts` on `globalThis.chrome` before every test (typed against `@types/chrome`, no `any`) and a `navigator.locks` shim. Tests reach the fake through `getChromeFake()` (`state`, `fire.installed/startup/menuClicked/command/alarm`, `failNext('tabs.create', n, message)`). Session tests live next to their modules: `src/sessions/*.test.ts` (naming, migrate, hash, capture invariants, storage order/reconcile/lock, planner chunking and step order, executeRestore against the fake) and `src/background/sessions.test.ts` (menus recreated on install, badge, handlers).

**Testing a module that registers `chrome.*` listeners at import time** (`src/background/index.ts`, `src/background/sessions.ts`): `src/test/setup.ts` assigns one throw-away fake to `globalThis.chrome` at module load (just so these modules are importable at all), then installs a **fresh** fake in `beforeEach`. A `import './sessions'` at the top of a test file runs once, before any `beforeEach`, and registers its listeners on the throw-away instance — every later `getChromeFake().fire.*` call reaches a different fake, so nothing fires. The fix is to defer the import into the test body, after `beforeEach` has installed that test's fake: `vi.resetModules(); await import('./sessions');`. `src/background/sessions.test.ts`'s `describe('listener wiring', …)` block does exactly this per test (`onInstalled`/`onStartup`/menu-click/command tests); the same file's other tests call the statically-imported `handleMenuOrCommand()`, `registerContextMenus()`, etc. directly, which is fine since those don't depend on which fake the listeners were registered against. (`src/sessions/storage.test.ts` also calls `vi.resetModules()` before re-importing `./storage`, but for an unrelated reason — getting a fresh copy of that module's own `fallbackChain` state to test the no-`navigator.locks` code path in isolation, not a listener-registration issue.)

Playwright is also installed. `scripts/prepare-registration.ts` uses it to drive Chromium for release screenshots and the demo video; there is no committed Playwright end-to-end suite, but Playwright's CDP client is the tool used for the manual real-Chrome QA passes described below (findings from those passes are what produced the `waitForCommit` and window-state fixes in `src/sessions/restore.ts`).

### Real-Chrome QA (manual, when a change touches restore or the service worker)

Vitest + the chrome fake cannot catch Chrome's own argument validation or its navigation timing. When restore, capture or the worker's listeners change, drive a real Chrome for Testing build once. What was learned doing it:

- **Do not let Playwright launch the browser.** Its default Chromium launch flags make Chrome for Testing 151 **SIGSEGV on `chrome.tabs.discard`** (i.e. exactly the lazy-restore path). Launch Chrome for Testing yourself with `--load-extension=<dist>` plus `--remote-debugging-port=<port>` (and a scratch `--user-data-dir`), then attach with `chromium.connectOverCDP('http://127.0.0.1:<port>')`.
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
2. In the same PR update `docs/README.md` (Description permissions bullets + Privacy justifications table), `PRIVACY_POLICY.md` (Permissions + Last Updated) and the Permissions Explained table above; `docs/description.txt` is regenerated by the pre-commit hook

### Adding a sessions feature

1. Put pure logic in `src/sessions/<module>.ts` with an adjacent `*.test.ts` (use `getChromeFake()` only for the thin chrome wrapper)
2. Persist through `sessionRepo` only — extend `src/sessions/storage.ts` if a new operation is needed, inside `withLock()`
3. UI goes in `src/dashboard/` (hooks under `hooks/`, components under `components/`); the service worker only gets new _event_ listeners (`onInstalled`, `onStartup`, menus, commands, alarms) in `src/background/sessions.ts`

### Adding a new sort mode

1. Add the mode to `SortBy` type in `src/types.ts`
2. Add a `case` in the `switch` statement inside `sortTabs()` in `src/background/index.ts`
3. Implement the sort function following existing patterns (`sortByTitleOrUrl`, `sortByCustom`)

---

## Gotchas & Edge Cases

- **No `manifest.json` file**: The manifest is defined inline in `vite.config.ts`. Don't look for a separate manifest file.
- **Suspended tabs**: The extension integrates with "The Marvellous Suspender". Suspended tab URLs are wrapped in `chrome-extension://<id>/suspended.html#uri=<real-url>`. The `tabToUrl()` function unwraps them.
- **Tab group IDs**: `-1` means ungrouped in the Chrome API. The code uses this convention throughout.
- **Module-scoped state**: `tabSuspenderExtensionId`, `suspendedPrefix`, and `suspendedPrefixLen` are module-level variables in `index.ts`, updated in `sortTabs()`. Sort functions in `sort.ts` receive these as parameters rather than accessing globals, keeping them pure and testable.
- **Tab ID arrays**: Chrome's `tabs.move()` and `tabs.group()` require `[number, ...number[]]` tuple type for non-empty arrays.
- **`pnpm-workspace.yaml`**: Exists but this is not a monorepo — it only configures `allowBuilds` for esbuild and msw, and `minimumReleaseAgeExclude` for select packages.
- **`docs/description.txt` is generated**: edit `docs/README.md`; the pre-commit `listing` hook regenerates and stages the text file, CI diffs it.
- **Pre-push `update-docs` hook amends commits**: on feature branches push with `LEFTHOOK_EXCLUDE=update-docs git push …` and do one manual docs pass per phase.
- **`chrome.tabs.Tab.id` and `chrome.windows.Window.id/state/type/left/top/width/height` are optional** in `@types/chrome` 0.2.x — always narrow before use; never `!`. `Tab.windowId`/`groupId` are required (`-1` = no group).
- **`chrome.storage.local.getKeys()`** needs Chrome 130+; only `reconcile()` uses it, behind a `typeof … === 'function'` guard.
- **Dashboard singleton**: the sorter still moves/dedupes the dashboard tab like any tab; `openDashboard()` focusing an existing tab is what keeps "close duplicates" harmless.
