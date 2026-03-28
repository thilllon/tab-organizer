# AGENTS.md

## Project Overview

**Tab Organizer** is a Chrome extension (Manifest V3) that sorts and organizes browser tabs. It groups tabs by hostname/domain, handles duplicate tabs, and supports suspended tab detection. All operations are entirely local with zero external data transmission.

- Repository: `https://github.com/thilllon/tab-organizer`
- Chrome Web Store: `https://chromewebstore.google.com/detail/tab-organizer/bmbpmnfhfbdjdjpblimidmbohgccmjdg`
- License: Private

---

## Architecture

### Runtime Model

This is a **Chrome Extension** with two execution contexts:

1. **Background Service Worker** (`src/background/index.ts`) — The core engine. Runs as a Manifest V3 service worker. Handles tab sorting, grouping, duplicate detection, and all Chrome API interactions. Triggered by clicking the extension icon (`chrome.action.onClicked`).
2. **Options Page** (`src/options/`) — A React SPA rendered in `options.html`. Provides UI for configuring settings (grouping mode, duplicate handling). Reads/writes settings via `chrome.storage.sync`.

There is **no popup**, **no content script**, and **no external server**. The extension icon click directly triggers sorting.

### Data Flow

```
User clicks extension icon
  -> chrome.action.onClicked listener
  -> sortTabGroups()
    -> Load settings from chrome.storage.sync
    -> Query pinned tabs, tab groups, ungrouped tabs
    -> Sort each set independently
    -> Move tabs via chrome.tabs.move()
    -> Handle duplicates (close or group)
```

Settings are persisted in `chrome.storage.sync` and loaded fresh on every sort invocation.

### Directory Structure

```
tab-organizer/
├── src/
│   ├── background/
│   │   └── index.ts          # Service worker (core sorting logic, ~450 lines)
│   ├── options/
│   │   ├── index.tsx          # React entry point
│   │   ├── Options.tsx        # Settings UI component
│   │   └── index.css          # Tailwind CSS with shadcn theme
│   ├── components/ui/         # Reusable UI components (shadcn/ui)
│   │   ├── button.tsx
│   │   ├── radio-group.tsx
│   │   └── label.tsx
│   ├── lib/
│   │   └── utils.ts           # cn() utility (clsx + tailwind-merge)
│   ├── types.ts               # Shared TypeScript types
│   └── global.d.ts            # Vite client type declarations
├── public/
│   ├── img/                   # Extension logos (16/32/48/128px)
│   └── icons/                 # Additional icon assets
├── scripts/
│   ├── zip.ts                 # Packages extension into ZIP for Web Store
│   ├── prepare-registration.ts # Full visual-asset pipeline (build, screenshots, video, promo images)
│   ├── promo-template.html    # HTML template for CWS promotional images
│   ├── tab-bar-template.html  # HTML template for tab bar mockup screenshots
│   └── get-window-id.py       # macOS window-bounds helper for screenshot cropping
├── .github/workflows/
│   ├── ci.yml                 # CI pipeline (Node 20/22/24 matrix)
│   └── codeql.yml             # CodeQL security scanning
├── options.html               # Options page HTML entry
├── vite.config.ts             # Vite + CRX plugin config (manifest defined here)
├── tsconfig.json              # TypeScript config (strict mode)
├── biome.json                 # Biome linter/formatter config
├── lefthook.yml               # Git hooks (pre-commit: biome check)
├── mise.toml                  # Tool version manager (Node, pnpm, Python)
├── components.json            # shadcn/ui configuration
└── package.json
```

---

## Key Source Files

### `src/background/index.ts` — Core Engine

This is the most important file. It contains all tab sorting logic:

| Function                   | Purpose                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `sortTabGroups()`          | Main orchestrator. Loads settings, queries tabs, delegates to sort functions, handles duplicates.      |
| `sortTabs()`               | Sorts a set of tabs and moves them via Chrome API. Dispatches to `sortByTitleOrUrl` or `sortByCustom`. |
| `sortByTitleOrUrl()`       | Sorts tabs alphabetically by title or URL. Handles suspended tab grouping and pinned tab exclusion.    |
| `sortByCustom()`           | Groups tabs by hostname/domain, preserving first-seen order. Supports LTR/RTL grouping direction.      |
| `handleDuplicateTabs()`    | Finds duplicate URLs and either closes extras or groups them.                                          |
| `findDuplicateTabs()`      | Returns a `Map<url, Tab[]>` of URLs with more than one tab.                                            |
| `closeDuplicateTabs()`     | Keeps active/first tab, closes the rest.                                                               |
| `groupDuplicateTabs()`     | Groups duplicate tabs into a Chrome tab group.                                                         |
| `extractGroupingKey()`     | Parses hostname into grouping key. In `domain` mode, handles two-part TLDs (e.g., `co.uk`).            |
| `isSuspended()`            | Checks if a tab is suspended by The Marvellous Suspender.                                              |
| `tabToUrl()`               | Extracts real URL from suspended tabs by parsing the `uri` query parameter.                            |
| `compareByUrlComponents()` | Compares URLs by hostname (without `www.`) + path + search + hash.                                     |

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

### `src/options/Options.tsx` — Settings UI

React component using shadcn/ui (Radix UI + Tailwind). Provides radio groups for:

- **Tab Grouping**: `subdomain` (full hostname) vs `domain` (base domain)
- **Duplicate Tabs**: `none` / `closeAllButOne` / `group`

Settings are loaded from `chrome.storage.sync` on mount and saved explicitly via a "Save" button.

### `vite.config.ts` — Build & Manifest

The Chrome extension manifest is **defined inline** in `vite.config.ts` using `@crxjs/vite-plugin`'s `defineManifest()`. There is no separate `manifest.json` file. When modifying extension metadata, permissions, or entry points, edit this file.

Permissions: `tabs`, `tabGroups`, `storage`

---

## Tech Stack

| Category         | Tool                                    |
| ---------------- | --------------------------------------- |
| Language         | TypeScript (strict mode, ESNext target) |
| UI Framework     | React 19                                |
| CSS              | Tailwind CSS 4                          |
| UI Components    | shadcn/ui (Radix UI + CVA)              |
| Build            | Vite 7 + @crxjs/vite-plugin             |
| Linter/Formatter | Biome                                   |
| Git Hooks        | Lefthook                                |
| Testing          | Vitest + Playwright                     |
| CI               | GitHub Actions (Node 20/22/24 matrix)   |
| Tool Versions    | mise                                    |

---

## Development Commands

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # TypeScript check + Vite build -> dist/
pnpm typecheck        # Type check only (tsc --noEmit)
pnpm format           # Biome check --write + Ruff format
pnpm test             # Run tests (vitest)
pnpm release          # Bump version, build, and package into ZIP (via release-it)
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
- **Semicolons**: Only when needed (ASI-safe)
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
- **Pre-commit hook**: `pnpm format` (Biome check + Ruff format, staged files auto-fixed)
- **Pre-push hook**: `pnpm typecheck`

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

### Permissions Explained

| Permission  | Why                                             |
| ----------- | ----------------------------------------------- |
| `tabs`      | Read tab URLs and titles for sorting/grouping   |
| `tabGroups` | Create, move, and update tab groups             |
| `storage`   | Persist user settings via `chrome.storage.sync` |

### Storage Schema

Settings are stored in `chrome.storage.sync` with `SortSettings` interface. Default values are defined in `src/background/index.ts` as `DEFAULT_SETTINGS`.

---

## CI/CD

### GitHub Actions (`ci.yml`)

Runs on push to `main`, PRs to `main`, and manual dispatch:

1. Setup mise tools
2. Setup pnpm + Node.js (matrix: 20, 22, 24)
3. `pnpm install --frozen-lockfile`
4. `pnpm typecheck`
5. `pnpm format` (checks formatting)
6. `pnpm build`

### CodeQL (`codeql.yml`)

Scheduled security scanning for JavaScript/TypeScript (Fridays at 19:42 UTC).

---

## Testing

Playwright is installed but **no test files exist yet**. When adding tests:

- Place test files adjacent to source or in a `tests/` directory
- Chrome extension testing requires specialized setup (use Playwright's browser context with extension loading)
- The service worker logic (`src/background/index.ts`) contains pure functions that can be unit-tested independently if extracted

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
2. Update `PRIVACY_POLICY.md` if new permissions access user data

### Adding a new sort mode

1. Add the mode to `SortBy` type in `src/types.ts`
2. Add a `case` in the `switch` statement inside `sortTabs()` in `src/background/index.ts`
3. Implement the sort function following existing patterns (`sortByTitleOrUrl`, `sortByCustom`)

---

## Gotchas & Edge Cases

- **No `manifest.json` file**: The manifest is defined inline in `vite.config.ts`. Don't look for a separate manifest file.
- **Suspended tabs**: The extension integrates with "The Marvellous Suspender". Suspended tab URLs are wrapped in `chrome-extension://<id>/suspended.html#uri=<real-url>`. The `tabToUrl()` function unwraps them.
- **Tab group IDs**: `-1` means ungrouped in the Chrome API. The code uses this convention throughout.
- **Module-scoped state**: `tabSuspenderExtensionId`, `suspendedPrefix`, and `suspendedPrefixLen` are module-level variables updated in `sortTabs()`. This works because service workers are single-threaded, but be aware these are mutable globals.
- **Tab ID arrays**: Chrome's `tabs.move()` and `tabs.group()` require `[number, ...number[]]` tuple type for non-empty arrays.
- **`pnpm-workspace.yaml`**: Exists but this is not a monorepo — it only configures `onlyBuiltDependencies` for esbuild, lefthook, and msw.
