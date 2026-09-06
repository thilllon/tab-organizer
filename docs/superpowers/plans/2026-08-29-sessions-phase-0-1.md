# Sessions — Phase 0 & 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working slice of Session Buddy-style session management — save the current/all windows from the icon's right-click menu or a keyboard command, list them in a new full-page dashboard, and restore them faithfully (order, pinned, active tab, tab groups, window state) — without changing what a left-click on the icon does.

**Architecture:** Pure, unit-tested modules under `src/sessions/` (capture, storage, restore planning) sit between two thin Chrome layers: `src/background/sessions.ts` (context-menu/command listeners; the only service-worker code added) and a React dashboard page (`dashboard.html`) that talks to `chrome.*` directly and runs restores itself. Session data lives in `chrome.storage.local` as one key per session plus a small index, written under a Web Lock. A typed in-memory `chrome` fake makes every Chrome-facing function testable in vitest.

**Tech Stack:** TypeScript (strict), React 19, Tailwind 4 + shadcn/ui, Vite 8 + @crxjs/vite-plugin 2.7, vitest 4, @types/chrome 0.2.x, Biome.

**Spec:** `docs/superpowers/specs/2026-08-29-sessions-design.md` (this plan covers §2–§6 and §9–§13 for Phases 0 and 1; Phases 2–6 and the v7.0.0 release prep get their own plans).

## Global Constraints

- The left-click path is untouched: `chrome.action.onClicked → sortTabGroups()` stays byte-for-byte; no `default_popup`; `src/background/sort.ts`, `sortTabGroups`, `sortTabs` and the duplicate handlers are never edited.
- Zero network requests, no content scripts, no `host_permissions`. Favicons come from `chrome.runtime.getURL('/_favicon/?pageUrl=…&size=32')` only.
- Session data goes to `chrome.storage.local` only (never `chrome.storage.sync`); keys are `session:<id>`, `sessionIndex`, `sessionSettings`, `historyMeta`; every write goes through `sessionRepo` inside `withLock` (`navigator.locks`, name `tab-organizer:sessions`).
- No `chrome.tabs.*` / `chrome.windows.*` / `chrome.tabGroups.*` event listeners in the service worker.
- Chrome runtime ids (tab/window/group ids) are never persisted; groups are referenced by index.
- Manifest changes (Phase 1): `permissions: ['tabs','tabGroups','storage','contextMenus','unlimitedStorage','favicon']`, `commands: { 'save-session': …, 'open-dashboard': … }` with no `suggested_key`; `alarms` is Phase 3.
- Defaults: `DEFAULT_SESSION_SETTINGS = { historyEnabled: true, historyIntervalMinutes: 5, historyMaxSnapshots: 20, restoreLazy: 'auto' }` (history itself ships in Phase 3; the default is declared now).
- Restore: chunks of 25 `tabs.create` calls, yield between chunks, lazy discard (`'auto'` = when total tabs > 50) only for non-active, non-pinned tabs, groups created only after all of a window's tabs exist, collapse last, placeholder `about:blank` tab removed after activation, retry once on "Tabs cannot be edited right now".
- Code style (Biome): single quotes, semicolons, trailing commas, braces on every block, 100 columns, strict TS, no `any`, no non-null `!`; `@/` → `src/`; tests are `*.test.ts` beside the module, `import { describe, expect, it } from 'vitest'`.
- Commits: conventional (`feat(sessions): …`, `test(sessions): …`, `docs(sessions): …`), **no `Co-Authored-By`**. Pre-commit runs `pnpm format` + `pnpm listing`; push with `LEFTHOOK_EXCLUDE=update-docs` on this branch.
- Docs travel with the code: any commit that changes the manifest also updates `docs/README.md` (Description + Privacy), `PRIVACY_POLICY.md` and `AGENTS.md`.

## File Structure

```
dashboard.html                          # second HTML entry (T1)
vite.config.ts                          # rollup input, vitest setupFiles (T1/T2); manifest permissions + commands (T10)
src/types.ts                            # + Session* types, DEFAULT_SESSION_SETTINGS (T3)
src/test/chrome-fake.ts                 # typed in-memory chrome (storage/tabs/windows/tabGroups/runtime/menus/commands/action/alarms) (T2)
src/test/setup.ts                       # installs the fake on globalThis before each test (T2)
src/sessions/naming.ts (+test)          # defaultSessionName, slugify (T3)
src/sessions/migrate.ts (+test)         # migrateSession, migrateIndex, UnknownSchemaVersionError (T4)
src/sessions/hash.ts (+test)            # contentHash (FNV-1a) (T4)
src/sessions/capture.ts (+test)         # captureWindows (pure) (T5), captureSession (chrome) (T9)
src/sessions/storage.ts (+test)         # sessionRepo, withLock, keys (T6)
src/sessions/restore.ts (+test)         # sanitizeRestoreUrl, clampToScreen, planRestore (T7); executeRestore, withRetryOnce (T8)
src/sessions/open-dashboard.ts          # openDashboard singleton (T9)
src/background/sessions.ts (+test)      # onInstalled/onStartup/contextMenus/commands listeners, badge (T9)
src/background/index.ts                 # + import './sessions' (T10)
src/dashboard/index.tsx, index.css      # React entry (T1 placeholder, T11 real)
src/dashboard/Dashboard.tsx             # header + list + empty state (T11)
src/dashboard/hooks/useSessionIndex.ts  # index subscription (T11)
src/dashboard/hooks/useSessionBody.ts   # lazy body load (T12)
src/dashboard/hooks/useRestore.ts       # restore orchestration + progress (T13)
src/dashboard/components/SessionCard.tsx, WindowTree.tsx, GroupSection.tsx, TabRow.tsx, Favicon.tsx, ProgressToast.tsx (T11–T13)
src/components/ui/{input,dialog,dropdown-menu,badge,tooltip,separator,scroll-area,collapsible}.tsx  # shadcn (T11)
src/options/Options.tsx                 # Sessions card (T14)
docs/README.md, PRIVACY_POLICY.md, AGENTS.md  # listing/privacy/agent docs (T15)
```

Task order: T1 → T2 → T3 → T4 (Phase 0, no user-visible change) → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 (Phase 1). T5–T8 are pure and can be parallelised after T2–T4; everything from T9 on depends on them.

---

## Phase 0 — Scaffold & spike

# Sessions plan — Part A: Phase 0 scaffold (T1–T4)

Repo: `/Users/thilllon/git/tab-organizer`, branch `feat/sessions`. Contract: `plan-contract.md`. Spec: `docs/superpowers/specs/2026-08-29-sessions-design.md`.

Ground rules for every task below (they are not repeated per task):

- Run every command from the repo root. `pnpm exec vitest run <path>` runs one file; `pnpm test` runs all.
- Code style is enforced by Biome (`pnpm exec biome check --write <files>` before committing): single quotes, semicolons, trailing commas, 2-space indent, 100 columns, braces on every `if`/`for`. Strict TS: no `any`, no `!` non-null assertions, narrow optionals (`tab.id`, `window.id`, `window.tabs`) explicitly.
- Tests: `import { describe, expect, it } from 'vitest';`, files `*.test.ts` next to the module, path alias `@/` = `src/`.
- Commit messages: `feat(sessions): …` / `test(sessions): …`. No `Co-Authored-By` lines. Push with `LEFTHOOK_EXCLUDE=update-docs git push` so the docs hook does not amend commits on this branch.
- Everything below was verified on a mirror of the repo with Node 26.7 / pnpm 11.24 / vitest 4.1 / TypeScript 7.0 / @types/chrome 0.2.5: `tsc --noEmit`, `biome check`, `vitest run` (99 tests: 65 existing + 34 new) and `vite build` (emits `dist/dashboard.html`) are all green with exactly the file contents shown.

---

### Task 1: Dashboard HTML entry + rollup input

**Files:**

- Create: `dashboard.html`
- Create: `src/dashboard/index.tsx`
- Create: `src/dashboard/index.css`
- Modify: `vite.config.ts` (add `build.rollupOptions.input` only; the `vitest/config` import and `test.setupFiles` are added in Task 2 Step 4 so `pnpm test` stays green after this task)
- Test: none (build verification)

**Interfaces:**

- Consumes: nothing.
- Produces: second HTML entry `dashboard.html` (opened later by `openDashboard()` via `chrome.runtime.getURL('dashboard.html')`).

Why `rollupOptions.input`: crxjs 2.x only auto-builds HTML files referenced from the manifest (`options_page`). `dashboard.html` is opened by URL from our own code and is never referenced by the manifest, so it must be an explicit rollup input or `pnpm build` silently omits it.

- [ ] **Step 1: Create `dashboard.html`** (copy of `options.html` with a new title and entry script)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/img/logo.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tab Organizer - Sessions</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/dashboard/index.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the placeholder React entry and its stylesheet**

`src/dashboard/index.tsx` (mirrors `src/options/index.tsx`; `Dashboard.tsx` replaces the inline `<main>` in Task 11):

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Sessions</h1>
    </main>
  </StrictMode>,
);
```

`src/dashboard/index.css` (one line; reuses the Tailwind + shadcn theme tokens from the options page so both pages look identical):

```css
@import '../options/index.css';
```

- [ ] **Step 3: Apply this exact diff to `vite.config.ts`**

```diff
diff --git aa/vite.config.ts bb/vite.config.ts
index 5f7f9f6..3c1d2e4 100644
--- aa/vite.config.ts
+++ bb/vite.config.ts
@@ -52,6 +52,10 @@ export default defineConfig(() => {
     build: {
       emptyOutDir: true,
       rollupOptions: {
+        input: {
+          options: 'options.html',
+          dashboard: 'dashboard.html',
+        },
         output: {
           chunkFileNames: 'assets/chunk-[hash].js',
         },
```

Resulting relevant part of `vite.config.ts` (unchanged lines elided with `…`; the import still comes from `'vite'` until Task 2):

```ts
import { defineConfig } from 'vite';
…
export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          options: 'options.html',
          dashboard: 'dashboard.html',
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    …
  };
});
```

The manifest (`permissions: ['tabs', 'tabGroups', 'storage']`, no `commands`) is deliberately NOT touched in Phase 0 — that is Task 10.

- [ ] **Step 4: Verify the build emits the new entry**

Run: `pnpm build && ls dist/*.html && pnpm typecheck && pnpm test`
Expected: the vite summary lists both `dist/dashboard.html` and `dist/options.html` plus `dist/assets/dashboard-<hash>.js`; `ls` prints both html files; `tsc` exits 0; `pnpm test` still passes the 65 existing tests (no setup file is configured yet).

- [ ] **Step 5: Manual verification in Chrome (dev server + HMR)**

1. `pnpm dev`, then in `chrome://extensions` (Developer mode on) click "Load unpacked" and pick `dist/`.
2. Open a new tab at `chrome-extension://<the extension id shown on its card>/dashboard.html`.
   Expected: a white page with the heading "Sessions" in the options-page font; DevTools console has no errors.
3. Change the heading text in `src/dashboard/index.tsx` to "Sessions!" and save.
   Expected: the open dashboard tab updates without a manual reload (crxjs HMR serves the second entry). Revert the text.
4. Click the extension icon on any normal window.
   Expected: tabs get sorted exactly as before — no dashboard opens, no popup (identity check that must pass in every phase).

- [ ] **Step 6: Commit**

```bash
git add dashboard.html src/dashboard/index.tsx src/dashboard/index.css vite.config.ts
git commit -m "feat(sessions): add dashboard.html entry as a second rollup input"
```

---

### Task 2: Vitest setup + typed in-memory chrome fake

**Files:**

- Create: `src/test/chrome-fake.ts`
- Create: `src/test/setup.ts`
- Modify: `vite.config.ts` (import `defineConfig` from `vitest/config`; add `test.setupFiles`)
- Test: `src/test/chrome-fake.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1 (the `dashboard.html` entry is independent).
- Produces (used by every later test): `test.setupFiles: ['src/test/setup.ts']` in `vite.config.ts`; `createChromeFake(): ChromeFake`, `getChromeFake(): ChromeFake`, `makeEvent<T>()`, and the types `ChromeFake { chrome: typeof chrome; state: FakeState; fire: FakeFire; failNext(api: FailableApi, times: number, message: string): void }`, `FakeState`, `FakeWindow`, `FakeTab`, `FakeGroup`, `FakeFire { installed(details); startup(); menuClicked(menuItemId); command(name); alarm(name); actionClicked(tab?) }`, `FailableApi = 'tabs.create' | 'tabs.group' | 'tabs.discard' | 'tabGroups.update' | 'windows.create' | 'storage.local.set'`. `globalThis.chrome` is the fake's API in every test (fresh instance per test), `globalThis.__chromeFake` the handle.

Behavioural model the later tasks rely on (all verified by the test file below):

- The fake starts with ONE focused, empty, normal window (id 1); `tabs.create` without `windowId` targets it. Real Chrome never has an empty window, but starting empty keeps capture tests free of noise; `windows.create()` follows Chrome and always creates one tab (`about:blank` if no `url`). `windows.getAll`/`getLastFocused`/`getCurrent` honour `QueryOptions.windowTypes` (a no-op filter today since every fake window is `'normal'`).
- `tabs.create`: default `active: true` (Chrome default), inserts at `index` or the end, then `reindex()` enforces pinned-first and contiguous indices; the first tab in a window is always active; rejects with `No window with id: N.` for unknown windows; every call is appended to `state.createdTabs` (even failed ones are NOT — `failNext` rejects before recording).
- `tabs.group`: fresh id from `nextId.group`, `windowId` = `createProperties.windowId ?? first tab's window`, `color: 'grey'`, `title: ''`; rejects `Tabs cannot be pinned and grouped.` for a pinned member; `tabs.ungroup`/`tabs.remove`/`windows.remove` drop groups that became empty (Chrome does the same).
- `tabs.discard`: rejects `Cannot discard active tab`, otherwise sets `discarded: true`.
- `tabs.remove`: re-indexes, activates the neighbour of a removed active tab, deletes a window whose last tab was removed.
- `storage.local` / `storage.sync`: `get(key | keys[] | defaultsObject | null)`, `set` (skips `undefined` values, deep-clones in and out), `remove`, `clear`, `getKeys`, `getBytesInUse` (`key.length + JSON.stringify(value).length`, Chrome's documented formula). Every mutation fires BOTH `chrome.storage.onChanged(changes, areaName)` and `chrome.storage.<area>.onChanged(changes)` with `{ oldValue, newValue }` per key (`oldValue` absent-as-`undefined` for a new key, `newValue` omitted for a removal).
- `runtime.id === 'fakeextid'`; `getURL('/x')` → `chrome-extension://fakeextid/x`; `getManifest().version === '7.0.0'`.
- `failNext(api, times, message)`: the next `times` calls of that API reject with `new Error(message)`; the counter is per API and reset with every new fake.

- [ ] **Step 1: Write the failing test**

`src/test/chrome-fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';

describe('chrome fake: tab strip', () => {
  it('keeps pinned tabs first and re-indexes on create', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test', active: false });
    const b = await chrome.tabs.create({ url: 'https://b.test', active: false });
    const p = await chrome.tabs.create({ url: 'https://p.test', pinned: true, active: false });

    const strip = await chrome.tabs.query({ windowId: a.windowId });
    expect(strip.map((tab) => [tab.url, tab.index, tab.pinned])).toEqual([
      ['https://p.test', 0, true],
      ['https://a.test', 1, false],
      ['https://b.test', 2, false],
    ]);
    expect(p.index).toBe(0);
    expect(b.id).not.toBe(a.id);
  });

  it('activates the new tab by default and deactivates siblings', async () => {
    const first = await chrome.tabs.create({ url: 'https://a.test' });
    const second = await chrome.tabs.create({ url: 'https://b.test' });
    const strip = await chrome.tabs.query({});
    expect(strip.find((tab) => tab.id === first.id)?.active).toBe(false);
    expect(strip.find((tab) => tab.id === second.id)?.active).toBe(true);
  });

  it('rejects tabs.create for an unknown window', async () => {
    await expect(chrome.tabs.create({ windowId: 999, url: 'https://a.test' })).rejects.toThrow(
      'No window with id: 999.',
    );
  });

  it('re-indexes after tabs.remove', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test' });
    const b = await chrome.tabs.create({ url: 'https://b.test' });
    const c = await chrome.tabs.create({ url: 'https://c.test' });
    if (b.id === undefined) {
      throw new Error('expected id');
    }
    await chrome.tabs.remove(b.id);
    const strip = await chrome.tabs.query({});
    expect(strip.map((tab) => [tab.id, tab.index])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
  });

  it('windows.create makes a window with one about:blank tab', async () => {
    const win = await chrome.windows.create({ focused: false });
    if (!win) {
      throw new Error('expected window');
    }
    expect(win.tabs?.length).toBe(1);
    expect(win.tabs?.[0]?.url).toBe('about:blank');
    expect(win.tabs?.[0]?.active).toBe(true);
    expect(getChromeFake().state.windows.size).toBe(2);
  });

  it('tabs.discard marks the tab and refuses the active tab', async () => {
    const active = await chrome.tabs.create({ url: 'https://a.test' });
    const idle = await chrome.tabs.create({ url: 'https://b.test', active: false });
    if (active.id === undefined || idle.id === undefined) {
      throw new Error('expected ids');
    }
    await expect(chrome.tabs.discard(active.id)).rejects.toThrow('Cannot discard active tab');
    const discarded = await chrome.tabs.discard(idle.id);
    expect(discarded?.discarded).toBe(true);
  });
});

describe('chrome fake: groups', () => {
  it('tabs.group assigns a fresh group id and sets groupId on members', async () => {
    const a = await chrome.tabs.create({ url: 'https://a.test' });
    const b = await chrome.tabs.create({ url: 'https://b.test' });
    const c = await chrome.tabs.create({ url: 'https://c.test' });
    if (a.id === undefined || b.id === undefined || c.id === undefined) {
      throw new Error('expected ids');
    }
    const g1 = await chrome.tabs.group({ tabIds: [a.id, b.id], createProperties: { windowId: 1 } });
    const g2 = await chrome.tabs.group({ tabIds: [c.id] });
    expect(g1).not.toBe(g2);

    const grouped = await chrome.tabs.query({ groupId: g1 });
    expect(grouped.map((tab) => tab.id)).toEqual([a.id, b.id]);

    await chrome.tabGroups.update(g1, { title: 'Work', color: 'blue', collapsed: true });
    expect(await chrome.tabGroups.get(g1)).toMatchObject({
      id: g1,
      windowId: 1,
      title: 'Work',
      color: 'blue',
      collapsed: true,
    });
    expect((await chrome.tabGroups.query({})).length).toBe(2);
  });

  it('refuses to group a pinned tab', async () => {
    const p = await chrome.tabs.create({ url: 'https://p.test', pinned: true });
    if (p.id === undefined) {
      throw new Error('expected id');
    }
    await expect(chrome.tabs.group({ tabIds: [p.id] })).rejects.toThrow(
      'Tabs cannot be pinned and grouped.',
    );
  });
});

describe('chrome fake: storage', () => {
  it('storage.onChanged fires with old and new values for the local area', async () => {
    const seen: Array<[Record<string, chrome.storage.StorageChange>, string]> = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      seen.push([changes, area]);
    });
    await chrome.storage.local.set({ k: 1 });
    await chrome.storage.local.set({ k: 2 });
    await chrome.storage.local.remove('k');
    expect(seen).toEqual([
      [{ k: { oldValue: undefined, newValue: 1 } }, 'local'],
      [{ k: { oldValue: 1, newValue: 2 } }, 'local'],
      [{ k: { oldValue: 2 } }, 'local'],
    ]);
  });

  it('get returns copies, honours defaults objects and null (everything)', async () => {
    await chrome.storage.local.set({ a: { n: 1 }, b: 'x' });
    const all = await chrome.storage.local.get(null);
    expect(all).toEqual({ a: { n: 1 }, b: 'x' });
    const withDefault = await chrome.storage.local.get({ a: 0, missing: 'dflt' });
    expect(withDefault).toEqual({ a: { n: 1 }, missing: 'dflt' });
    const stored = getChromeFake().state.local.get('a');
    expect(stored).toEqual({ n: 1 });
    expect(stored).not.toBe(all.a);
  });

  it('getKeys lists keys and getBytesInUse counts JSON bytes', async () => {
    await chrome.storage.local.set({ 'session:1': { x: 1 }, sessionIndex: [] });
    expect((await chrome.storage.local.getKeys()).sort()).toEqual(['session:1', 'sessionIndex']);
    expect(await chrome.storage.local.getBytesInUse('sessionIndex')).toBe(
      'sessionIndex'.length + '[]'.length,
    );
    expect(await chrome.storage.local.getBytesInUse(null)).toBe(
      'sessionIndex'.length + 2 + 'session:1'.length + JSON.stringify({ x: 1 }).length,
    );
  });

  it('sync is a separate area', async () => {
    await chrome.storage.sync.set({ s: 1 });
    expect(await chrome.storage.local.get('s')).toEqual({});
    expect(await chrome.storage.sync.get('s')).toEqual({ s: 1 });
  });
});

describe('chrome fake: failNext and events', () => {
  it('failNext rejects exactly N calls, then succeeds', async () => {
    getChromeFake().failNext('tabs.create', 2, 'Tabs cannot be edited right now');
    await expect(chrome.tabs.create({ url: 'https://a.test' })).rejects.toThrow(
      'Tabs cannot be edited right now',
    );
    await expect(chrome.tabs.create({ url: 'https://a.test' })).rejects.toThrow(
      'Tabs cannot be edited right now',
    );
    const ok = await chrome.tabs.create({ url: 'https://a.test' });
    expect(ok.url).toBe('https://a.test');
    expect(getChromeFake().state.createdTabs.length).toBe(1);
  });

  it('fire helpers reach registered listeners', () => {
    const fake = getChromeFake();
    const log: string[] = [];
    chrome.runtime.onInstalled.addListener((details) => {
      log.push(`installed:${details.reason}`);
    });
    chrome.runtime.onStartup.addListener(() => {
      log.push('startup');
    });
    chrome.contextMenus.onClicked.addListener((info) => {
      log.push(`menu:${String(info.menuItemId)}`);
    });
    chrome.commands.onCommand.addListener((name) => {
      log.push(`command:${name}`);
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
      log.push(`alarm:${alarm.name}`);
    });
    fake.fire.installed({ reason: 'install' });
    fake.fire.startup();
    fake.fire.menuClicked('save-window');
    fake.fire.command('open-dashboard');
    fake.fire.alarm('history-snapshot');
    expect(log).toEqual([
      'installed:install',
      'startup',
      'menu:save-window',
      'command:open-dashboard',
      'alarm:history-snapshot',
    ]);
  });

  it('runtime, badge, menus and alarms are inspectable', async () => {
    const fake = getChromeFake();
    expect(chrome.runtime.id).toBe('fakeextid');
    expect(chrome.runtime.getURL('/dashboard.html')).toBe(
      'chrome-extension://fakeextid/dashboard.html',
    );
    expect(chrome.runtime.getManifest().version).toBe('7.0.0');
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    expect(fake.state.badge).toEqual({ text: '✓', color: '#16a34a' });
    chrome.contextMenus.create({ id: 'x', title: 'X', contexts: ['action'] });
    expect(fake.state.menus.map((menu) => menu.id)).toEqual(['x']);
    await chrome.contextMenus.removeAll();
    expect(fake.state.menus).toEqual([]);
    await chrome.alarms.create('history-snapshot', { periodInMinutes: 5 });
    expect((await chrome.alarms.getAll()).map((alarm) => alarm.name)).toEqual(['history-snapshot']);
    expect(await chrome.alarms.clear('history-snapshot')).toBe(true);
    expect(await chrome.extension.isAllowedFileSchemeAccess()).toBe(false);
    fake.state.fileAccessAllowed = true;
    expect(await chrome.extension.isAllowedFileSchemeAccess()).toBe(true);
  });

  it('a fresh fake is installed for every test', () => {
    expect(getChromeFake().state.tabs.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/test/chrome-fake.test.ts`
Expected: FAIL with `Error: Failed to resolve import "@/test/chrome-fake"` (module does not exist yet). If you write `chrome-fake.ts` first and only then run, every test fails instead with `ReferenceError: chrome is not defined` because no setup file is configured until Step 4.

- [ ] **Step 3: Write `src/test/chrome-fake.ts`**

```ts
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
    status: 'complete',
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
      state.createdTabs.push({ ...props });
      const windowId = props.windowId ?? focusedWindow().id;
      const tab = insertTab(windowId, {
        url: props.url,
        pinned: props.pinned,
        active: props.active,
        index: props.index,
      });
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
      return toChromeTab(tab);
    },
    async get(tabId: number): Promise<chrome.tabs.Tab> {
      return toChromeTab(requireTab(tabId));
    },
  };

  // ---- windows -------------------------------------------------------------

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
  };
}

// ---------------------------------------------------------------------------
// Access from tests
// ---------------------------------------------------------------------------

declare global {
  // Installed by src/test/setup.ts before each test; `var` is required for a globalThis member.
  var __chromeFake: ChromeFake | undefined;
}

/** Returns the fake installed by `src/test/setup.ts` for the current test. */
export function getChromeFake(): ChromeFake {
  const fake = globalThis.__chromeFake;
  if (!fake) {
    throw new Error('Chrome fake not installed; is src/test/setup.ts in vitest setupFiles?');
  }
  return fake;
}
```

Notes on the two typed escape hatches (the only ones in non-test code besides the documented `as unknown as Session` in `migrate.ts`, Task 4; test files may narrow storage reads with `as SessionIndex`):

1. `api as unknown as typeof chrome` (end of `createChromeFake`). `typeof chrome` declares ~60 namespaces, callback overloads for every function and `getRules`/`addRules` on every event. The fake implements only what the extension calls, so no structural assignment is possible. The double cast via `unknown` is intentional: a direct `as typeof chrome` would be rejected by TS anyway ("neither type sufficiently overlaps"), and going through `unknown` makes the intent explicit. The trade-off is that a method the app calls but the fake lacks fails at runtime with `TypeError: chrome.x.y is not a function` — that is the desired signal ("extend the fake").
2. `declare global { var __chromeFake: ChromeFake | undefined }`. This is a declaration, not a cast; it types the ad-hoc global written by `setup.ts` so `getChromeFake()` needs no assertion. `var` is required by TS for `globalThis` members (Biome's `noVar` does not fire inside `declare global`).

All other narrowing in the file is done with type guards (`typeof`, `Array.isArray`, `=== undefined`).

- [ ] **Step 4: Write `src/test/setup.ts` and register it in `vite.config.ts`**

`src/test/setup.ts`:

```ts
import { beforeEach } from 'vitest';
import { createChromeFake } from './chrome-fake';

/** `lib.dom.d.ts` declares `LockGrantedCallback` non-generic, so a typed alias is used instead. */
type LockCallback<T> = (lock: Lock | null) => T | Promise<T>;

/**
 * Minimal Web Locks shim for runtimes without `navigator.locks` (Node < 24, some CI images).
 * Serialises callbacks per lock name, which is all `withLock()` in src/sessions/storage.ts needs.
 */
function createLocksShim(): LockManager {
  const queues = new Map<string, Promise<unknown>>();
  function request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockCallback<T>,
    maybeCallback?: LockCallback<T>,
  ): Promise<Awaited<T>> {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (!callback) {
      return Promise.reject(new TypeError('LockManager.request: callback is required'));
    }
    const previous = queues.get(name) ?? Promise.resolve();
    const run = async (): Promise<Awaited<T>> => {
      await previous.catch(() => undefined);
      return await callback({ name, mode: 'exclusive' });
    };
    const next = run();
    queues.set(name, next);
    return next;
  }
  return {
    request,
    query: async () => ({ held: [], pending: [] }),
  };
}

function installLocksShim(): void {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    return;
  }
  const shim = createLocksShim();
  if (typeof navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: { locks: shim }, configurable: true });
    return;
  }
  Object.defineProperty(navigator, 'locks', { value: shim, configurable: true });
}

installLocksShim();

// A chrome object must exist at module-evaluation time: `src/background/sessions.ts` (Task 9)
// registers `chrome.runtime.onInstalled.addListener(...)` in its module body, and a static
// `import` in its test runs before any `beforeEach`. This instance is replaced per test below.
Object.assign(globalThis, { chrome: createChromeFake().chrome });

beforeEach(() => {
  const fake = createChromeFake();
  Object.assign(globalThis, { chrome: fake.chrome, __chromeFake: fake });
});
```

Node 26 (the version pinned in `mise.toml`) already ships `navigator.locks`, so the shim is dormant there; it exists for older runtimes and mirrors what `withLock()` (Task 6) needs — exclusive per-name serialisation. `Object.defineProperty` is used instead of assignment because `navigator` is a getter-backed global and `navigator.locks` is a prototype accessor. `LockManager.request` is declared as returning `Promise<any>`, so the `Promise<Awaited<T>>` implementation stays assignable without a cast. The top-level `Object.assign` deliberately does not set `__chromeFake`: `getChromeFake()` must only ever hand out the per-test instance.

Then apply this exact diff to `vite.config.ts` (`vitest/config` re-exports Vite's `defineConfig` with the `test` key added, so plugins, aliases and `legacy` are unchanged; `tsconfig.node.json` already includes `vite.config.ts` and `vitest` is a devDependency):

```diff
diff --git aa/vite.config.ts bb/vite.config.ts
index 3c1d2e4..529ca05 100644
--- aa/vite.config.ts
+++ bb/vite.config.ts
@@ -2,7 +2,7 @@ import path from 'node:path';
 import { crx, defineManifest } from '@crxjs/vite-plugin';
 import tailwindcss from '@tailwindcss/vite';
 import react from '@vitejs/plugin-react';
-import { defineConfig } from 'vite';
+import { defineConfig } from 'vitest/config';
 import packageJson from './package.json';

 interface PackageJson {
@@ -75,5 +75,8 @@ export default defineConfig(() => {
     legacy: {
       skipWebSocketTokenCheck: true,
     },
+    test: {
+      setupFiles: ['src/test/setup.ts'],
+    },
   };
 });
```

Resulting tail of `vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
…
    plugins: [crx({ manifest }), react(), tailwindcss()],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
    test: {
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/test/chrome-fake.test.ts && pnpm typecheck && pnpm exec biome check src/test && pnpm build`
Expected: `Tests  16 passed (16)`; `tsc` exits 0 (including `vite.config.ts` via `tsconfig.node.json`); biome "No fixes applied"; the build still lists `dist/dashboard.html`. Then `pnpm test` — the existing `sort.test.ts` and `build-listing.test.ts` still pass with the setup file installed (they never touch `chrome`).

- [ ] **Step 6: Commit**

```bash
git add src/test/chrome-fake.ts src/test/setup.ts src/test/chrome-fake.test.ts vite.config.ts
git commit -m "test(sessions): add typed in-memory chrome fake and vitest setup"
```

---

### Task 3: Session types + naming helpers

**Files:**

- Modify: `src/types.ts` (append the Sessions block; `SortSettings` and the four existing type aliases stay byte-for-byte)
- Create: `src/sessions/naming.ts`
- Test: `src/sessions/naming.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: from `@/types` — `SESSION_SCHEMA_VERSION`, `SessionId`, `SessionKind`, `SessionOrigin`, `TabGroupColor`, `TabSnapshot`, `GroupSnapshot`, `WindowBounds`, `WindowSnapshot`, `Session`, `SessionSummary`, `SessionIndex`, `SessionSettings`, `DEFAULT_SESSION_SETTINGS`, `ExportFormat`, `ExportBundle`; from `@/sessions/naming` — `defaultSessionName(date: Date, windowCount: number, tabCount: number): string`, `slugify(name: string): string`.

- [ ] **Step 1: Write the failing test**

`src/sessions/naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultSessionName, slugify } from './naming';

describe('defaultSessionName', () => {
  it('formats local date/time with zero padding and plural counts', () => {
    const date = new Date(2026, 7, 29, 14, 3); // local time: 2026-08-29 14:03
    expect(defaultSessionName(date, 3, 87)).toBe('Session 2026-08-29 14:03 · 3 windows · 87 tabs');
  });

  it('uses singular nouns for 1', () => {
    const date = new Date(2026, 0, 5, 9, 7);
    expect(defaultSessionName(date, 1, 1)).toBe('Session 2026-01-05 09:07 · 1 window · 1 tab');
  });

  it('uses plural for 0', () => {
    const date = new Date(2026, 11, 31, 23, 59);
    expect(defaultSessionName(date, 0, 0)).toBe('Session 2026-12-31 23:59 · 0 windows · 0 tabs');
  });
});

describe('slugify', () => {
  it('lowercases and replaces runs of non-alphanumerics with a single dash', () => {
    expect(slugify('Session 2026-08-29 14:03 · 3 windows · 87 tabs')).toBe(
      'session-2026-08-29-14-03-3-windows-87-ta',
    );
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --Hello World!--  ')).toBe('hello-world');
  });

  it('caps at 40 characters without a trailing dash', () => {
    const long = `${'a'.repeat(39)} b`;
    expect(slugify(long)).toBe('a'.repeat(39));
    expect(slugify('x'.repeat(100)).length).toBe(40);
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('···')).toBe('');
  });
});
```

(The `Date` constructor with numeric parts builds a LOCAL time, so the expectations hold in any timezone; `slugify` on the sample name is cut at 40 chars, hence `…-87-ta`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sessions/naming.test.ts`
Expected: FAIL with `Error: Failed to resolve import "./naming"`.

- [ ] **Step 3: Append the Sessions types to `src/types.ts`**

Append after the existing `SortSettings` interface (leave everything above untouched):

```ts

// ---------------------------------------------------------------------------
// Sessions (save / restore). Chrome runtime ids are never persisted.
// ---------------------------------------------------------------------------

export const SESSION_SCHEMA_VERSION = 1 as const;
export type SessionId = string; // crypto.randomUUID()
export type SessionKind = 'saved' | 'history';
export type SessionOrigin = 'manual' | 'alarm' | 'startup' | 'recovered' | 'import';
export type TabGroupColor = `${chrome.tabGroups.Color}`; // same form as hashStringToColor()

export interface TabSnapshot {
  url: string; // pendingUrl ?? url; suspender wrappers unwrapped via tabToUrl()
  title: string;
  pinned: boolean;
  active: boolean; // at most one true per window
  groupIndex?: number; // index into WindowSnapshot.groups; MUST be absent when pinned
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
  state: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
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
  contentHash?: string; // FNV-1a over windows->tabs (url, pinned, groupIndex, group title)
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
  restoreLazy: 'auto' | 'always' | 'never'; // default 'auto' = discard when tabCount > 50
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  historyEnabled: true,
  historyIntervalMinutes: 5,
  historyMaxSnapshots: 20,
  restoreLazy: 'auto',
};

export type ExportFormat = 'json' | 'markdown' | 'text' | 'html' | 'csv';

export interface ExportBundle {
  app: 'tab-organizer';
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  exportedAt: number;
  sessions: Session[];
}
```

`WindowBounds` is named (rather than inlined as in the spec) because `clampToScreen()` (Task 7) and `PlannedWindow` need to refer to it; the shape is identical.

- [ ] **Step 4: Write `src/sessions/naming.ts`**

```ts
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Default name for a captured session, in local time:
 * "Session 2026-08-29 14:03 · 3 windows · 87 tabs"
 */
export function defaultSessionName(date: Date, windowCount: number, tabCount: number): string {
  const stamp =
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `Session ${stamp} · ${plural(windowCount, 'window')} · ${plural(tabCount, 'tab')}`;
}

/** Lowercase, non-alphanumerics collapsed to `-`, trimmed, at most 40 characters. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions/naming.test.ts && pnpm typecheck && pnpm exec biome check src/types.ts src/sessions`
Expected: `Tests  7 passed (7)`; `tsc` exits 0 (the new types reference `chrome.tabGroups.Color`, available through `"types": ["chrome"]`); biome clean.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/sessions/naming.ts src/sessions/naming.test.ts
git commit -m "feat(sessions): add session data model and default naming helpers"
```

---

### Task 4: Schema migration + content hash

**Files:**

- Create: `src/sessions/migrate.ts`
- Create: `src/sessions/hash.ts`
- Test: `src/sessions/migrate.test.ts`, `src/sessions/hash.test.ts`

**Interfaces:**

- Consumes: `Session`, `SessionIndex`, `SessionSummary`, `WindowSnapshot`, `SESSION_SCHEMA_VERSION` from `@/types` (Task 3).
- Produces: `class UnknownSchemaVersionError extends Error { readonly version: unknown }`, `migrateSession(record: unknown): Session`, `migrateIndex(record: unknown): SessionIndex`, `contentHash(windows: WindowSnapshot[]): string` (8 hex chars), helper `fnv1a32(input: string): string` (exported for the test vectors). `sessionRepo` (Task 6) calls `migrateSession` on every body read and `migrateIndex` on every index read; `captureSession` (Task 9) and history (Phase 3) call `contentHash`.

- [ ] **Step 1: Write the failing tests**

`src/sessions/migrate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { migrateIndex, migrateSession, UnknownSchemaVersionError } from './migrate';

const session: Session = {
  schemaVersion: 1,
  id: 'a1',
  kind: 'saved',
  name: 'Work',
  origin: 'manual',
  createdAt: 1,
  updatedAt: 2,
  windows: [
    {
      state: 'normal',
      focused: true,
      groups: [],
      tabs: [{ url: 'https://a.test', title: 'A', pinned: false, active: true }],
    },
  ],
};

describe('migrateSession', () => {
  it('is the identity for a v1 record', () => {
    const copy: unknown = JSON.parse(JSON.stringify(session));
    expect(migrateSession(copy)).toEqual(session);
  });

  it('throws TypeError for non-objects and records missing fields', () => {
    expect(() => migrateSession(null)).toThrow(TypeError);
    expect(() => migrateSession('x')).toThrow('Not a session record');
    expect(() => migrateSession({ schemaVersion: 1, id: 'a' })).toThrow('Not a session record');
  });

  it('throws UnknownSchemaVersionError for other versions', () => {
    const newer = { ...session, schemaVersion: 2 };
    expect(() => migrateSession(newer)).toThrow(UnknownSchemaVersionError);
    try {
      migrateSession(newer);
    } catch (error) {
      expect(error instanceof UnknownSchemaVersionError && error.version).toBe(2);
    }
  });
});

describe('migrateIndex', () => {
  it('returns an empty v1 index for undefined/null', () => {
    expect(migrateIndex(undefined)).toEqual({ schemaVersion: 1, sessions: [] });
    expect(migrateIndex(null)).toEqual({ schemaVersion: 1, sessions: [] });
  });

  it('keeps well-formed summaries and drops garbage entries', () => {
    const summary = {
      id: 'a1',
      kind: 'saved',
      name: 'Work',
      origin: 'manual',
      createdAt: 1,
      updatedAt: 2,
      windowCount: 1,
      tabCount: 1,
      bytes: 10,
    };
    expect(migrateIndex({ schemaVersion: 1, sessions: [summary, null, { id: 3 }] })).toEqual({
      schemaVersion: 1,
      sessions: [summary],
    });
  });

  it('rejects unknown versions and malformed indexes', () => {
    expect(() => migrateIndex({ schemaVersion: 9, sessions: [] })).toThrow(
      UnknownSchemaVersionError,
    );
    expect(() => migrateIndex({ schemaVersion: 1 })).toThrow('Not a session index');
    expect(() => migrateIndex(42)).toThrow('Not a session index');
  });
});
```

`src/sessions/hash.test.ts` (the `fnv1a32` vectors are the published FNV-1a 32-bit test values for `""`, `"a"`, `"foobar"`):

```ts
import { describe, expect, it } from 'vitest';
import type { WindowSnapshot } from '@/types';
import { contentHash, fnv1a32 } from './hash';

function win(tabs: WindowSnapshot['tabs'], groups: WindowSnapshot['groups'] = []): WindowSnapshot {
  return { state: 'normal', focused: false, groups, tabs };
}

describe('fnv1a32', () => {
  it('matches known FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});

describe('contentHash', () => {
  const base = [
    win(
      [
        { url: 'https://a.test', title: 'A', pinned: true, active: false },
        { url: 'https://b.test', title: 'B', pinned: false, active: true, groupIndex: 0 },
      ],
      [{ title: 'Work', color: 'blue', collapsed: false }],
    ),
  ];

  it('is 8 lowercase hex chars and stable across calls', () => {
    const hash = contentHash(base);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(structuredClone(base))).toBe(hash);
  });

  it('ignores titles', () => {
    const renamed = structuredClone(base);
    const first = renamed[0]?.tabs[0];
    if (first) {
      first.title = 'Changed';
    }
    expect(contentHash(renamed)).toBe(contentHash(base));
  });

  it('changes when tab order, pinned state, group membership or group title change', () => {
    const reordered = structuredClone(base);
    reordered[0]?.tabs.reverse();
    expect(contentHash(reordered)).not.toBe(contentHash(base));

    const unpinned = structuredClone(base);
    const first = unpinned[0]?.tabs[0];
    if (first) {
      first.pinned = false;
    }
    expect(contentHash(unpinned)).not.toBe(contentHash(base));

    const ungrouped = structuredClone(base);
    const second = ungrouped[0]?.tabs[1];
    if (second) {
      second.groupIndex = undefined;
    }
    expect(contentHash(ungrouped)).not.toBe(contentHash(base));

    const retitled = structuredClone(base);
    const group = retitled[0]?.groups[0];
    if (group) {
      group.title = 'Play';
    }
    expect(contentHash(retitled)).not.toBe(contentHash(base));
  });

  it('hashes an empty layout to the FNV offset basis', () => {
    expect(contentHash([])).toBe('811c9dc5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/sessions/migrate.test.ts src/sessions/hash.test.ts`
Expected: FAIL for both files with `Failed to resolve import "./migrate"` / `"./hash"`.

- [ ] **Step 3: Write `src/sessions/migrate.ts`**

```ts
import type { Session, SessionIndex, SessionSummary } from '@/types';
import { SESSION_SCHEMA_VERSION } from '@/types';

export class UnknownSchemaVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Unknown session schema version: ${String(version)}`);
    this.name = 'UnknownSchemaVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSchemaVersion(record: Record<string, unknown>): void {
  if (record.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new UnknownSchemaVersionError(record.schemaVersion);
  }
}

/**
 * Validates a stored session record and returns it as a `Session`.
 * v1 is the current version, so this is the identity for well-formed records.
 */
export function migrateSession(record: unknown): Session {
  if (!isRecord(record)) {
    throw new TypeError('Not a session record');
  }
  assertSchemaVersion(record);
  const { id, kind, name, origin, createdAt, updatedAt, windows } = record;
  if (
    typeof id !== 'string' ||
    (kind !== 'saved' && kind !== 'history') ||
    typeof name !== 'string' ||
    typeof origin !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    !Array.isArray(windows)
  ) {
    throw new TypeError('Not a session record');
  }
  // Fields were checked above; the remaining nested shapes are trusted (written by sessionRepo).
  return record as unknown as Session;
}

/** Validates a stored index; `undefined`/`null` (fresh install) yields an empty index. */
export function migrateIndex(record: unknown): SessionIndex {
  if (record === undefined || record === null) {
    return { schemaVersion: SESSION_SCHEMA_VERSION, sessions: [] };
  }
  if (!isRecord(record)) {
    throw new TypeError('Not a session index');
  }
  assertSchemaVersion(record);
  if (!Array.isArray(record.sessions)) {
    throw new TypeError('Not a session index');
  }
  const sessions: SessionSummary[] = record.sessions.filter(
    (entry): entry is SessionSummary =>
      isRecord(entry) && typeof entry.id === 'string' && typeof entry.updatedAt === 'number',
  );
  return { schemaVersion: SESSION_SCHEMA_VERSION, sessions };
}
```

`migrateSession` validates the top-level fields it would otherwise crash on (the dashboard renders `name`, `updatedAt`, `windows.length`) and trusts the nested snapshot shapes, which are only ever written by `sessionRepo.put()`; the import path (Phase 5, `guards.ts`) validates nested shapes fully before they reach storage. The single `as unknown as Session` there is the price of not duplicating the full guard in Phase 0 — replace it with `isSession()` from `guards.ts` in Phase 5.

- [ ] **Step 4: Write `src/sessions/hash.ts`**

```ts
import type { WindowSnapshot } from '@/types';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit over a string's UTF-16 code units, as 8 zero-padded hex chars. */
export function fnv1a32(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Stable fingerprint of a session's tab layout. Titles are deliberately excluded so
 * that a page changing its <title> does not produce a new history snapshot.
 */
export function contentHash(windows: WindowSnapshot[]): string {
  const material = windows
    .map((window) =>
      window.tabs
        .map((tab) =>
          [
            tab.url,
            tab.pinned ? 1 : 0,
            tab.groupIndex ?? -1,
            tab.groupIndex !== undefined ? (window.groups[tab.groupIndex]?.title ?? '') : '',
          ].join(''),
        )
        .join(''),
    )
    .join('');
  return fnv1a32(material);
}
```

The material string is exactly the contract's expression (`url`, `pinned ? 1 : 0`, `groupIndex ?? -1`, group title or `''`, all joined with no separator) so hashes stay comparable with any other implementation of the contract. `Math.imul(...) >>> 0` keeps the multiply in unsigned 32-bit space.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions && pnpm typecheck && pnpm exec biome check src/sessions`
Expected: `Tests  18 passed (18)` across `naming`, `migrate`, `hash`; `tsc` exits 0; biome clean. Then the whole suite: `pnpm test` → `Test Files  6 passed (6)`, `Tests  99 passed (99)`, and `pnpm build` still lists `dist/dashboard.html`.

- [ ] **Step 6: Commit and push the Phase 0 branch state**

```bash
git add src/sessions/migrate.ts src/sessions/migrate.test.ts src/sessions/hash.ts src/sessions/hash.test.ts
git commit -m "feat(sessions): add schema migration and FNV-1a content hash"
LEFTHOOK_EXCLUDE=update-docs git push -u origin feat/sessions
```

Phase 0 acceptance (spec §12): `pnpm build` emits `dist/dashboard.html`; `pnpm test` runs the new tests locally and in CI (`ci.yml` already runs `pnpm test` on `main`); typecheck/biome green; manifest unchanged (verify `git diff main -- vite.config.ts` shows only the `rollupOptions.input` hunk from Task 1 plus the `vitest/config` import and `test` hunks from Task 2).

## Phase 1 — Save, list, restore

## Phase 1 core: capture, storage, restore planning (Tasks 5–7)

Context for the engineer: these three tasks are pure/data-layer work. Nothing here touches React or the service worker. Each task depends only on Phase 0 output (`src/types.ts` session types from T3, `src/sessions/migrate.ts` from T4, `src/test/chrome-fake.ts` + `src/test/setup.ts` from T2) and on the existing `src/background/sort.ts` helpers `isSuspended` / `tabToUrl`, which are NOT edited.

Shared conventions for every file below:

- Biome style: single quotes, semicolons, trailing commas, 2-space indent, 100-column lines, braces on every `if`/`for` body.
- Strict TypeScript, no `any`, no `!` non-null assertions. In `@types/chrome` 0.2.5 `chrome.tabs.Tab.id` and `chrome.windows.Window.id/state/type/left/top/width/height` are optional (always narrow before use); `Tab.windowId`/`groupId` are required (`-1` = no group).
- Tests live next to the module as `*.test.ts`, use `import { describe, expect, it } from 'vitest'` (plus `vi` where a spy or fake clock is needed), and get the chrome fake through `getChromeFake()` from `@/test/chrome-fake` (installed on `globalThis.chrome` by `src/test/setup.ts` before every test).
- Commit after each green run with `feat(sessions): …` / `test(sessions): …`. No `Co-Authored-By` lines.

---

### Task 5: `captureWindows` (pure capture of the live tab strip)

**Files:**

- Create: `src/sessions/capture.ts`
- Test: `src/sessions/capture.test.ts`

**Interfaces:**

- Consumes: `isSuspended(tab: chrome.tabs.Tab, suspendedPrefix: string): boolean` and `tabToUrl(tab: chrome.tabs.Tab, groupSuspendedTabs: boolean, suspendedPrefixLen: number): URL` from `@/background/sort`; `GroupSnapshot`, `TabSnapshot`, `WindowSnapshot` from `@/types` (T3).
- Produces: `export interface CaptureOptions { ownUrlPrefix: string; suspendedPrefix: string; suspendedPrefixLen: number }` and `export function captureWindows(windows: chrome.windows.Window[], groups: chrome.tabGroups.TabGroup[], options: CaptureOptions): WindowSnapshot[]`. T9 adds `captureSession(scope, name?)` to this same file (the chrome wrapper) and uses `captureWindows` with `ownUrlPrefix: chrome.runtime.getURL('')`.

Capture rules being implemented (spec §5, §3):

1. Incognito windows are skipped entirely. Windows whose `type` is defined and not `'normal'` are skipped (belt and braces; the chrome call in T9 already filters with `windowTypes: ['normal']`).
2. Tabs are read in `index` order. A tab's URL is `pendingUrl ?? url`; a tab with neither is dropped.
3. A tab whose URL starts with `options.ownUrlPrefix` (our own extension pages: dashboard, options) is dropped. A window left with zero tabs yields no `WindowSnapshot`.
4. Suspended tabs (`options.suspendedPrefix !== ''` and `isSuspended(tab, prefix)`) are unwrapped with `tabToUrl(tab, false, suspendedPrefixLen).href`. An empty `suspendedPrefix` must never match (`'x'.startsWith('')` is `true`), hence the explicit guard.
5. `groups[]` is built per window in first-appearance order over the surviving tabs. `groupIndex` is the index into that array. Pinned tabs never get a `groupIndex` (Chrome cannot group pinned tabs) and do not contribute to group ordering. `tab.groupId` is a required `number` in `@types/chrome` 0.2.5 (`-1` = no group; only `Tab.id` is optional); a `groupId` that is `-1` or not in the `groups` argument means ungrouped (the `!== undefined` narrowing in the code is redundant but harmless).
6. At most one tab per window is `active`; the first `active` tab wins.
7. `state` is `window.state ?? 'normal'`; `'locked-fullscreen'` maps to `'fullscreen'`. `bounds` is present only when `state === 'normal'` and all four of `left/top/width/height` are numbers.
8. No Chrome runtime ids are copied into the snapshot.

- [ ] **Step 1: Write the failing test**

`src/sessions/capture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type CaptureOptions, captureWindows } from './capture';

const SUSPENDED_PREFIX = 'chrome-extension://suspenderid/suspended.html#';

const OPTIONS: CaptureOptions = {
  ownUrlPrefix: 'chrome-extension://fakeextid/',
  suspendedPrefix: SUSPENDED_PREFIX,
  suspendedPrefixLen: SUSPENDED_PREFIX.length,
};

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    lastAccessed: 0,
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  };
}

function makeWindow(overrides: Partial<chrome.windows.Window> = {}): chrome.windows.Window {
  return {
    id: 1,
    focused: false,
    alwaysOnTop: false,
    incognito: false,
    type: 'normal',
    state: 'normal',
    left: 10,
    top: 20,
    width: 1200,
    height: 800,
    tabs: [],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<chrome.tabGroups.TabGroup> = {}): chrome.tabGroups.TabGroup {
  return {
    id: 100,
    windowId: 1,
    collapsed: false,
    shared: false,
    color: 'blue',
    title: 'Group',
    ...overrides,
  };
}

function tabsInOrder(...tabs: Partial<chrome.tabs.Tab>[]): chrome.tabs.Tab[] {
  return tabs.map((overrides, index) => makeTab({ id: index + 1, index, ...overrides }));
}

describe('captureWindows', () => {
  it('captures tabs in strip order with url, title, pinned and active', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', title: 'A', pinned: true },
        { url: 'https://b.com/', title: 'B', active: true },
        { url: 'https://c.com/', title: 'C' },
      ),
    });

    const result = captureWindows([win], [], OPTIONS);

    expect(result).toHaveLength(1);
    expect(result[0].tabs).toEqual([
      { url: 'https://a.com/', title: 'A', pinned: true, active: false },
      { url: 'https://b.com/', title: 'B', pinned: false, active: true },
      { url: 'https://c.com/', title: 'C', pinned: false, active: false },
    ]);
    expect(result[0].groups).toEqual([]);
  });

  it('sorts tabs by index even when the input array is out of order', () => {
    const win = makeWindow({
      tabs: [
        makeTab({ id: 2, index: 1, url: 'https://second.com/' }),
        makeTab({ id: 1, index: 0, url: 'https://first.com/' }),
      ],
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://first.com/', 'https://second.com/']);
  });

  it('prefers pendingUrl over url', () => {
    const win = makeWindow({
      tabs: tabsInOrder({ url: 'https://old.com/', pendingUrl: 'https://new.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('https://new.com/');
  });

  it('uses an empty title when the tab has none', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', title: undefined }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].title).toBe('');
  });

  it('skips incognito windows', () => {
    const win = makeWindow({ incognito: true, tabs: tabsInOrder({ url: 'https://a.com/' }) });

    expect(captureWindows([win], [], OPTIONS)).toEqual([]);
  });

  it('skips non-normal window types (popup, app, devtools)', () => {
    const popup = makeWindow({ type: 'popup', tabs: tabsInOrder({ url: 'https://a.com/' }) });
    const devtools = makeWindow({ type: 'devtools', tabs: tabsInOrder({ url: 'https://a.com/' }) });

    expect(captureWindows([popup, devtools], [], OPTIONS)).toEqual([]);
  });

  it('drops our own extension pages', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'chrome-extension://fakeextid/dashboard.html' },
        { url: 'https://a.com/' },
        { url: 'chrome-extension://fakeextid/options.html' },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://a.com/']);
  });

  it('keeps other extensions pages', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'chrome-extension://otherid/page.html' }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('chrome-extension://otherid/page.html');
  });

  it('does not treat every url as an own page when ownUrlPrefix is empty', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/' }) });

    const result = captureWindows([win], [], { ...OPTIONS, ownUrlPrefix: '' });

    expect(result[0].tabs).toHaveLength(1);
  });

  it('drops windows that become empty after filtering', () => {
    const onlyDashboard = makeWindow({
      id: 1,
      tabs: tabsInOrder({ url: 'chrome-extension://fakeextid/dashboard.html' }),
    });
    const noTabs = makeWindow({ id: 2, tabs: [] });
    const populated = makeWindow({ id: 3, tabs: undefined });

    expect(captureWindows([onlyDashboard, noTabs, populated], [], OPTIONS)).toEqual([]);
  });

  it('drops tabs that have neither url nor pendingUrl', () => {
    const win = makeWindow({
      tabs: tabsInOrder({ url: undefined, pendingUrl: undefined }, { url: 'https://a.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.url)).toEqual(['https://a.com/']);
  });

  it('unwraps suspended tabs to the real url', () => {
    const win = makeWindow({
      tabs: tabsInOrder({
        url: `${SUSPENDED_PREFIX}ttl=Docs&uri=https://docs.example.com/page?x=1`,
        title: 'Docs',
      }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe('https://docs.example.com/page?x=1');
  });

  it('keeps the wrapper url when a suspended tab has no uri parameter', () => {
    const url = `${SUSPENDED_PREFIX}ttl=Docs`;
    const win = makeWindow({ tabs: tabsInOrder({ url }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs[0].url).toBe(url);
  });

  it('never treats tabs as suspended when suspendedPrefix is empty', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/?uri=https://evil.com/' }) });

    const result = captureWindows([win], [], {
      ...OPTIONS,
      suspendedPrefix: '',
      suspendedPrefixLen: 0,
    });

    expect(result[0].tabs[0].url).toBe('https://a.com/?uri=https://evil.com/');
  });

  it('builds groups in first-appearance order and references them by index', () => {
    const groups = [
      makeGroup({ id: 200, title: 'Second', color: 'red', collapsed: true }),
      makeGroup({ id: 100, title: 'First', color: 'green', collapsed: false }),
    ];
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', groupId: 100 },
        { url: 'https://b.com/', groupId: 100 },
        { url: 'https://c.com/' },
        { url: 'https://d.com/', groupId: 200 },
      ),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.groups).toEqual([
      { title: 'First', color: 'green', collapsed: false },
      { title: 'Second', color: 'red', collapsed: true },
    ]);
    expect(snapshot.tabs.map((t) => t.groupIndex)).toEqual([0, 0, undefined, 1]);
  });

  it('uses an empty title for untitled groups', () => {
    const groups = [makeGroup({ id: 100, title: undefined })];
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.groups[0].title).toBe('');
  });

  it('treats a groupId that is not in the groups list as ungrouped', () => {
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 999 }) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.groups).toEqual([]);
    expect(snapshot.tabs[0].groupIndex).toBeUndefined();
  });

  it('strips groupIndex from pinned tabs and does not create a group for them', () => {
    const groups = [makeGroup({ id: 100, title: 'G' })];
    const win = makeWindow({
      tabs: tabsInOrder({ url: 'https://a.com/', pinned: true, groupId: 100 }),
    });

    const [snapshot] = captureWindows([win], groups, OPTIONS);

    expect(snapshot.tabs[0]).toEqual({
      url: 'https://a.com/',
      title: 'Example',
      pinned: true,
      active: false,
    });
    expect(snapshot.groups).toEqual([]);
  });

  it('keeps groups scoped per window', () => {
    const groups = [makeGroup({ id: 100, windowId: 1 }), makeGroup({ id: 200, windowId: 2 })];
    const win1 = makeWindow({ id: 1, tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });
    const win2 = makeWindow({
      id: 2,
      tabs: tabsInOrder({ url: 'https://b.com/', groupId: 200, windowId: 2 }),
    });

    const result = captureWindows([win1, win2], groups, OPTIONS);

    expect(result[0].groups).toHaveLength(1);
    expect(result[1].groups).toHaveLength(1);
    expect(result[1].tabs[0].groupIndex).toBe(0);
  });

  it('keeps at most one active tab per window', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'https://a.com/', active: true },
        { url: 'https://b.com/', active: true },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.map((t) => t.active)).toEqual([true, false]);
  });

  it('yields no active tab when the active tab was an own page', () => {
    const win = makeWindow({
      tabs: tabsInOrder(
        { url: 'chrome-extension://fakeextid/dashboard.html', active: true },
        { url: 'https://a.com/' },
      ),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.tabs.some((t) => t.active)).toBe(false);
  });

  it('records state, focused and bounds for a normal window', () => {
    const win = makeWindow({
      focused: true,
      state: 'normal',
      left: 5,
      top: 6,
      width: 700,
      height: 500,
      tabs: tabsInOrder({ url: 'https://a.com/' }),
    });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.state).toBe('normal');
    expect(snapshot.focused).toBe(true);
    expect(snapshot.bounds).toEqual({ left: 5, top: 6, width: 700, height: 500 });
  });

  it('omits bounds unless the window state is normal', () => {
    const states: chrome.windows.Window['state'][] = ['maximized', 'minimized', 'fullscreen'];

    for (const state of states) {
      const win = makeWindow({ state, tabs: tabsInOrder({ url: 'https://a.com/' }) });
      const [snapshot] = captureWindows([win], [], OPTIONS);
      expect(snapshot.state).toBe(state);
      expect(snapshot.bounds).toBeUndefined();
    }
  });

  it('omits bounds when any coordinate is missing', () => {
    const win = makeWindow({ state: 'normal', width: undefined, tabs: tabsInOrder({}) });

    const [snapshot] = captureWindows([win], [], OPTIONS);

    expect(snapshot.bounds).toBeUndefined();
  });

  it('maps locked-fullscreen to fullscreen and an undefined state to normal', () => {
    const locked = makeWindow({ id: 1, state: 'locked-fullscreen', tabs: tabsInOrder({}) });
    const unknown = makeWindow({ id: 2, state: undefined, tabs: tabsInOrder({}) });

    const result = captureWindows([locked, unknown], [], OPTIONS);

    expect(result[0].state).toBe('fullscreen');
    expect(result[1].state).toBe('normal');
    expect(result[1].bounds).toEqual({ left: 10, top: 20, width: 1200, height: 800 });
  });

  it('never copies chrome runtime ids into the snapshot', () => {
    const groups = [makeGroup({ id: 100 })];
    const win = makeWindow({ tabs: tabsInOrder({ url: 'https://a.com/', groupId: 100 }) });

    const json = JSON.stringify(captureWindows([win], groups, OPTIONS));

    expect(json).not.toContain('"id"');
    expect(json).not.toContain('windowId');
    expect(json).not.toContain('groupId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sessions/capture.test.ts`
Expected: FAIL with `Failed to resolve import "./capture"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

`src/sessions/capture.ts`:

```ts
import { isSuspended, tabToUrl } from '@/background/sort';
import type { GroupSnapshot, TabSnapshot, WindowSnapshot } from '@/types';

export interface CaptureOptions {
  /** `chrome.runtime.getURL('')` — tabs whose url starts with this are our own pages. */
  ownUrlPrefix: string;
  /** Suspender wrapper prefix (`chrome-extension://<id>/suspended.html#`), or '' when none. */
  suspendedPrefix: string;
  suspendedPrefixLen: number;
}

function toWindowState(state: chrome.windows.Window['state']): WindowSnapshot['state'] {
  switch (state) {
    case 'minimized':
    case 'maximized':
    case 'fullscreen': {
      return state;
    }
    case 'locked-fullscreen': {
      return 'fullscreen';
    }
    default: {
      return 'normal';
    }
  }
}

function resolveTabUrl(tab: chrome.tabs.Tab, options: CaptureOptions): string | undefined {
  if (options.suspendedPrefix !== '' && isSuspended(tab, options.suspendedPrefix)) {
    try {
      return tabToUrl(tab, false, options.suspendedPrefixLen).href;
    } catch {
      return undefined;
    }
  }
  const raw = tab.pendingUrl ?? tab.url;
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return raw;
}

function isOwnPage(url: string, options: CaptureOptions): boolean {
  return options.ownUrlPrefix !== '' && url.startsWith(options.ownUrlPrefix);
}

function captureWindow(
  win: chrome.windows.Window,
  groupById: Map<number, chrome.tabGroups.TabGroup>,
  options: CaptureOptions,
): WindowSnapshot | undefined {
  if (win.incognito) {
    return undefined;
  }
  if (win.type !== undefined && win.type !== 'normal') {
    return undefined;
  }

  const sourceTabs = [...(win.tabs ?? [])].sort((a, b) => a.index - b.index);
  const groups: GroupSnapshot[] = [];
  const groupIndexById = new Map<number, number>();
  const tabs: TabSnapshot[] = [];
  let activeSeen = false;

  for (const tab of sourceTabs) {
    const url = resolveTabUrl(tab, options);
    if (url === undefined || isOwnPage(url, options)) {
      continue;
    }

    const active = tab.active && !activeSeen;
    if (active) {
      activeSeen = true;
    }
    const snapshot: TabSnapshot = { url, title: tab.title ?? '', pinned: tab.pinned, active };

    if (!tab.pinned && tab.groupId !== undefined && tab.groupId !== -1) {
      const group = groupById.get(tab.groupId);
      if (group !== undefined) {
        let groupIndex = groupIndexById.get(group.id);
        if (groupIndex === undefined) {
          groupIndex = groups.length;
          groupIndexById.set(group.id, groupIndex);
          groups.push({ title: group.title ?? '', color: group.color, collapsed: group.collapsed });
        }
        snapshot.groupIndex = groupIndex;
      }
    }

    tabs.push(snapshot);
  }

  if (tabs.length === 0) {
    return undefined;
  }

  const state = toWindowState(win.state);
  const snapshot: WindowSnapshot = { state, focused: win.focused, groups, tabs };
  if (
    state === 'normal' &&
    typeof win.left === 'number' &&
    typeof win.top === 'number' &&
    typeof win.width === 'number' &&
    typeof win.height === 'number'
  ) {
    snapshot.bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  }
  return snapshot;
}

/**
 * Pure snapshot of populated windows (`windows.getAll({ populate: true })`).
 * Never copies Chrome runtime ids; groups are referenced by first-appearance index.
 */
export function captureWindows(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[],
  options: CaptureOptions,
): WindowSnapshot[] {
  const groupById = new Map<number, chrome.tabGroups.TabGroup>();
  for (const group of groups) {
    groupById.set(group.id, group);
  }

  const result: WindowSnapshot[] = [];
  for (const win of windows) {
    const snapshot = captureWindow(win, groupById, options);
    if (snapshot !== undefined) {
      result.push(snapshot);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions/capture.test.ts && pnpm typecheck && pnpm exec biome check --write src/sessions src/background`
Expected: PASS (26 tests), typecheck clean. Expected: no remaining diagnostics (formatter may rewrap lines).

- [ ] **Step 5: Commit**

```bash
git add src/sessions/capture.ts src/sessions/capture.test.ts
git commit -m "feat(sessions): add pure captureWindows snapshot builder"
```

---

### Task 6: `sessionRepo` (single write path under the Web Lock)

**Files:**

- Create: `src/sessions/storage.ts`
- Test: `src/sessions/storage.test.ts`

**Interfaces:**

- Consumes: `migrateSession(record: unknown): Session`, `migrateIndex(record: unknown): SessionIndex` from `./migrate` (T4); `Session`, `SessionId`, `SessionIndex`, `SessionSettings`, `SessionSummary`, `SESSION_SCHEMA_VERSION`, `DEFAULT_SESSION_SETTINGS` from `@/types` (T3); `getChromeFake()` from `@/test/chrome-fake` (T2) in tests only.
- Produces (all exported, names exact):
  - `INDEX_KEY = 'sessionIndex'`, `SETTINGS_KEY = 'sessionSettings'`, `HISTORY_META_KEY = 'historyMeta'`, `LOCK_NAME = 'tab-organizer:sessions'`, `sessionKey(id: SessionId): string`
  - `withLock<T>(fn: () => Promise<T>): Promise<T>`
  - `toSummary(session: Session, bytes: number): SessionSummary`
  - `sessionRepo` with `listSummaries()`, `get(id)`, `put(session)`, `rename(id, name)`, `remove(id)`, `removeAll()`, `reconcile()`, `getSettings()`, `setSettings(patch)` — signatures exactly as in the contract.

Behaviour being implemented (spec §4):

- Every write runs inside `withLock`. `withLock` uses `navigator.locks.request(LOCK_NAME, fn)`; when `navigator.locks` is undefined it falls back to a module-level promise chain (same serialization inside one page, no cross-context guarantee).
- Write order is always body first, then index. Delete order is body first, then index.
- The index is kept newest-first by `updatedAt`. `put` stamps `updatedAt = Date.now()` (so a re-saved session moves to the top). `rename` changes only `name` and keeps `updatedAt` so the list order does not jump on rename.
- `get` returns `undefined` for a missing key and lets `migrateSession` errors (`TypeError`, `UnknownSchemaVersionError`) propagate.
- `reconcile` lists keys via `chrome.storage.local.getKeys()` when it is a function, otherwise `get(null)` + `Object.keys`. Orphan bodies (no index entry) are loaded one at a time and re-indexed; index entries with no body are dropped; bodies that fail `migrateSession` are left alone (not indexed, not deleted). The index is written only when something changed.
- `removeAll` removes every `session:*` key, then `sessionIndex` and `historyMeta`. Settings are kept.
- Storage errors (quota etc.) propagate to the caller; the UI (T11/T13) shows them.
- Settings live in `chrome.storage.local` under `sessionSettings`; `getSettings` fills missing/invalid fields from `DEFAULT_SESSION_SETTINGS` field by field (no casts).

- [ ] **Step 1: Write the failing test**

`src/sessions/storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeFake } from '@/test/chrome-fake';
import {
  DEFAULT_SESSION_SETTINGS,
  type Session,
  type SessionIndex,
  SESSION_SCHEMA_VERSION,
  type WindowSnapshot,
} from '@/types';
import {
  HISTORY_META_KEY,
  INDEX_KEY,
  SETTINGS_KEY,
  sessionKey,
  sessionRepo,
  toSummary,
  withLock,
} from './storage';

function makeWindow(urls: string[]): WindowSnapshot {
  return {
    state: 'normal',
    focused: false,
    groups: [],
    tabs: urls.map((url, index) => ({ url, title: url, pinned: false, active: index === 0 })),
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: 'id-a',
    kind: 'saved',
    name: 'Session A',
    origin: 'manual',
    createdAt: 1_000,
    updatedAt: 1_000,
    windows: [makeWindow(['https://a.com/', 'https://b.com/'])],
    ...overrides,
  };
}

async function readIndex(): Promise<SessionIndex | undefined> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(INDEX_KEY);
  const value = raw[INDEX_KEY];
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return value as SessionIndex;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: 5_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionKey', () => {
  it('prefixes the id', () => {
    expect(sessionKey('abc')).toBe('session:abc');
  });
});

describe('toSummary', () => {
  it('copies metadata and computes counts', () => {
    const session = makeSession({
      windows: [makeWindow(['https://a.com/']), makeWindow(['https://b.com/', 'https://c.com/'])],
      contentHash: 'deadbeef',
      protected: true,
    });

    expect(toSummary(session, 321)).toEqual({
      id: 'id-a',
      kind: 'saved',
      name: 'Session A',
      origin: 'manual',
      createdAt: 1_000,
      updatedAt: 1_000,
      protected: true,
      contentHash: 'deadbeef',
      windowCount: 2,
      tabCount: 3,
      bytes: 321,
    });
  });

  it('omits protected and contentHash when absent', () => {
    const summary = toSummary(makeSession(), 1);

    expect('protected' in summary).toBe(false);
    expect('contentHash' in summary).toBe(false);
  });
});

describe('withLock', () => {
  it('runs the callback and returns its value', async () => {
    await expect(withLock(async () => 42)).resolves.toBe(42);
  });

  it('propagates rejections', async () => {
    await expect(
      withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('serializes concurrent callbacks', async () => {
    const order: string[] = [];
    const first = withLock(async () => {
      order.push('first:start');
      await Promise.resolve();
      await Promise.resolve();
      order.push('first:end');
    });
    const second = withLock(async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps working after a rejected callback', async () => {
    await withLock(async () => {
      throw new Error('first fails');
    }).catch(() => undefined);

    await expect(withLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('sessionRepo.put / get / listSummaries', () => {
  it('writes the body under session:<id> and a summary in the index', async () => {
    const fake = getChromeFake();

    await sessionRepo.put(makeSession());

    const body = fake.state.local.get(sessionKey('id-a'));
    expect(body).toMatchObject({ id: 'id-a', name: 'Session A', updatedAt: 5_000 });
    const index = await readIndex();
    expect(index?.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(index?.sessions).toHaveLength(1);
    expect(index?.sessions[0]).toMatchObject({
      id: 'id-a',
      windowCount: 1,
      tabCount: 2,
      updatedAt: 5_000,
    });
    expect(index?.sessions[0].bytes).toBe(JSON.stringify(body).length);
  });

  it('writes the body before the index', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.put(makeSession());

    const writtenKeys = setSpy.mock.calls.map((call) => Object.keys(call[0]));
    expect(writtenKeys).toEqual([[sessionKey('id-a')], [INDEX_KEY]]);
  });

  it('returns the stored session from get and undefined for unknown ids', async () => {
    await sessionRepo.put(makeSession());

    const stored = await sessionRepo.get('id-a');
    expect(stored?.windows[0].tabs.map((t) => t.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
    ]);
    await expect(sessionRepo.get('nope')).resolves.toBeUndefined();
  });

  it('lists summaries newest-first by updatedAt', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    vi.setSystemTime(7_000);
    await sessionRepo.put(makeSession({ id: 'id-c', name: 'C' }));

    const names = (await sessionRepo.listSummaries()).map((s) => s.name);

    expect(names).toEqual(['C', 'B', 'A']);
  });

  it('re-saving an existing id replaces its summary and moves it to the top', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));
    vi.setSystemTime(7_000);
    await sessionRepo.put(
      makeSession({ id: 'id-a', name: 'A2', windows: [makeWindow(['https://x.com/'])] }),
    );

    const summaries = await sessionRepo.listSummaries();

    expect(summaries.map((s) => s.name)).toEqual(['A2', 'B']);
    expect(summaries[0].tabCount).toBe(1);
  });

  it('returns an empty list when nothing is stored', async () => {
    await expect(sessionRepo.listSummaries()).resolves.toEqual([]);
  });

  it('propagates storage errors from put', async () => {
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));

    await expect(sessionRepo.put(makeSession())).rejects.toThrow('QUOTA_BYTES exceeded');
    expect(await readIndex()).toBeUndefined();
  });

  it('does not lose an index entry when two puts run concurrently', async () => {
    await Promise.all([
      sessionRepo.put(makeSession({ id: 'id-a' })),
      sessionRepo.put(makeSession({ id: 'id-b' })),
    ]);

    const ids = (await sessionRepo.listSummaries()).map((s) => s.id).sort();
    expect(ids).toEqual(['id-a', 'id-b']);
  });
});

describe('sessionRepo.rename', () => {
  it('updates the name in the body and the index without changing order', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));
    vi.setSystemTime(6_000);
    await sessionRepo.put(makeSession({ id: 'id-b', name: 'B' }));

    await sessionRepo.rename('id-a', 'Renamed');

    const body = await sessionRepo.get('id-a');
    expect(body?.name).toBe('Renamed');
    expect(body?.updatedAt).toBe(5_000);
    const summaries = await sessionRepo.listSummaries();
    expect(summaries.map((s) => s.name)).toEqual(['B', 'Renamed']);
  });

  it('rejects for an unknown id', async () => {
    await expect(sessionRepo.rename('missing', 'x')).rejects.toThrow('Session not found: missing');
  });
});

describe('sessionRepo.remove / removeAll', () => {
  it('removes the body then the index entry', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.remove('id-a');

    expect(fake.state.local.has(sessionKey('id-a'))).toBe(false);
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-b']);
    expect(removeSpy.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]);
  });

  it('removing an unknown id leaves the index untouched', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));

    await sessionRepo.remove('ghost');

    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-a']);
  });

  it('removeAll deletes every session body, the index and history meta but keeps settings', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    await sessionRepo.setSettings({ restoreLazy: 'never' });
    fake.state.local.set(HISTORY_META_KEY, { lastHash: 'x', lastSnapshotAt: 1 });
    fake.state.local.set('installedVersion', '7.0.0');

    await sessionRepo.removeAll();

    expect([...fake.state.local.keys()].sort()).toEqual([SETTINGS_KEY, 'installedVersion']);
  });
});

describe('sessionRepo.reconcile', () => {
  it('re-indexes orphan bodies (interrupted write: body saved, index not)', async () => {
    const fake = getChromeFake();
    const orphan = makeSession({ id: 'orphan', name: 'Orphan', updatedAt: 9_000 });
    fake.state.local.set(sessionKey('orphan'), orphan);
    await sessionRepo.put(makeSession({ id: 'id-a', name: 'A' }));

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
    const summaries = await sessionRepo.listSummaries();
    expect(summaries.map((s) => s.id)).toEqual(['orphan', 'id-a']);
    expect(summaries[0].bytes).toBe(JSON.stringify(orphan).length);
  });

  it('drops dangling index entries whose body is missing', async () => {
    const fake = getChromeFake();
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    await sessionRepo.put(makeSession({ id: 'id-b' }));
    fake.state.local.delete(sessionKey('id-b'));

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 0, dropped: 1 });
    expect((await sessionRepo.listSummaries()).map((s) => s.id)).toEqual(['id-a']);
  });

  it('leaves bodies that fail migration alone', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('future'), { ...makeSession({ id: 'future' }), schemaVersion: 2 });
    fake.state.local.set(sessionKey('junk'), 'not an object');

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 0, dropped: 0 });
    expect(fake.state.local.has(sessionKey('future'))).toBe(true);
    expect(fake.state.local.has(sessionKey('junk'))).toBe(true);
    await expect(sessionRepo.listSummaries()).resolves.toEqual([]);
  });

  it('does not write the index when nothing changed', async () => {
    await sessionRepo.put(makeSession({ id: 'id-a' }));
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    await sessionRepo.reconcile();

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('falls back to get(null) when getKeys is unavailable', async () => {
    const fake = getChromeFake();
    fake.state.local.set(sessionKey('orphan'), makeSession({ id: 'orphan' }));
    const area: { getKeys?: unknown } = chrome.storage.local;
    area.getKeys = undefined;

    const result = await sessionRepo.reconcile();

    expect(result).toEqual({ reindexed: 1, dropped: 0 });
  });
});

describe('sessionRepo settings', () => {
  it('returns defaults when nothing is stored', async () => {
    await expect(sessionRepo.getSettings()).resolves.toEqual(DEFAULT_SESSION_SETTINGS);
  });

  it('merges a patch and persists it under sessionSettings', async () => {
    const fake = getChromeFake();

    await sessionRepo.setSettings({ historyEnabled: false, restoreLazy: 'always' });

    expect(fake.state.local.get(SETTINGS_KEY)).toEqual({
      ...DEFAULT_SESSION_SETTINGS,
      historyEnabled: false,
      restoreLazy: 'always',
    });
    await expect(sessionRepo.getSettings()).resolves.toMatchObject({ historyEnabled: false });
  });

  it('replaces invalid stored values with defaults field by field', async () => {
    const fake = getChromeFake();
    fake.state.local.set(SETTINGS_KEY, {
      historyEnabled: 'yes',
      historyIntervalMinutes: 7,
      historyMaxSnapshots: -3,
      restoreLazy: 'sometimes',
    });

    await expect(sessionRepo.getSettings()).resolves.toEqual(DEFAULT_SESSION_SETTINGS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sessions/storage.test.ts`
Expected: FAIL with `Failed to resolve import "./storage"`.

- [ ] **Step 3: Write minimal implementation**

`src/sessions/storage.ts`:

```ts
import {
  DEFAULT_SESSION_SETTINGS,
  SESSION_SCHEMA_VERSION,
  type Session,
  type SessionId,
  type SessionIndex,
  type SessionSettings,
  type SessionSummary,
} from '@/types';
import { migrateIndex, migrateSession } from './migrate';

export const INDEX_KEY = 'sessionIndex';
export const SETTINGS_KEY = 'sessionSettings';
export const HISTORY_META_KEY = 'historyMeta';
export const LOCK_NAME = 'tab-organizer:sessions';

const SESSION_KEY_PREFIX = 'session:';

export function sessionKey(id: SessionId): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function idFromKey(key: string): string | undefined {
  return key.startsWith(SESSION_KEY_PREFIX) ? key.slice(SESSION_KEY_PREFIX.length) : undefined;
}

// Fallback serialization for runtimes without Web Locks (page-local only).
let fallbackChain: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) {
    const run = fallbackChain.then(fn, fn);
    fallbackChain = run.catch(() => undefined);
    return run;
  }
  return new Promise<T>((resolve, reject) => {
    locks
      .request(LOCK_NAME, async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      })
      .catch(reject);
  });
}

export function toSummary(session: Session, bytes: number): SessionSummary {
  const summary: SessionSummary = {
    id: session.id,
    kind: session.kind,
    name: session.name,
    origin: session.origin,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    windowCount: session.windows.length,
    tabCount: session.windows.reduce((count, win) => count + win.tabs.length, 0),
    bytes,
  };
  if (session.protected !== undefined) {
    summary.protected = session.protected;
  }
  if (session.contentHash !== undefined) {
    summary.contentHash = session.contentHash;
  }
  return summary;
}

function sortNewestFirst(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readIndex(): Promise<SessionIndex> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(INDEX_KEY);
  return migrateIndex(raw[INDEX_KEY]);
}

async function writeIndex(sessions: SessionSummary[]): Promise<void> {
  const index: SessionIndex = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessions: sortNewestFirst(sessions),
  };
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

async function readRawBody(id: SessionId): Promise<unknown> {
  const key = sessionKey(id);
  const raw: Record<string, unknown> = await chrome.storage.local.get(key);
  return raw[key];
}

async function readBody(id: SessionId): Promise<Session | undefined> {
  const record = await readRawBody(id);
  if (record === undefined || record === null) {
    return undefined;
  }
  return migrateSession(record);
}

/** Body first, then index (spec §4). Must be called inside withLock. */
async function writeBodyAndIndex(body: Session): Promise<void> {
  const bytes = JSON.stringify(body).length;
  await chrome.storage.local.set({ [sessionKey(body.id)]: body });
  const index = await readIndex();
  const others = index.sessions.filter((summary) => summary.id !== body.id);
  await writeIndex([...others, toSummary(body, bytes)]);
}

async function listStorageKeys(): Promise<string[]> {
  const area = chrome.storage.local;
  if (typeof area.getKeys === 'function') {
    return area.getKeys();
  }
  const all: Record<string, unknown> = await area.get(null);
  return Object.keys(all);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSettings(value: unknown): SessionSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
  const interval = value.historyIntervalMinutes;
  const max = value.historyMaxSnapshots;
  const lazy = value.restoreLazy;
  return {
    historyEnabled:
      typeof value.historyEnabled === 'boolean'
        ? value.historyEnabled
        : DEFAULT_SESSION_SETTINGS.historyEnabled,
    historyIntervalMinutes:
      interval === 5 || interval === 10 || interval === 30
        ? interval
        : DEFAULT_SESSION_SETTINGS.historyIntervalMinutes,
    historyMaxSnapshots:
      typeof max === 'number' && Number.isInteger(max) && max > 0
        ? max
        : DEFAULT_SESSION_SETTINGS.historyMaxSnapshots,
    restoreLazy:
      lazy === 'auto' || lazy === 'always' || lazy === 'never'
        ? lazy
        : DEFAULT_SESSION_SETTINGS.restoreLazy,
  };
}

async function readSettings(): Promise<SessionSettings> {
  const raw: Record<string, unknown> = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(raw[SETTINGS_KEY]);
}

export const sessionRepo = {
  async listSummaries(): Promise<SessionSummary[]> {
    const index = await readIndex();
    return sortNewestFirst(index.sessions);
  },

  get(id: SessionId): Promise<Session | undefined> {
    return readBody(id);
  },

  put(session: Session): Promise<void> {
    return withLock(async () => {
      const body: Session = { ...session, updatedAt: Date.now() };
      await writeBodyAndIndex(body);
    });
  },

  rename(id: SessionId, name: string): Promise<void> {
    return withLock(async () => {
      const existing = await readBody(id);
      if (existing === undefined) {
        throw new Error(`Session not found: ${id}`);
      }
      await writeBodyAndIndex({ ...existing, name });
    });
  },

  remove(id: SessionId): Promise<void> {
    return withLock(async () => {
      await chrome.storage.local.remove(sessionKey(id));
      const index = await readIndex();
      await writeIndex(index.sessions.filter((summary) => summary.id !== id));
    });
  },

  removeAll(): Promise<void> {
    return withLock(async () => {
      const keys = await listStorageKeys();
      const bodyKeys = keys.filter((key) => idFromKey(key) !== undefined);
      if (bodyKeys.length > 0) {
        await chrome.storage.local.remove(bodyKeys);
      }
      await chrome.storage.local.remove([INDEX_KEY, HISTORY_META_KEY]);
    });
  },

  reconcile(): Promise<{ reindexed: number; dropped: number }> {
    return withLock(async () => {
      const keys = await listStorageKeys();
      const bodyIds = new Set<string>();
      for (const key of keys) {
        const id = idFromKey(key);
        if (id !== undefined) {
          bodyIds.add(id);
        }
      }

      const index = await readIndex();
      const kept = index.sessions.filter((summary) => bodyIds.has(summary.id));
      const dropped = index.sessions.length - kept.length;
      const indexedIds = new Set(kept.map((summary) => summary.id));

      let reindexed = 0;
      for (const id of bodyIds) {
        if (indexedIds.has(id)) {
          continue;
        }
        const record = await readRawBody(id);
        let session: Session;
        try {
          session = migrateSession(record);
        } catch {
          continue;
        }
        kept.push(toSummary(session, JSON.stringify(record).length));
        reindexed += 1;
      }

      if (reindexed > 0 || dropped > 0) {
        await writeIndex(kept);
      }
      return { reindexed, dropped };
    });
  },

  getSettings(): Promise<SessionSettings> {
    return readSettings();
  },

  setSettings(patch: Partial<SessionSettings>): Promise<void> {
    return withLock(async () => {
      const current = await readSettings();
      const next: SessionSettings = normalizeSettings({ ...current, ...patch });
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    });
  },
};
```

Notes for the implementer:

- `chrome.storage.local.get(...)` is typed to return `{ [key: string]: any }`; every call site assigns it to an explicitly typed `Record<string, unknown>` so `any` never escapes.
- `typeof area.getKeys === 'function'` is the guard from spec §4 (Chrome < 130 lacks `getKeys`). The test forces the fallback by setting `getKeys` to `undefined` on the fake.
- `navigator.locks` is `LockManager` in the DOM lib; the `=== undefined` check is a runtime guard for Chromium forks and for Node before `src/test/setup.ts` installs the shim.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions/storage.test.ts && pnpm typecheck && pnpm exec biome check --write src/sessions src/background`
Expected: PASS (28 tests), typecheck clean. Expected: no remaining diagnostics (formatter may rewrap lines).

If `does not lose an index entry when two puts run concurrently` fails with only one id, the `navigator.locks` shim from T2 is not serializing callbacks; fix the shim (it must queue callbacks per lock name), not this file.

- [ ] **Step 5: Commit**

```bash
git add src/sessions/storage.ts src/sessions/storage.test.ts
git commit -m "feat(sessions): add sessionRepo storage layer under Web Lock"
```

---

### Task 7: `sanitizeRestoreUrl`, `clampToScreen`, `planRestore` (pure restore planning)

**Files:**

- Create: `src/sessions/restore.ts` (T8 appends `executeRestore`, `withRetryOnce`, `isTabsCannotBeEditedError` to this same file; every type T8 needs is declared here)
- Test: `src/sessions/restore.test.ts` (T8 adds a separate `src/sessions/execute-restore.test.ts`; this file stays untouched)

**Interfaces:**

- Consumes: `Session`, `SessionSettings`, `WindowBounds`, `WindowSnapshot` from `@/types` (T3).
- Produces (exported, names exact):
  - `interface SanitizeOptions { ownExtensionId: string; fileAccessAllowed: boolean; suspendedPrefix: string; suspendedPrefixLen: number }`
  - `sanitizeRestoreUrl(url: string, options: SanitizeOptions): string | null`
  - `clampToScreen(bounds: WindowBounds, screen: { availWidth: number; availHeight: number }): WindowBounds | undefined`
  - `type RestoreTarget = { kind: 'newWindows' } | { kind: 'window'; windowId: number }`
  - `interface RestoreOptions { target: RestoreTarget; lazy: SessionSettings['restoreLazy']; chunkSize?: number; sanitize: SanitizeOptions }`
  - `interface PlannedTab { url: string; pinned: boolean; active: boolean; groupIndex?: number }`
  - `interface PlannedWindow { snapshot: WindowSnapshot; tabs: PlannedTab[]; chunks: PlannedTab[][]; lazy: boolean }`
  - `interface RestorePlan { target: RestoreTarget; windows: PlannedWindow[]; skipped: string[]; totalTabs: number }`
  - `planRestore(session: Session, options: RestoreOptions): RestorePlan`
  - `interface RestoreResult { restored: number; skipped: string[]; errors: { url: string; message: string }[] }` and `interface RestoreHooks { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; screen?: { availWidth: number; availHeight: number } }` (declared now, used by T8)
  - `DEFAULT_CHUNK_SIZE = 25`, `LAZY_AUTO_THRESHOLD = 50` (exported constants so the dashboard confirm dialog in T13 can reference them)

Rules being implemented (spec §6):

`sanitizeRestoreUrl`:

1. If `suspendedPrefix !== ''` and the url starts with it, unwrap: parse the remainder after the prefix as `URLSearchParams`, take `uri`; missing `uri` → `null`. (Same parsing as `tabToUrl`, re-implemented on a string because `tabToUrl` needs a whole `chrome.tabs.Tab`; capture already unwraps at save time, this only matters for imported data.)
2. Parse with `new URL()`; unparsable → `null`.
3. Allowed: `http:`, `https:`, `ftp:`, `chrome:`, `about:blank` (exactly), `chrome-extension:` whose host equals `ownExtensionId`, `file:` only when `fileAccessAllowed`.
4. Everything else (`javascript:`, `data:`, `blob:`, `view-source:`, other extensions' pages, `about:newtab`, …) → `null`.
5. The returned string is the unwrapped input unchanged (not `URL.href`, so no normalization surprises).

`clampToScreen`: intersect the rectangle with `[0, availWidth] × [0, availHeight]`; return `undefined` if the intersection is narrower or shorter than 200 px.

`planRestore`:

1. For each window: sanitize every tab url; `null` → push the original url onto `plan.skipped`; a window with no remaining tabs is omitted from `plan.windows` (its urls still appear in `skipped`).
2. Invariants (throw `Error` with the exact messages in the code): a pinned tab must not have a `groupIndex`; at most one tab is `active`; `groupIndex` must be `< snapshot.groups.length`.
3. Pinned tabs are moved first (stable partition) so `tabs.create({ pinned: true })` never has to shuffle.
4. `chunks` splits `tabs` into arrays of `chunkSize` (default 25).
5. `totalTabs` is the number of tabs that will actually be created (after sanitize, across all windows). `lazy` is `lazy === 'always' || (lazy === 'auto' && totalTabs > 50)`, computed once and copied onto every `PlannedWindow`.
6. `active` is copied as captured. `executeRestore` (T8) decides whether to honour it (only for `target.kind === 'newWindows'`).

- [ ] **Step 1: Write the failing test**

`src/sessions/restore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type Session,
  SESSION_SCHEMA_VERSION,
  type TabSnapshot,
  type WindowSnapshot,
} from '@/types';
import {
  DEFAULT_CHUNK_SIZE,
  LAZY_AUTO_THRESHOLD,
  type RestoreOptions,
  type SanitizeOptions,
  clampToScreen,
  planRestore,
  sanitizeRestoreUrl,
} from './restore';

const SUSPENDED_PREFIX = 'chrome-extension://suspenderid/suspended.html#';

const SANITIZE: SanitizeOptions = {
  ownExtensionId: 'fakeextid',
  fileAccessAllowed: false,
  suspendedPrefix: SUSPENDED_PREFIX,
  suspendedPrefixLen: SUSPENDED_PREFIX.length,
};

function tab(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return { url: 'https://example.com/', title: 'Example', pinned: false, active: false, ...overrides };
}

function urls(count: number, prefix = 'https://site.test/'): TabSnapshot[] {
  return Array.from({ length: count }, (_, i) => tab({ url: `${prefix}${i}` }));
}

function win(tabs: TabSnapshot[], overrides: Partial<WindowSnapshot> = {}): WindowSnapshot {
  return { state: 'normal', focused: false, groups: [], tabs, ...overrides };
}

function session(windows: WindowSnapshot[]): Session {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: 'sess',
    kind: 'saved',
    name: 'Test',
    origin: 'manual',
    createdAt: 1,
    updatedAt: 1,
    windows,
  };
}

function options(overrides: Partial<RestoreOptions> = {}): RestoreOptions {
  return { target: { kind: 'newWindows' }, lazy: 'auto', sanitize: SANITIZE, ...overrides };
}

describe('sanitizeRestoreUrl', () => {
  it.each([
    'http://example.com/',
    'https://example.com/path?q=1#h',
    'ftp://files.example.com/pub/',
    'chrome://settings/',
    'chrome://extensions/shortcuts',
    'about:blank',
    'chrome-extension://fakeextid/dashboard.html',
  ])('allows %s', (url) => {
    expect(sanitizeRestoreUrl(url, SANITIZE)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'blob:https://example.com/uuid',
    'view-source:https://example.com/',
    'chrome-extension://otherid/popup.html',
    'about:newtab',
    'about:srcdoc',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(sanitizeRestoreUrl(url, SANITIZE)).toBeNull();
  });

  it('allows file:// only when file access is granted', () => {
    const url = 'file:///Users/me/doc.html';

    expect(sanitizeRestoreUrl(url, SANITIZE)).toBeNull();
    expect(sanitizeRestoreUrl(url, { ...SANITIZE, fileAccessAllowed: true })).toBe(url);
  });

  it('unwraps suspender wrappers before checking the scheme', () => {
    const wrapped = `${SUSPENDED_PREFIX}ttl=Docs&uri=https://docs.example.com/p?x=1`;

    expect(sanitizeRestoreUrl(wrapped, SANITIZE)).toBe('https://docs.example.com/p?x=1');
  });

  it('rejects a wrapper whose inner url is not allowed', () => {
    const wrapped = `${SUSPENDED_PREFIX}uri=javascript:alert(1)`;

    expect(sanitizeRestoreUrl(wrapped, SANITIZE)).toBeNull();
  });

  it('rejects a wrapper without a uri parameter', () => {
    expect(sanitizeRestoreUrl(`${SUSPENDED_PREFIX}ttl=Docs`, SANITIZE)).toBeNull();
  });

  it('does not unwrap when suspendedPrefix is empty', () => {
    const url = 'https://a.com/?uri=https://b.com/';

    expect(sanitizeRestoreUrl(url, { ...SANITIZE, suspendedPrefix: '', suspendedPrefixLen: 0 })).toBe(
      url,
    );
  });

  it('does not alter the url text (no normalization)', () => {
    expect(sanitizeRestoreUrl('https://Example.com', SANITIZE)).toBe('https://Example.com');
  });
});

describe('clampToScreen', () => {
  const screen = { availWidth: 1440, availHeight: 900 };

  it('returns bounds unchanged when fully on screen', () => {
    const bounds = { left: 100, top: 50, width: 800, height: 600 };

    expect(clampToScreen(bounds, screen)).toEqual(bounds);
  });

  it('moves a window with negative origin onto the screen and shrinks it', () => {
    expect(clampToScreen({ left: -200, top: -100, width: 800, height: 600 }, screen)).toEqual({
      left: 0,
      top: 0,
      width: 600,
      height: 500,
    });
  });

  it('shrinks a window that overflows the right/bottom edge', () => {
    expect(clampToScreen({ left: 1000, top: 700, width: 800, height: 600 }, screen)).toEqual({
      left: 1000,
      top: 700,
      width: 440,
      height: 200,
    });
  });

  it('returns undefined when the visible part is smaller than 200x200', () => {
    expect(clampToScreen({ left: 1300, top: 0, width: 800, height: 600 }, screen)).toBeUndefined();
    expect(clampToScreen({ left: 0, top: 750, width: 800, height: 600 }, screen)).toBeUndefined();
    expect(clampToScreen({ left: 2000, top: 0, width: 800, height: 600 }, screen)).toBeUndefined();
  });

  it('returns undefined for a window that is already tiny', () => {
    expect(clampToScreen({ left: 0, top: 0, width: 199, height: 600 }, screen)).toBeUndefined();
  });
});

describe('planRestore', () => {
  it('exposes the chunk size and lazy threshold constants', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(25);
    expect(LAZY_AUTO_THRESHOLD).toBe(50);
  });

  it('copies url, pinned, active and groupIndex into planned tabs', () => {
    const plan = planRestore(
      session([
        win(
          [
            tab({ url: 'https://a.com/', pinned: true }),
            tab({ url: 'https://b.com/', active: true, groupIndex: 0 }),
            tab({ url: 'https://c.com/' }),
          ],
          { groups: [{ title: 'G', color: 'blue', collapsed: false }] },
        ),
      ]),
      options(),
    );

    expect(plan.target).toEqual({ kind: 'newWindows' });
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].tabs).toEqual([
      { url: 'https://a.com/', pinned: true, active: false },
      { url: 'https://b.com/', pinned: false, active: true, groupIndex: 0 },
      { url: 'https://c.com/', pinned: false, active: false },
    ]);
    expect(plan.windows[0].snapshot.groups[0].title).toBe('G');
    expect(plan.totalTabs).toBe(3);
    expect(plan.skipped).toEqual([]);
  });

  it('keeps the window target', () => {
    const plan = planRestore(session([win(urls(1))]), options({ target: { kind: 'window', windowId: 7 } }));

    expect(plan.target).toEqual({ kind: 'window', windowId: 7 });
  });

  it('puts 25 tabs in a single chunk', () => {
    const plan = planRestore(session([win(urls(25))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25]);
  });

  it('splits 26 tabs into chunks of 25 and 1', () => {
    const plan = planRestore(session([win(urls(26))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25, 1]);
    expect(plan.windows[0].chunks.flat()).toEqual(plan.windows[0].tabs);
  });

  it('honours a custom chunkSize', () => {
    const plan = planRestore(session([win(urls(5))]), options({ chunkSize: 2 }));

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('chunks per window, not across windows', () => {
    const plan = planRestore(session([win(urls(30)), win(urls(3))]), options());

    expect(plan.windows[0].chunks.map((c) => c.length)).toEqual([25, 5]);
    expect(plan.windows[1].chunks.map((c) => c.length)).toEqual([3]);
    expect(plan.totalTabs).toBe(33);
  });

  it('moves pinned tabs first, keeping relative order otherwise', () => {
    const plan = planRestore(
      session([
        win([
          tab({ url: 'https://u1.com/' }),
          tab({ url: 'https://p1.com/', pinned: true }),
          tab({ url: 'https://u2.com/' }),
          tab({ url: 'https://p2.com/', pinned: true }),
        ]),
      ]),
      options(),
    );

    expect(plan.windows[0].tabs.map((t) => t.url)).toEqual([
      'https://p1.com/',
      'https://p2.com/',
      'https://u1.com/',
      'https://u2.com/',
    ]);
  });

  it("lazy 'auto' is false at exactly 50 tabs and true at 51", () => {
    expect(planRestore(session([win(urls(50))]), options({ lazy: 'auto' })).windows[0].lazy).toBe(
      false,
    );
    expect(planRestore(session([win(urls(51))]), options({ lazy: 'auto' })).windows[0].lazy).toBe(
      true,
    );
  });

  it("lazy 'auto' counts tabs across all windows", () => {
    const plan = planRestore(session([win(urls(30)), win(urls(21))]), options({ lazy: 'auto' }));

    expect(plan.windows.map((w) => w.lazy)).toEqual([true, true]);
  });

  it("lazy 'auto' counts only tabs that survive sanitize", () => {
    const tabs = [...urls(50), tab({ url: 'javascript:alert(1)' })];

    expect(planRestore(session([win(tabs)]), options({ lazy: 'auto' })).windows[0].lazy).toBe(false);
  });

  it("lazy 'always' is true even for one tab, 'never' is false even for many", () => {
    expect(planRestore(session([win(urls(1))]), options({ lazy: 'always' })).windows[0].lazy).toBe(
      true,
    );
    expect(planRestore(session([win(urls(200))]), options({ lazy: 'never' })).windows[0].lazy).toBe(
      false,
    );
  });

  it('collects skipped urls and keeps the remaining tabs', () => {
    const plan = planRestore(
      session([
        win([
          tab({ url: 'https://ok.com/' }),
          tab({ url: 'javascript:alert(1)' }),
          tab({ url: 'file:///secret.html' }),
          tab({ url: 'chrome-extension://otherid/x.html', groupIndex: 0 }),
        ], { groups: [{ title: 'G', color: 'red', collapsed: true }] }),
      ]),
      options(),
    );

    expect(plan.skipped).toEqual([
      'javascript:alert(1)',
      'file:///secret.html',
      'chrome-extension://otherid/x.html',
    ]);
    expect(plan.windows[0].tabs.map((t) => t.url)).toEqual(['https://ok.com/']);
    expect(plan.totalTabs).toBe(1);
  });

  it('records the unwrapped url for suspended tabs', () => {
    const plan = planRestore(
      session([win([tab({ url: `${SUSPENDED_PREFIX}uri=https://real.com/` })])]),
      options(),
    );

    expect(plan.windows[0].tabs[0].url).toBe('https://real.com/');
  });

  it('omits a window whose tabs were all skipped but still reports them', () => {
    const plan = planRestore(
      session([win([tab({ url: 'data:text/plain,x' })]), win([tab({ url: 'https://ok.com/' })])]),
      options(),
    );

    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].tabs[0].url).toBe('https://ok.com/');
    expect(plan.skipped).toEqual(['data:text/plain,x']);
  });

  it('returns an empty plan for a session with no restorable tabs', () => {
    const plan = planRestore(session([win([tab({ url: 'javascript:void(0)' })])]), options());

    expect(plan.windows).toEqual([]);
    expect(plan.totalTabs).toBe(0);
    expect(plan.skipped).toEqual(['javascript:void(0)']);
  });

  it('throws when a window has more than one active tab', () => {
    const broken = session([win([tab({ active: true }), tab({ url: 'https://b.com/', active: true })])]);

    expect(() => planRestore(broken, options())).toThrow('Invariant violated: more than one active tab');
  });

  it('throws when a pinned tab carries a groupIndex', () => {
    const broken = session([
      win([tab({ pinned: true, groupIndex: 0 })], {
        groups: [{ title: 'G', color: 'blue', collapsed: false }],
      }),
    ]);

    expect(() => planRestore(broken, options())).toThrow('Invariant violated: pinned tab has groupIndex');
  });

  it('throws when a groupIndex points outside the groups array', () => {
    const broken = session([win([tab({ groupIndex: 3 })])]);

    expect(() => planRestore(broken, options())).toThrow('Invariant violated: groupIndex out of range');
  });

  it('does not mutate the session', () => {
    const input = session([win([tab({ url: 'https://u.com/' }), tab({ url: 'https://p.com/', pinned: true })])]);
    const before = JSON.stringify(input);

    planRestore(input, options());

    expect(JSON.stringify(input)).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sessions/restore.test.ts`
Expected: FAIL with `Failed to resolve import "./restore"`.

- [ ] **Step 3: Write minimal implementation**

`src/sessions/restore.ts`:

```ts
import type { Session, SessionSettings, WindowBounds, WindowSnapshot } from '@/types';

export const DEFAULT_CHUNK_SIZE = 25;
export const LAZY_AUTO_THRESHOLD = 50;
const MIN_WINDOW_SIDE = 200;

export interface SanitizeOptions {
  /** `chrome.runtime.id` — only our own chrome-extension:// pages may be restored. */
  ownExtensionId: string;
  /** Result of `chrome.extension.isAllowedFileSchemeAccess()`. */
  fileAccessAllowed: boolean;
  /** Suspender wrapper prefix, or '' when no suspender is configured. */
  suspendedPrefix: string;
  suspendedPrefixLen: number;
}

export type RestoreTarget = { kind: 'newWindows' } | { kind: 'window'; windowId: number };

export interface RestoreOptions {
  target: RestoreTarget;
  lazy: SessionSettings['restoreLazy'];
  chunkSize?: number;
  sanitize: SanitizeOptions;
}

export interface PlannedTab {
  url: string;
  pinned: boolean;
  active: boolean;
  groupIndex?: number;
}

export interface PlannedWindow {
  snapshot: WindowSnapshot;
  tabs: PlannedTab[];
  chunks: PlannedTab[][];
  lazy: boolean;
}

export interface RestorePlan {
  target: RestoreTarget;
  windows: PlannedWindow[];
  skipped: string[];
  totalTabs: number;
}

export interface RestoreResult {
  restored: number;
  skipped: string[];
  errors: { url: string; message: string }[];
}

export interface RestoreHooks {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  screen?: { availWidth: number; availHeight: number };
}

function unwrapSuspended(url: string, options: SanitizeOptions): string | null {
  if (options.suspendedPrefix === '' || !url.startsWith(options.suspendedPrefix)) {
    return url;
  }
  const params = new URLSearchParams(url.slice(options.suspendedPrefixLen));
  return params.get('uri');
}

/** Spec §6: returns the url to open, or null when it must be skipped. Never throws. */
export function sanitizeRestoreUrl(url: string, options: SanitizeOptions): string | null {
  const candidate = unwrapSuspended(url, options);
  if (candidate === null || candidate === '') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  switch (parsed.protocol) {
    case 'http:':
    case 'https:':
    case 'ftp:':
    case 'chrome:': {
      return candidate;
    }
    case 'about:': {
      return candidate === 'about:blank' ? candidate : null;
    }
    case 'chrome-extension:': {
      return parsed.hostname === options.ownExtensionId ? candidate : null;
    }
    case 'file:': {
      return options.fileAccessAllowed ? candidate : null;
    }
    default: {
      return null;
    }
  }
}

/** Intersects bounds with the available screen; undefined when less than 200x200 remains. */
export function clampToScreen(
  bounds: WindowBounds,
  screen: { availWidth: number; availHeight: number },
): WindowBounds | undefined {
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const right = Math.min(screen.availWidth, bounds.left + bounds.width);
  const bottom = Math.min(screen.availHeight, bounds.top + bounds.height);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_WINDOW_SIDE || height < MIN_WINDOW_SIDE) {
    return undefined;
  }
  return { left, top, width, height };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function planWindowTabs(
  snapshot: WindowSnapshot,
  sanitize: SanitizeOptions,
  skipped: string[],
): PlannedTab[] {
  const pinned: PlannedTab[] = [];
  const unpinned: PlannedTab[] = [];
  let activeCount = 0;

  for (const tab of snapshot.tabs) {
    if (tab.pinned && tab.groupIndex !== undefined) {
      throw new Error('Invariant violated: pinned tab has groupIndex');
    }
    if (tab.groupIndex !== undefined && tab.groupIndex >= snapshot.groups.length) {
      throw new Error('Invariant violated: groupIndex out of range');
    }
    if (tab.active) {
      activeCount += 1;
      if (activeCount > 1) {
        throw new Error('Invariant violated: more than one active tab');
      }
    }

    const url = sanitizeRestoreUrl(tab.url, sanitize);
    if (url === null) {
      skipped.push(tab.url);
      continue;
    }

    const planned: PlannedTab = { url, pinned: tab.pinned, active: tab.active };
    if (tab.groupIndex !== undefined) {
      planned.groupIndex = tab.groupIndex;
    }
    if (tab.pinned) {
      pinned.push(planned);
    } else {
      unpinned.push(planned);
    }
  }

  return [...pinned, ...unpinned];
}

/** Pure planner (spec §6). Throws on snapshot invariant violations; never calls chrome. */
export function planRestore(session: Session, options: RestoreOptions): RestorePlan {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  const skipped: string[] = [];
  const planned: { snapshot: WindowSnapshot; tabs: PlannedTab[] }[] = [];
  for (const snapshot of session.windows) {
    const tabs = planWindowTabs(snapshot, options.sanitize, skipped);
    if (tabs.length > 0) {
      planned.push({ snapshot, tabs });
    }
  }

  const totalTabs = planned.reduce((count, entry) => count + entry.tabs.length, 0);
  const lazy =
    options.lazy === 'always' || (options.lazy === 'auto' && totalTabs > LAZY_AUTO_THRESHOLD);

  return {
    target: options.target,
    windows: planned.map((entry) => ({
      snapshot: entry.snapshot,
      tabs: entry.tabs,
      chunks: chunk(entry.tabs, chunkSize),
      lazy,
    })),
    skipped,
    totalTabs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions/restore.test.ts && pnpm typecheck && pnpm exec biome check --write src/sessions src/background`
Expected: PASS (all `sanitizeRestoreUrl` cases, 5 `clampToScreen` tests, 20 `planRestore` tests), typecheck clean. Expected: no remaining diagnostics (formatter may rewrap lines). Several `it(...)`/`expect(...)` lines in the test file above exceed 100 columns on purpose; `--write` rewraps them, and the rewrapped file is what gets committed.

- [ ] **Step 5: Commit**

```bash
git add src/sessions/restore.ts src/sessions/restore.test.ts
git commit -m "feat(sessions): add sanitizeRestoreUrl, clampToScreen and planRestore"
```

Hand-off to T8: `executeRestore(plan, hooks)`, `withRetryOnce`, `isTabsCannotBeEditedError` go into `src/sessions/restore.ts` below `planRestore`; use `plan.windows[i].tabs` (already pinned-first, already sanitized) for `tabs.create`, `plan.windows[i].chunks` for the 25-tab batches, `plan.windows[i].lazy` for `tabs.discard`, `clampToScreen(snapshot.bounds, hooks.screen)` only when `snapshot.state === 'normal'` and `snapshot.bounds` is defined, and `RestoreResult` / `RestoreHooks` as declared here.

# Plan part: T8 executeRestore · T9 captureSession / openDashboard / background listeners · T10 manifest

All paths are relative to `/Users/thilllon/git/tab-organizer`. Branch `feat/sessions`. Assumes T1–T7 are merged on the branch: `src/test/chrome-fake.ts` + `src/test/setup.ts` (T2), the session types in `src/types.ts` (T3), `src/sessions/naming.ts`, `migrate.ts`, `hash.ts` (T3/T4), `captureWindows` in `src/sessions/capture.ts` (T5), `sessionRepo` in `src/sessions/storage.ts` (T6), and `sanitizeRestoreUrl` / `clampToScreen` / `planRestore` + the `RestoreTarget`, `RestoreOptions`, `PlannedTab`, `PlannedWindow`, `RestorePlan`, `RestoreResult`, `RestoreHooks`, `SanitizeOptions` interfaces in `src/sessions/restore.ts` (T7).

Requirements on the T2 chrome fake that these tasks rely on (all in the contract's "Chrome fake — required surface"): `getChromeFake()`; `fake.state.windows / tabs / groups / local / badge / menus`; `fake.failNext('tabs.create', times, message)`; `fake.fire.menuClicked(id)` / `fake.fire.command(name)`; `tabs.create` inserting at the end of the window with pinned tabs re-indexed to the front; `tabs.discard` rejecting on an active tab; `tabs.query({ url })` matching a trailing-`*` glob by prefix; `windows.update(id, { focused: true })` unfocusing every other window; `windows.getLastFocused({ windowTypes: ['normal'] })` returning the window whose `focused` is true (all fake windows are `'normal'`); `tabs.discard` returning the discarded `chrome.tabs.Tab`.

---

### Task 8: executeRestore

**Files:**

- Modify: `src/sessions/restore.ts` (append `isTabsCannotBeEditedError`, `withRetryOnce`, `executeRestore` and private helpers below the T7 code; no existing line changes)
- Test: `src/sessions/execute-restore.test.ts` (new file; T7's `restore.test.ts` stays untouched)

**Interfaces:**

- Consumes: `planRestore(session: Session, options: RestoreOptions): RestorePlan`, `clampToScreen(bounds: WindowBounds, screen: { availWidth: number; availHeight: number }): WindowBounds | undefined`, `RestorePlan`, `PlannedWindow`, `PlannedTab`, `RestoreTarget`, `RestoreResult`, `RestoreHooks`, `SanitizeOptions` (all T7, `src/sessions/restore.ts`); `Session`, `WindowSnapshot`, `WindowBounds` (T3, `src/types.ts`); `getChromeFake()` (T2).
- Produces: `executeRestore(plan: RestorePlan, hooks?: RestoreHooks): Promise<RestoreResult>`, `withRetryOnce<T>(fn: () => Promise<T>, shouldRetry: (err: unknown) => boolean): Promise<T>`, `isTabsCannotBeEditedError(err: unknown): boolean` — used by `useRestore` (T13).

- [ ] **Step 1: Write the failing test**

```ts
// src/sessions/execute-restore.test.ts
import { getChromeFake } from '@/test/chrome-fake';
import type { Session, WindowSnapshot } from '@/types';
import { describe, expect, it, vi } from 'vitest';
import {
  executeRestore,
  isTabsCannotBeEditedError,
  planRestore,
  type RestoreOptions,
  type RestorePlan,
  withRetryOnce,
} from './restore';

const SANITIZE: RestoreOptions['sanitize'] = {
  ownExtensionId: 'fakeextid',
  fileAccessAllowed: false,
  suspendedPrefix: 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#',
  suspendedPrefixLen: 'chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#'.length,
};

/** 1 pinned, group "Work" (blue, open) with 2 tabs, group "News" (red, collapsed) with 1 tab, 1 loose. */
const WINDOW_A: WindowSnapshot = {
  state: 'normal',
  focused: true,
  bounds: { left: 10, top: 20, width: 800, height: 600 },
  groups: [
    { title: 'Work', color: 'blue', collapsed: false },
    { title: 'News', color: 'red', collapsed: true },
  ],
  tabs: [
    { url: 'https://pinned.example/', title: 'Pinned', pinned: true, active: false },
    { url: 'https://work.example/a', title: 'A', pinned: false, active: false, groupIndex: 0 },
    { url: 'https://work.example/b', title: 'B', pinned: false, active: true, groupIndex: 0 },
    { url: 'https://news.example/', title: 'News', pinned: false, active: false, groupIndex: 1 },
    { url: 'https://loose.example/', title: 'Loose', pinned: false, active: false },
  ],
};

const WINDOW_B: WindowSnapshot = {
  state: 'normal',
  focused: false,
  groups: [],
  tabs: [
    { url: 'https://b1.example/', title: 'B1', pinned: false, active: true },
    { url: 'https://b2.example/', title: 'B2', pinned: false, active: false },
  ],
};

function makeSession(windows: WindowSnapshot[]): Session {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'saved',
    name: 'Fixture',
    origin: 'manual',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    windows,
  };
}

function makePlan(windows: WindowSnapshot[], overrides: Partial<RestoreOptions> = {}): RestorePlan {
  return planRestore(makeSession(windows), {
    target: { kind: 'newWindows' },
    lazy: 'never',
    chunkSize: 25,
    sanitize: SANITIZE,
    ...overrides,
  });
}

interface StripRow {
  url: string;
  pinned: boolean;
  active: boolean;
  group: string | null;
}

/** The tab strip of `windowId` in index order, with the group title resolved. */
function stripOf(windowId: number): StripRow[] {
  const fake = getChromeFake();
  return [...fake.state.tabs.values()]
    .filter((tab) => tab.windowId === windowId)
    .sort((a, b) => a.index - b.index)
    .map((tab) => {
      const group = tab.groupId === -1 ? undefined : fake.state.groups.get(tab.groupId);
      return { url: tab.url, pinned: tab.pinned, active: tab.active, group: group?.title ?? null };
    });
}

function newWindowIds(before: Set<number>): number[] {
  return [...getChromeFake().state.windows.keys()].filter((id) => !before.has(id));
}

function snapshotWindowIds(): Set<number> {
  return new Set(getChromeFake().state.windows.keys());
}

describe('isTabsCannotBeEditedError', () => {
  it('matches the Chrome drag-lock message, case-insensitively', () => {
    expect(isTabsCannotBeEditedError(new Error('Tabs cannot be edited right now (user may be dragging a tab).'))).toBe(true);
    expect(isTabsCannotBeEditedError('tabs CANNOT BE EDITED')).toBe(true);
    expect(isTabsCannotBeEditedError(new Error('No window with id: 9'))).toBe(false);
    expect(isTabsCannotBeEditedError(undefined)).toBe(false);
  });
});

describe('withRetryOnce', () => {
  it('retries exactly once when shouldRetry says so', async () => {
    let calls = 0;
    const result = await withRetryOnce(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('cannot be edited');
        }
        return 'ok';
      },
      () => true,
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry when shouldRetry returns false', async () => {
    let calls = 0;
    await expect(
      withRetryOnce(
        async () => {
          calls += 1;
          throw new Error('fatal');
        },
        () => false,
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('rethrows the second failure', async () => {
    let calls = 0;
    await expect(
      withRetryOnce(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        () => true,
      ),
    ).rejects.toThrow('fail 2');
  });
});

describe('executeRestore', () => {
  it('recreates the tab strip: order, pinned, groups (title/colour/collapsed) and active tab', async () => {
    const before = snapshotWindowIds();
    const result = await executeRestore(makePlan([WINDOW_A]));

    const created = newWindowIds(before);
    expect(created).toHaveLength(1);
    const windowId = created[0];

    expect(stripOf(windowId)).toEqual([
      { url: 'https://pinned.example/', pinned: true, active: false, group: null },
      { url: 'https://work.example/a', pinned: false, active: false, group: 'Work' },
      { url: 'https://work.example/b', pinned: false, active: true, group: 'Work' },
      { url: 'https://news.example/', pinned: false, active: false, group: 'News' },
      { url: 'https://loose.example/', pinned: false, active: false, group: null },
    ]);

    const groups = [...getChromeFake().state.groups.values()]
      .filter((group) => group.windowId === windowId)
      .map(({ title, color, collapsed }) => ({ title, color, collapsed }));
    expect(groups).toEqual([
      { title: 'Work', color: 'blue', collapsed: false },
      { title: 'News', color: 'red', collapsed: true },
    ]);

    expect(result).toEqual({ restored: 5, skipped: [], errors: [] });
  });

  it('applies clamped bounds for normal windows and focuses the snapshot-focused window last', async () => {
    const before = snapshotWindowIds();
    await executeRestore(makePlan([WINDOW_B, WINDOW_A]), {
      screen: { availWidth: 500, availHeight: 400 },
    });
    const [winB, winA] = newWindowIds(before);
    const fake = getChromeFake();
    const a = fake.state.windows.get(winA);
    const b = fake.state.windows.get(winB);
    expect(a?.focused).toBe(true);
    expect(b?.focused).toBe(false);
    expect({ left: a?.left, top: a?.top, width: a?.width, height: a?.height }).toEqual({
      left: 10,
      top: 20,
      width: 490,
      height: 380,
    });
  });

  it('removes the about:blank placeholder after activating the session tab', async () => {
    const updateSpy = vi.spyOn(chrome.tabs, 'update');
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    const before = snapshotWindowIds();
    await executeRestore(makePlan([WINDOW_A]));
    const [windowId] = newWindowIds(before);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      removeSpy.mock.invocationCallOrder[0],
    );
    expect(stripOf(windowId).some((row) => row.url === 'about:blank')).toBe(false);
    vi.restoreAllMocks();
  });

  it('orders: all creates before grouping, style before collapse, placeholder removed last', async () => {
    const createSpy = vi.spyOn(chrome.tabs, 'create');
    const groupSpy = vi.spyOn(chrome.tabs, 'group');
    const groupUpdateSpy = vi.spyOn(chrome.tabGroups, 'update');
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    await executeRestore(makePlan([WINDOW_A]));

    const createOrder = createSpy.mock.invocationCallOrder;
    const groupOrder = groupSpy.mock.invocationCallOrder;
    expect(createOrder).toHaveLength(5);
    expect(groupOrder).toHaveLength(2);
    // Spec §13 "group-after-all-tabs": every tabs.create precedes the first tabs.group.
    expect(Math.max(...createOrder)).toBeLessThan(Math.min(...groupOrder));

    const updates = groupUpdateSpy.mock.calls.map((args, i) => ({
      props: args[1],
      order: groupUpdateSpy.mock.invocationCallOrder[i],
    }));
    const styleCalls = updates.filter(({ props }) => props.title !== undefined);
    const collapseCalls = updates.filter(
      ({ props }) => props.collapsed !== undefined && props.title === undefined,
    );
    expect(styleCalls).toHaveLength(2);
    expect(collapseCalls).toHaveLength(2);
    // Each tabs.group precedes its own tabGroups.update({ title, color }).
    for (let i = 0; i < groupOrder.length; i++) {
      expect(groupOrder[i]).toBeLessThan(styleCalls[i].order);
    }
    // Spec §13 "collapse after grouping" and "placeholder removed last".
    const lastStyle = Math.max(...styleCalls.map((call) => call.order));
    const removeOrder = removeSpy.mock.invocationCallOrder[0];
    for (const call of collapseCalls) {
      expect(call.order).toBeGreaterThan(lastStyle);
      expect(call.order).toBeLessThan(removeOrder);
    }
    vi.restoreAllMocks();
  });

  it('reports every tab of a window whose windows.create fails and keeps restoring', async () => {
    const fake = getChromeFake();
    fake.failNext('windows.create', 1, 'Invalid value for bounds');
    const progress: [number, number][] = [];
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_B, WINDOW_A]), {
      onProgress: (done, total) => {
        progress.push([done, total]);
      },
    });

    // WINDOW_B (no bounds) fails outright; WINDOW_A is still restored in full.
    expect(newWindowIds(before)).toHaveLength(1);
    expect(result.restored).toBe(5);
    expect(result.errors).toEqual([
      { url: 'https://b1.example/', message: 'Invalid value for bounds' },
      { url: 'https://b2.example/', message: 'Invalid value for bounds' },
    ]);
    expect(progress).toEqual([
      [2, 7],
      [7, 7],
    ]);
  });

  it('retries windows.create without bounds when Chrome rejects the bounds', async () => {
    const fake = getChromeFake();
    fake.failNext('windows.create', 1, 'Invalid value for bounds');
    const createSpy = vi.spyOn(chrome.windows, 'create');
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A]), {
      screen: { availWidth: 1920, availHeight: 1080 },
    });

    expect(result.errors).toEqual([]);
    expect(result.restored).toBe(5);
    expect(createSpy).toHaveBeenCalledTimes(2);
    const [windowId] = newWindowIds(before);
    const win = fake.state.windows.get(windowId);
    // The retry carries no left/top/width/height: the fake falls back to its defaults (0, 0).
    expect({ left: win?.left, top: win?.top }).toEqual({ left: 0, top: 0 });
    vi.restoreAllMocks();
  });

  it('uses the tab ids returned by tabs.discard when grouping lazily restored windows', async () => {
    const fake = getChromeFake();
    // Some Chrome versions replace the discarded tab (new id); the returned Tab is the live one.
    const discardWithNewId = async (tabId?: number): Promise<chrome.tabs.Tab | undefined> => {
      if (tabId === undefined) {
        return undefined;
      }
      const old = fake.state.tabs.get(tabId);
      if (old === undefined) {
        throw new Error(`No tab with id: ${tabId}`);
      }
      const replacement = { ...old, id: fake.state.nextId.tab, discarded: true };
      fake.state.nextId.tab += 1;
      fake.state.tabs.delete(tabId);
      fake.state.tabs.set(replacement.id, replacement);
      return chrome.tabs.get(replacement.id);
    };
    vi.spyOn(chrome.tabs, 'discard').mockImplementation(discardWithNewId);
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A], { lazy: 'always' }));
    const [windowId] = newWindowIds(before);

    expect(result.errors).toEqual([]);
    expect(stripOf(windowId).map((row) => [row.url, row.group])).toEqual([
      ['https://pinned.example/', null],
      ['https://work.example/a', 'Work'],
      ['https://work.example/b', 'Work'],
      ['https://news.example/', 'News'],
      ['https://loose.example/', null],
    ]);
    vi.restoreAllMocks();
  });

  it('keeps going when one tabs.create fails and reports the error', async () => {
    const fake = getChromeFake();
    // The placeholder window is created by windows.create, so the first tabs.create is the pinned tab.
    fake.failNext('tabs.create', 1, 'No window with id: 999');

    const before = snapshotWindowIds();
    const result = await executeRestore(makePlan([WINDOW_A]));
    const [windowId] = newWindowIds(before);

    expect(result.restored).toBe(4);
    expect(result.errors).toEqual([
      { url: 'https://pinned.example/', message: 'No window with id: 999' },
    ]);
    expect(stripOf(windowId).map((row) => row.url)).toEqual([
      'https://work.example/a',
      'https://work.example/b',
      'https://news.example/',
      'https://loose.example/',
    ]);
  });

  it('retries once on "Tabs cannot be edited right now"', async () => {
    const fake = getChromeFake();
    fake.failNext('tabs.create', 1, 'Tabs cannot be edited right now (user may be dragging a tab).');
    const createSpy = vi.spyOn(chrome.tabs, 'create');

    const result = await executeRestore(makePlan([WINDOW_B]));

    expect(result.errors).toEqual([]);
    expect(result.restored).toBe(2);
    // 2 tabs + 1 retry
    expect(createSpy).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('never discards the active or pinned tab in lazy mode', async () => {
    const discardSpy = vi.spyOn(chrome.tabs, 'discard');
    const before = snapshotWindowIds();

    await executeRestore(makePlan([WINDOW_A], { lazy: 'always' }));
    const [windowId] = newWindowIds(before);
    const fake = getChromeFake();

    const discardedUrls = [...fake.state.tabs.values()]
      .filter((tab) => tab.windowId === windowId && tab.discarded)
      .map((tab) => tab.url)
      .sort();
    expect(discardedUrls).toEqual([
      'https://loose.example/',
      'https://news.example/',
      'https://work.example/a',
    ]);

    const discardedIds = discardSpy.mock.calls.map(([id]) => id);
    const forbidden = [...fake.state.tabs.values()]
      .filter((tab) => tab.windowId === windowId && (tab.pinned || tab.active))
      .map((tab) => tab.id);
    for (const id of forbidden) {
      expect(discardedIds).not.toContain(id);
    }
    vi.restoreAllMocks();
  });

  it('stops between chunks when the signal aborts, keeping already created tabs', async () => {
    const controller = new AbortController();
    const progress: [number, number][] = [];
    const before = snapshotWindowIds();

    const result = await executeRestore(makePlan([WINDOW_A, WINDOW_B], { chunkSize: 2 }), {
      signal: controller.signal,
      onProgress: (done, total) => {
        progress.push([done, total]);
        if (done === 2) {
          controller.abort();
        }
      },
    });

    const created = newWindowIds(before);
    expect(created).toHaveLength(1);
    const strip = stripOf(created[0]);
    expect(strip.map((row) => row.url)).toEqual([
      'https://pinned.example/',
      'https://work.example/a',
    ]);
    expect(strip.some((row) => row.url === 'about:blank')).toBe(false);
    expect(progress).toEqual([[2, 7]]);
    expect(result.restored).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/sessions/execute-restore.test.ts`
Expected: FAIL with `SyntaxError: The requested module './restore' does not provide an export named 'executeRestore'` (or equivalent "is not a function").

- [ ] **Step 3: Write minimal implementation**

Append to the end of `src/sessions/restore.ts` (T7's code above stays as is). `PlannedWindow.snapshot`, `.tabs`, `.chunks`, `.lazy`, `RestorePlan.target/windows/skipped/totalTabs`, `RestoreResult`, `RestoreHooks`, `clampToScreen` and `WindowBounds` are already declared/imported in this file by T7; if `WindowBounds` is not yet imported, add it to the existing `import type { ... } from '@/types'` line.

```ts
// ---------------------------------------------------------------------------
// executeRestore (Chrome calls; runs in the dashboard page, never in the SW)
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 100;

export function isTabsCannotBeEditedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.toLowerCase().includes('cannot be edited');
}

export async function withRetryOnce<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!shouldRetry(err)) {
      throw err;
    }
    await delay(RETRY_DELAY_MS);
    return fn();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

interface OpenedWindow {
  windowId: number;
  placeholderId: number | undefined;
}

function currentScreen(
  hooks: RestoreHooks,
): { availWidth: number; availHeight: number } | undefined {
  if (hooks.screen) {
    return hooks.screen;
  }
  if (typeof screen !== 'undefined') {
    return { availWidth: screen.availWidth, availHeight: screen.availHeight };
  }
  return undefined;
}

async function openTargetWindow(
  target: RestoreTarget,
  snapshot: WindowSnapshot,
  hooks: RestoreHooks,
): Promise<OpenedWindow> {
  if (target.kind === 'window') {
    return { windowId: target.windowId, placeholderId: undefined };
  }
  const createData: chrome.windows.CreateData = {
    url: 'about:blank',
    focused: false,
    state:
      snapshot.state === 'minimized' || snapshot.state === 'fullscreen' ? 'normal' : snapshot.state,
  };
  if (snapshot.state === 'normal' && snapshot.bounds) {
    const screenInfo = currentScreen(hooks);
    const bounds = screenInfo ? clampToScreen(snapshot.bounds, screenInfo) : snapshot.bounds;
    if (bounds) {
      createData.left = bounds.left;
      createData.top = bounds.top;
      createData.width = bounds.width;
      createData.height = bounds.height;
    }
  }
  let win: chrome.windows.Window | undefined;
  try {
    win = await chrome.windows.create(createData);
  } catch (err) {
    // Chrome refuses bounds it cannot honour (multi-monitor layouts changed, etc.): retry once
    // without left/top/width/height; anything else propagates to executeRestore's per-window catch.
    if (createData.left === undefined || !isBoundsError(err)) {
      throw err;
    }
    win = await chrome.windows.create({
      url: createData.url,
      focused: createData.focused,
      state: createData.state,
    });
  }
  if (win === undefined || win.id === undefined) {
    throw new Error('windows.create returned no window');
  }
  const placeholderId = win.tabs?.[0]?.id;
  return { windowId: win.id, placeholderId };
}

function isBoundsError(err: unknown): boolean {
  return errorMessage(err).toLowerCase().includes('bounds');
}

async function createChunk(
  chunk: PlannedTab[],
  windowId: number,
  errors: RestoreResult['errors'],
): Promise<(number | undefined)[]> {
  return Promise.all(
    chunk.map(async (tab) => {
      try {
        const created = await withRetryOnce(
          () => chrome.tabs.create({ windowId, url: tab.url, pinned: tab.pinned, active: false }),
          isTabsCannotBeEditedError,
        );
        return created.id;
      } catch (err) {
        errors.push({ url: tab.url, message: errorMessage(err) });
        return undefined;
      }
    }),
  );
}

/**
 * Discards the chunk's non-active, non-pinned tabs and returns the ids to keep using: Chrome may
 * replace a discarded tab (new id), and `tabs.discard` resolves with the tab that now exists.
 */
async function discardChunk(
  chunk: PlannedTab[],
  ids: (number | undefined)[],
): Promise<(number | undefined)[]> {
  const result = [...ids];
  for (let i = 0; i < chunk.length; i++) {
    const id = ids[i];
    const tab = chunk[i];
    if (id === undefined || tab.active || tab.pinned) {
      continue;
    }
    try {
      const discarded = await chrome.tabs.discard(id);
      result[i] = discarded?.id ?? id;
    } catch {
      // "still initializing" and friends: discarding is best-effort
    }
  }
  return result;
}

async function applyGroups(
  planned: PlannedWindow,
  created: (number | undefined)[],
  windowId: number,
): Promise<void> {
  const groupIds: (number | undefined)[] = [];
  for (let gi = 0; gi < planned.snapshot.groups.length; gi++) {
    const group = planned.snapshot.groups[gi];
    const ids = created.filter(
      (id, i): id is number => id !== undefined && planned.tabs[i]?.groupIndex === gi,
    );
    if (ids.length === 0) {
      groupIds.push(undefined);
      continue;
    }
    const tabIds: [number, ...number[]] = [ids[0], ...ids.slice(1)];
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
    groupIds.push(groupId);
  }
  // Collapse last: the placeholder is still the active tab, so collapsing cannot hit the active tab.
  for (let gi = 0; gi < groupIds.length; gi++) {
    const groupId = groupIds[gi];
    if (groupId === undefined) {
      continue;
    }
    await chrome.tabGroups.update(groupId, { collapsed: planned.snapshot.groups[gi].collapsed });
  }
}

async function finishWindow(
  plan: RestorePlan,
  planned: PlannedWindow,
  created: (number | undefined)[],
  opened: OpenedWindow,
): Promise<void> {
  const activeIndex = planned.tabs.findIndex((tab) => tab.active);
  const activeId = created[activeIndex] ?? created.find((id) => id !== undefined);
  if (plan.target.kind === 'newWindows' && activeId !== undefined) {
    await chrome.tabs.update(activeId, { active: true });
  }
  if (opened.placeholderId !== undefined) {
    try {
      await chrome.tabs.remove(opened.placeholderId);
    } catch {
      // already gone
    }
  }
  const state = planned.snapshot.state;
  if (plan.target.kind === 'newWindows' && (state === 'minimized' || state === 'fullscreen')) {
    try {
      await chrome.windows.update(opened.windowId, { state });
    } catch {
      // platform may refuse; the window still exists
    }
  }
}

export async function executeRestore(
  plan: RestorePlan,
  hooks: RestoreHooks = {},
): Promise<RestoreResult> {
  const errors: RestoreResult['errors'] = [];
  let restored = 0;
  let done = 0;
  let focusWindowId: number | undefined;
  let lastWindowId: number | undefined;

  for (const planned of plan.windows) {
    if (hooks.signal?.aborted) {
      break;
    }
    let opened: OpenedWindow;
    try {
      opened = await openTargetWindow(plan.target, planned.snapshot, hooks);
    } catch (err) {
      // Spec §6 "belt and braces": a failed windows.create costs this window only.
      for (const tab of planned.tabs) {
        errors.push({ url: tab.url, message: errorMessage(err) });
      }
      done += planned.tabs.length;
      hooks.onProgress?.(done, plan.totalTabs);
      continue;
    }
    const created: (number | undefined)[] = [];

    for (const chunk of planned.chunks) {
      const ids = await createChunk(chunk, opened.windowId, errors);
      created.push(...(planned.lazy ? await discardChunk(chunk, ids) : ids));
      done += chunk.length;
      hooks.onProgress?.(done, plan.totalTabs);
      if (hooks.signal?.aborted) {
        break;
      }
      await delay(0);
    }

    restored += created.filter((id) => id !== undefined).length;
    // Groups only after all tabs of this window exist (groups cannot be empty).
    await applyGroups(planned, created, opened.windowId);
    await finishWindow(plan, planned, created, opened);

    lastWindowId = opened.windowId;
    if (planned.snapshot.focused) {
      focusWindowId = opened.windowId;
    }
    if (hooks.signal?.aborted) {
      break;
    }
  }

  const toFocus = focusWindowId ?? lastWindowId;
  if (plan.target.kind === 'newWindows' && toFocus !== undefined) {
    try {
      await chrome.windows.update(toFocus, { focused: true });
    } catch {
      // window may have been closed by the user mid-restore
    }
  }

  return { restored, skipped: plan.skipped, errors };
}
```

Notes for the implementer:

- `applyGroups` uses `created[i]` ↔ `planned.tabs[i]` positional pairing; `created` is filled chunk by chunk in `planned.tabs` order, so indices line up even when some entries are `undefined`. After an abort `created` is shorter than `planned.tabs`; the filter only looks at existing indices, which is what we want.
- `chrome.windows.create` must never receive `left/top/width/height` together with a non-`normal` state (Chrome rejects it) — that is why bounds are only added under `snapshot.state === 'normal'`.
- Restore into an existing window (`target.kind === 'window'`) never activates a tab and never changes window state (spec §6 "user stays on the dashboard").
- `windows.create` is caught per window: a rejection records one error per planned tab of that window, advances progress by the window's tab count and moves on to the next window (already restored windows keep their `restored`/`errors`). A rejection whose message mentions "bounds" is retried once without `left/top/width/height` before giving up.
- `discardChunk` returns the ids to keep using; `applyGroups`/`finishWindow` only ever see post-discard ids, so lazily restored windows still group correctly on Chrome versions that hand out a new tab id on discard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions/execute-restore.test.ts src/sessions/restore.test.ts && pnpm typecheck && pnpm exec biome check --write src/sessions src/background`
Expected: PASS (15 tests in `execute-restore.test.ts`), typecheck clean. Expected: no remaining diagnostics (formatter may rewrap lines).

- [ ] **Step 5: Commit**

```bash
git add src/sessions/restore.ts src/sessions/execute-restore.test.ts
git commit -m "feat(sessions): executeRestore with retry, lazy discard and cancel"
```

---

### Task 9: captureSession, openDashboard and background listeners

**Files:**

- Modify: `src/sessions/capture.ts` (append `captureSession`; `captureWindows` and `CaptureOptions` from T5 unchanged)
- Create: `src/sessions/open-dashboard.ts`
- Create: `src/background/sessions.ts`
- Test: `src/sessions/capture-session.test.ts` (new; T5's `capture.test.ts` untouched)
- Test: `src/sessions/open-dashboard.test.ts`
- Test: `src/background/sessions.test.ts`

**Interfaces:**

- Consumes: `captureWindows(windows, groups, options: CaptureOptions): WindowSnapshot[]` (T5); `defaultSessionName(date, windowCount, tabCount)` (T3); `contentHash(windows)` (T4); `sessionRepo.put / reconcile / get` , `sessionKey`, `INDEX_KEY`, `withLock` (T6); `migrateSession`, `UnknownSchemaVersionError` (T4); `Session`, `SessionIndex` (T3); `getChromeFake()` (T2).
- Produces: `captureSession(scope: 'window' | 'all', name?: string): Promise<Session>` (ONE `Promise.all` of `windows.getAll({ populate: true, windowTypes: ['normal'] })`, `tabGroups.query({})`, `windows.getLastFocused({ windowTypes: ['normal'] })` and `loadSuspendedPrefix()` — the latter is the one `chrome.storage.sync.get` round-trip, so spec §5's "two calls" are three chrome calls plus one storage read, all in parallel); `export const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID` and `loadSuspendedPrefix(): Promise<string>` from `src/sessions/capture.ts` (T11's `src/dashboard/lib/sanitize-options.ts` imports both instead of duplicating them); `openDashboard(): Promise<void>`; from `src/background/sessions.ts`: `MENU_IDS`, `registerContextMenus(): Promise<void>`, `handleMenuOrCommand(id: string): Promise<void>`, `showSavedBadge(): void`, `clearBadge(): void`. `openDashboard` and `captureSession` are reused by the dashboard header (T11) and the Options card (T14).

- [ ] **Step 1: Write the failing tests (three files)**

```ts
// src/sessions/capture-session.test.ts
import { getChromeFake } from '@/test/chrome-fake';
import { describe, expect, it } from 'vitest';
import { captureSession } from './capture';

async function seedWindow(urls: string[], focused: boolean): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0] });
  if (win === undefined || win.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  await chrome.windows.update(win.id, { focused });
  return win.id;
}

describe('captureSession', () => {
  it("'all' captures every normal window and fills the session envelope", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    const before = Date.now();
    const session = await captureSession('all');

    expect(session.schemaVersion).toBe(1);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.kind).toBe('saved');
    expect(session.origin).toBe('manual');
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.updatedAt).toBe(session.createdAt);
    expect(session.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(session.windows).toHaveLength(2);
    expect(session.windows.map((w) => w.tabs.length)).toEqual([2, 1]);
    expect(session.name).toMatch(/^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 2 windows · 3 tabs$/);
  });

  it("'window' keeps only the last-focused window", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    const session = await captureSession('window');

    expect(session.windows).toHaveLength(1);
    expect(session.windows[0].tabs.map((t) => t.url)).toEqual(['https://b.example/']);
    expect(session.name).toMatch(/· 1 window · 1 tab$/);
  });

  it('uses the given name verbatim and drops own extension pages', async () => {
    const fake = getChromeFake();
    await seedWindow(['https://a.example/', chrome.runtime.getURL('dashboard.html')], true);

    const session = await captureSession('window', 'My tabs');

    expect(session.name).toBe('My tabs');
    expect(session.windows[0].tabs.map((t) => t.url)).toEqual(['https://a.example/']);
    expect(fake.state.tabs.size).toBe(2);
  });
});
```

```ts
// src/sessions/open-dashboard.test.ts
import { getChromeFake } from '@/test/chrome-fake';
import { describe, expect, it } from 'vitest';
import { openDashboard } from './open-dashboard';

const DASHBOARD_URL = 'chrome-extension://fakeextid/dashboard.html';

describe('openDashboard', () => {
  it('creates the dashboard tab when none exists', async () => {
    await chrome.windows.create({ url: 'https://a.example/' });

    await openDashboard();

    const fake = getChromeFake();
    const dashboardTabs = [...fake.state.tabs.values()].filter((t) => t.url === DASHBOARD_URL);
    expect(dashboardTabs).toHaveLength(1);
    expect(dashboardTabs[0].active).toBe(true);
  });

  it('focuses the existing dashboard tab and its window instead of creating a second one', async () => {
    const fake = getChromeFake();
    const winA = await chrome.windows.create({ url: 'https://a.example/' });
    const winB = await chrome.windows.create({ url: 'https://b.example/' });
    if (winA?.id === undefined || winB?.id === undefined) {
      throw new Error('fake windows.create returned nothing');
    }
    const existing = await chrome.tabs.create({
      windowId: winA.id,
      url: `${DASHBOARD_URL}#saved`,
      active: false,
    });
    await chrome.windows.update(winB.id, { focused: true });

    await openDashboard();

    const dashboardTabs = [...fake.state.tabs.values()].filter((t) =>
      t.url.startsWith(DASHBOARD_URL),
    );
    expect(dashboardTabs).toHaveLength(1);
    expect(dashboardTabs[0].id).toBe(existing.id);
    expect(dashboardTabs[0].active).toBe(true);
    expect(fake.state.windows.get(winA.id)?.focused).toBe(true);
    expect(fake.state.windows.get(winB.id)?.focused).toBe(false);
  });
});
```

```ts
// src/background/sessions.test.ts
import { INDEX_KEY } from '@/sessions/storage';
import { getChromeFake } from '@/test/chrome-fake';
import type { SessionIndex } from '@/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MENU_IDS,
  clearBadge,
  handleMenuOrCommand,
  registerContextMenus,
  showSavedBadge,
} from './sessions';

const DASHBOARD_URL = 'chrome-extension://fakeextid/dashboard.html';

async function seedWindow(urls: string[], focused: boolean): Promise<number> {
  const win = await chrome.windows.create({ url: urls[0] });
  if (win === undefined || win.id === undefined) {
    throw new Error('fake windows.create returned nothing');
  }
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ windowId: win.id, url, active: false });
  }
  await chrome.windows.update(win.id, { focused });
  return win.id;
}

function sessionKeys(): string[] {
  return [...getChromeFake().state.local.keys()].filter((key) => key.startsWith('session:'));
}

function readIndex(): SessionIndex | undefined {
  const raw = getChromeFake().state.local.get(INDEX_KEY);
  return raw as SessionIndex | undefined;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registerContextMenus', () => {
  it('is idempotent: removeAll then exactly 3 items + 1 separator', async () => {
    await registerContextMenus();
    await registerContextMenus();

    const menus = getChromeFake().state.menus;
    expect(menus).toHaveLength(4);
    expect(menus.map((m) => m.id)).toEqual([
      MENU_IDS.saveWindow,
      MENU_IDS.saveAll,
      'sessions-separator',
      MENU_IDS.openDashboard,
    ]);
    expect(menus.filter((m) => m.type !== 'separator').map((m) => m.title)).toEqual([
      'Save this window as session',
      'Save all windows as session',
      'Open Sessions',
    ]);
    for (const menu of menus) {
      expect(menu.contexts).toEqual(['action']);
    }
  });
});

describe('badge', () => {
  it('showSavedBadge shows ✓ and clears itself after 2 s', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = getChromeFake();

    showSavedBadge();
    expect(fake.state.badge.text).toBe('✓');
    expect(fake.state.badge.color).toBe('#16a34a');

    vi.advanceTimersByTime(1999);
    expect(fake.state.badge.text).toBe('✓');
    vi.advanceTimersByTime(1);
    expect(fake.state.badge.text).toBe('');
  });

  it('clearBadge empties the badge text', () => {
    const fake = getChromeFake();
    fake.state.badge.text = '✓';
    clearBadge();
    expect(fake.state.badge.text).toBe('');
  });
});

describe('handleMenuOrCommand', () => {
  it("'save-window' writes one session:* key plus the index and sets the badge", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/', 'https://b.example/2', 'https://b.example/3'], true);

    await handleMenuOrCommand('save-window');

    const keys = sessionKeys();
    expect(keys).toHaveLength(1);
    const index = readIndex();
    expect(index?.sessions).toHaveLength(1);
    expect(index?.sessions[0].id).toBe(keys[0].slice('session:'.length));
    expect(index?.sessions[0].windowCount).toBe(1);
    expect(index?.sessions[0].tabCount).toBe(3);
    expect(getChromeFake().state.badge.text).toBe('✓');
  });

  it("'save-session' (keyboard command) behaves like 'save-window'", async () => {
    await seedWindow(['https://a.example/'], true);
    await handleMenuOrCommand('save-session');
    expect(sessionKeys()).toHaveLength(1);
    expect(readIndex()?.sessions[0].windowCount).toBe(1);
  });

  it("'save-all' captures every window", async () => {
    await seedWindow(['https://a.example/', 'https://a.example/2'], false);
    await seedWindow(['https://b.example/'], true);

    await handleMenuOrCommand('save-all');

    expect(sessionKeys()).toHaveLength(1);
    expect(readIndex()?.sessions[0].windowCount).toBe(2);
    expect(readIndex()?.sessions[0].tabCount).toBe(3);
  });

  it("'open-dashboard' focuses an existing dashboard tab instead of creating a second", async () => {
    const fake = getChromeFake();
    const winA = await seedWindow(['https://a.example/', DASHBOARD_URL], false);
    await seedWindow(['https://b.example/'], true);
    const tabsBefore = fake.state.tabs.size;

    await handleMenuOrCommand('open-dashboard');

    expect(fake.state.tabs.size).toBe(tabsBefore);
    const dashboard = [...fake.state.tabs.values()].find((t) => t.url === DASHBOARD_URL);
    expect(dashboard?.active).toBe(true);
    expect(fake.state.windows.get(winA)?.focused).toBe(true);
    expect(fake.state.badge.text).toBe('');
  });

  it('ignores unknown ids', async () => {
    await handleMenuOrCommand('nope');
    expect(sessionKeys()).toHaveLength(0);
    expect(getChromeFake().state.tabs.size).toBe(0);
  });
});

describe('listener wiring', () => {
  it('a context-menu click on save-window saves a session', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.menuClicked(MENU_IDS.saveWindow);

    await vi.waitFor(() => {
      expect(sessionKeys()).toHaveLength(1);
    });
  });

  it('the save-session command saves a session', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();
    await seedWindow(['https://a.example/'], true);

    fake.fire.command('save-session');

    await vi.waitFor(() => {
      expect(sessionKeys()).toHaveLength(1);
    });
  });

  it('onInstalled registers the menus', async () => {
    vi.resetModules();
    await import('./sessions');
    const fake = getChromeFake();

    fake.fire.installed({ reason: 'install' });

    await vi.waitFor(() => {
      expect(fake.state.menus).toHaveLength(4);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/sessions/capture-session.test.ts src/sessions/open-dashboard.test.ts src/background/sessions.test.ts`
Expected: FAIL — `capture-session.test.ts` with "does not provide an export named 'captureSession'"; the other two with "Failed to resolve import './open-dashboard'" / "Failed to resolve import './sessions'".

- [ ] **Step 3: Append `captureSession` to `src/sessions/capture.ts`**

Add these imports at the top of the file (merge with T5's existing import lines — `captureWindows`/`CaptureOptions` stay exactly as T5 wrote them):

```ts
import { contentHash } from './hash';
import { defaultSessionName } from './naming';
import type { Session } from '@/types';
```

Append at the end of the file:

```ts
// Default to "The Marvellous Suspender", the same de facto default as src/background/index.ts.
// Shared with the dashboard (src/dashboard/lib/sanitize-options.ts imports both exports).
export const THE_MARVELLOUS_SUSPENDER_EXTENSION_ID = 'noogafoofpebimajpfpamcfhoaifemoa';

/** `chrome-extension://<suspender id>/suspended.html#`, honouring the Options-page override. */
export async function loadSuspendedPrefix(): Promise<string> {
  const stored = await chrome.storage.sync.get<{ tabSuspenderExtensionId: string }>({
    tabSuspenderExtensionId: THE_MARVELLOUS_SUSPENDER_EXTENSION_ID,
  });
  const suspenderId =
    typeof stored.tabSuspenderExtensionId === 'string' && stored.tabSuspenderExtensionId !== ''
      ? stored.tabSuspenderExtensionId
      : THE_MARVELLOUS_SUSPENDER_EXTENSION_ID;
  return `chrome-extension://${suspenderId}/suspended.html#`;
}

async function loadCaptureOptions(): Promise<CaptureOptions> {
  const suspendedPrefix = await loadSuspendedPrefix();
  return {
    ownUrlPrefix: chrome.runtime.getURL(''),
    suspendedPrefix,
    suspendedPrefixLen: suspendedPrefix.length,
  };
}

export async function captureSession(scope: 'window' | 'all', name?: string): Promise<Session> {
  const [allWindows, groups, focused, options] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
    loadCaptureOptions(),
  ]);

  const windows =
    scope === 'window'
      ? allWindows.filter((w) => w.id !== undefined && w.id === focused.id)
      : allWindows;

  const snapshots = captureWindows(windows, groups, options);
  const tabCount = snapshots.reduce((sum, w) => sum + w.tabs.length, 0);
  const now = Date.now();

  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind: 'saved',
    name: name ?? defaultSessionName(new Date(now), snapshots.length, tabCount),
    origin: 'manual',
    createdAt: now,
    updatedAt: now,
    contentHash: contentHash(snapshots),
    windows: snapshots,
  };
}
```

- [ ] **Step 4: Create `src/sessions/open-dashboard.ts`**

```ts
// src/sessions/open-dashboard.ts
/**
 * Opens the Sessions dashboard as a singleton: focuses the existing dashboard tab (and its
 * window) when one is open, otherwise creates it. Used by the service worker (context menu,
 * keyboard command) and by the options page.
 */
export async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url: `${url}*` });
  const tab = existing[0];

  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url, active: true });
}
```

- [ ] **Step 5: Create `src/background/sessions.ts`**

```ts
// src/background/sessions.ts
import { captureSession } from '@/sessions/capture';
import { migrateSession, UnknownSchemaVersionError } from '@/sessions/migrate';
import { openDashboard } from '@/sessions/open-dashboard';
import { sessionKey, sessionRepo, withLock } from '@/sessions/storage';

/**
 * Session-related service-worker listeners. Imported once from ./index.ts. Every listener is
 * registered synchronously at module top level (MV3 requirement). No tab/window listeners here —
 * ever (see AGENTS.md).
 */

export const MENU_IDS = {
  saveWindow: 'save-window',
  saveAll: 'save-all',
  openDashboard: 'open-dashboard',
} as const;

const SEPARATOR_ID = 'sessions-separator';
const BADGE_COLOR = '#16a34a';
const BADGE_CLEAR_MS = 2000;

export function showSavedBadge(): void {
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  void chrome.action.setBadgeText({ text: '✓' });
  setTimeout(clearBadge, BADGE_CLEAR_MS);
}

export function clearBadge(): void {
  void chrome.action.setBadgeText({ text: '' });
}

export async function registerContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_IDS.saveWindow,
    title: 'Save this window as session',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: MENU_IDS.saveAll,
    title: 'Save all windows as session',
    contexts: ['action'],
  });
  chrome.contextMenus.create({ id: SEPARATOR_ID, type: 'separator', contexts: ['action'] });
  chrome.contextMenus.create({
    id: MENU_IDS.openDashboard,
    title: 'Open Sessions',
    contexts: ['action'],
  });
}

async function saveSession(scope: 'window' | 'all'): Promise<void> {
  const session = await captureSession(scope);
  if (session.windows.length === 0) {
    // Nothing capturable (e.g. only the dashboard is open): no badge, no empty session.
    return;
  }
  await sessionRepo.put(session);
  showSavedBadge();
}

export async function handleMenuOrCommand(id: string): Promise<void> {
  clearBadge();
  switch (id) {
    case MENU_IDS.saveWindow:
    case 'save-session':
      await saveSession('window');
      return;
    case MENU_IDS.saveAll:
      await saveSession('all');
      return;
    case MENU_IDS.openDashboard:
      await openDashboard();
      return;
    default:
      return;
  }
}

/**
 * Eager migration on extension update: one key at a time under the lock. For schema v1 this is
 * the identity, so nothing is rewritten; newer records stay untouched (the UI shows them
 * read-only).
 */
async function migrateStoredSessions(): Promise<void> {
  const summaries = await sessionRepo.listSummaries();
  for (const summary of summaries) {
    await withLock(async () => {
      const key = sessionKey(summary.id);
      const raw = await chrome.storage.local.get(key);
      const record: unknown = raw[key];
      if (record === undefined) {
        return;
      }
      try {
        const migrated = migrateSession(record);
        if (JSON.stringify(migrated) !== JSON.stringify(record)) {
          await chrome.storage.local.set({ [key]: migrated });
        }
      } catch (err) {
        if (err instanceof UnknownSchemaVersionError) {
          return;
        }
        throw err;
      }
    });
  }
}

async function onInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  await registerContextMenus();
  await sessionRepo.reconcile();
  if (details.reason === 'update') {
    await migrateStoredSessions();
  }
}

async function onStartup(): Promise<void> {
  clearBadge();
  await sessionRepo.reconcile();
}

function report(err: unknown): void {
  console.error('[tab-organizer:sessions]', err);
}

chrome.runtime.onInstalled.addListener((details) => {
  onInstalled(details).catch(report);
});

chrome.runtime.onStartup.addListener(() => {
  onStartup().catch(report);
});

chrome.contextMenus.onClicked.addListener((info) => {
  handleMenuOrCommand(String(info.menuItemId)).catch(report);
});

chrome.commands.onCommand.addListener((command) => {
  handleMenuOrCommand(command).catch(report);
});
```

Notes:

- `chrome.runtime.InstalledDetails` is the type name in @types/chrome 0.2.5 for the `onInstalled` payload (`interface InstalledDetails { reason: `${OnInstalledReason}`; … }`), so the string literal `'update'` comparison type-checks.
- `sessionRepo.listSummaries()` / `withLock` / `sessionKey` are the T6 exports; do not read `sessionIndex` by hand here.
- The module has no mutable module-scope state; the badge timeout is the only timer and it is harmless if the SW dies first (`clearBadge()` runs at the start of every handler and in `onStartup`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sessions src/background && pnpm typecheck && pnpm exec biome check --write src/sessions src/background`
Expected: PASS — 3 tests in `capture-session.test.ts`, 2 in `open-dashboard.test.ts`, 11 in `background/sessions.test.ts`; existing `sort.test.ts` still green; typecheck clean. Expected: no remaining diagnostics (formatter may rewrap lines).

- [ ] **Step 7: Commit**

```bash
git add src/sessions/capture.ts src/sessions/capture-session.test.ts \
  src/sessions/open-dashboard.ts src/sessions/open-dashboard.test.ts \
  src/background/sessions.ts src/background/sessions.test.ts
git commit -m "feat(sessions): captureSession, openDashboard singleton and SW menu/command listeners"
```

---

### Task 10: Manifest permissions/commands and background import

**Files:**

- Modify: `vite.config.ts` (permissions array; new `commands` block)
- Modify: `src/background/index.ts` (one added import line)
- Test: none (manifest is verified by `pnpm build` output and in `chrome://extensions`)

**Interfaces:**

- Consumes: `src/background/sessions.ts` side-effect module (T9); command names `'save-session'` / `'open-dashboard'` handled by `handleMenuOrCommand` (T9).
- Produces: built `dist/manifest.json` with `permissions: ['tabs','tabGroups','storage','contextMenus','unlimitedStorage','favicon']` and `commands.save-session` / `commands.open-dashboard` (no `suggested_key`). T11–T14 rely on `favicon` (`/_favicon/` URLs) and `unlimitedStorage`.

- [ ] **Step 1: Edit `vite.config.ts` (exact diff)**

```diff
@@ inside defineManifest((env) => { return { ... } })
     web_accessible_resources: [
       {
         resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
         matches: [],
       },
     ],
-    permissions: ['tabs', 'tabGroups', 'storage'],
+    permissions: ['tabs', 'tabGroups', 'storage', 'contextMenus', 'unlimitedStorage', 'favicon'],
+    // Shipped unbound on purpose: Chrome silently drops conflicting suggested_key values and the
+    // UI must not promise a key. Users bind them at chrome://extensions/shortcuts.
+    commands: {
+      'save-session': { description: 'Save the current window as a session' },
+      'open-dashboard': { description: 'Open the Sessions dashboard' },
+    },
   };
 });
```

The T1 `build.rollupOptions.input` / `test.setupFiles` edits from Phase 0 stay as they are; only the two keys above change. `_execute_action` is deliberately not defined (spec §2).

- [ ] **Step 2: Edit `src/background/index.ts` (one line)**

```diff
 import type { DuplicateTabHandling, SortSettings } from '@/types';
 import { findDuplicateTabs, hashStringToColor, sortByCustom, sortByTitleOrUrl } from './sort';
+import './sessions';
```

Nothing else in `index.ts` changes: `chrome.action.onClicked` still calls `sortTabGroups()` only, and the existing `onInstalled` handler stays (the sessions one is a second listener).

- [ ] **Step 3: Verify the build output**

Run: `pnpm typecheck && pnpm build && node -e "const m=require('./dist/manifest.json'); console.log(JSON.stringify({permissions:m.permissions, commands:m.commands}, null, 2))"`
Expected output:

```json
{
  "permissions": [
    "tabs",
    "tabGroups",
    "storage",
    "contextMenus",
    "unlimitedStorage",
    "favicon"
  ],
  "commands": {
    "save-session": {
      "description": "Save the current window as a session"
    },
    "open-dashboard": {
      "description": "Open the Sessions dashboard"
    }
  }
}
```

Also confirm `dist/dashboard.html` exists (`ls dist/dashboard.html`) and that `pnpm exec vitest run` is still green (the `import './sessions'` must not break `sort.test.ts`, which does not import `index.ts`).

- [ ] **Step 4: Verify in Chrome**

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select `dist/` (or "Reload" if already loaded).
2. On the extension card click "Details" → "Permissions" shows no new install warning; the manifest view (`dist/manifest.json`) matches the JSON above.
3. Right-click the Tab Organizer toolbar icon: the menu shows "Save this window as session", "Save all windows as session", a separator, "Open Sessions".
4. Click "Save this window as session": the icon shows a green "✓" badge which disappears after ~2 s. Open the extension's service worker console ("Inspect views: service worker") → run `chrome.storage.local.get(null).then(console.log)` → exactly one `session:<uuid>` key and one `sessionIndex` key with `sessions.length === 1`.
5. Click "Open Sessions": `dashboard.html` opens in a new tab (T11 fills it in; before T11 it is the Phase 0 placeholder). Click it again from another window: the existing tab is focused, no second tab appears.
6. `chrome://extensions/shortcuts`: "Tab Organizer" lists "Save the current window as a session" and "Open the Sessions dashboard", both unassigned. Assign one, press it → same effect as the menu item.
7. Left-click the icon: tabs are sorted exactly as before; no dashboard opens, no badge appears.
8. `chrome://serviceworker-internals` → Stop the extension's worker → repeat step 4: still works (listeners are top-level). Reload the extension: the menu items are still present (recreated by `onInstalled`).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/background/index.ts
git commit -m "feat(sessions): manifest permissions, keyboard commands and SW import"
```

## Phase 1 — Dashboard UI (Tasks 11–14)

Shared conventions for T11–T14:

- Every dashboard file lives under `src/dashboard/`. Pure helpers that are unit-tested live in `src/dashboard/lib/` and never import React or touch the DOM; hooks live in `src/dashboard/hooks/`; components in `src/dashboard/components/`.
- The dashboard is an extension page: it calls `chrome.*` directly and uses `sessionRepo` (T6) as its only write path. No `chrome.runtime.sendMessage` anywhere.
- Vitest runs in Node (no jsdom, no @testing-library). Therefore tests cover the pure helpers and chrome-fake-backed loaders; React hooks/components are verified manually with the exact steps given in each task. Do NOT add jsdom or @testing-library in these tasks.
- Every task ends with `pnpm typecheck && pnpm format && pnpm exec vitest run` green. `pnpm format` rewrites shadcn-generated files to Biome style (single quotes) — that is expected; commit the formatted result.
- lucide-react 1.x names used: `Save`, `Layers`, `Trash2`, `Pencil`, `Ellipsis`, `ChevronRight`, `ChevronDown`, `Globe`, `Pin`, `TriangleAlert`, `LoaderCircle`, `Keyboard`, `MousePointerClick`, `X`, `RotateCcw`, `FolderOpen`. (All verified to exist in `node_modules/lucide-react/dist/lucide-react.d.ts`.)

---

### Task 11: shadcn components + dashboard shell (Dashboard, useSessionIndex, SessionCard list/rename/delete)

**Files:**

- Create: `src/components/ui/input.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `badge.tsx`, `tooltip.tsx`, `separator.tsx`, `scroll-area.tsx`, `collapsible.tsx` (generated by the shadcn CLI, then formatted)
- Create: `src/dashboard/lib/errors.ts`, `src/dashboard/lib/format.ts`, `src/dashboard/lib/session-utils.ts`, `src/dashboard/lib/sanitize-options.ts`
- Create: `src/dashboard/hooks/useSessionIndex.ts`
- Create: `src/dashboard/components/SessionCard.tsx`, `src/dashboard/components/DeleteSessionDialog.tsx`
- Create: `src/dashboard/Dashboard.tsx`
- Modify: `src/dashboard/index.tsx` (T1 placeholder → render `<Dashboard />`)
- Test: `src/dashboard/lib/errors.test.ts`, `src/dashboard/lib/format.test.ts`, `src/dashboard/lib/session-utils.test.ts`, `src/dashboard/lib/sanitize-options.test.ts`, `src/dashboard/hooks/useSessionIndex.test.ts`

**Interfaces:**

- Consumes: `sessionRepo`, `INDEX_KEY` (`@/sessions/storage`, T6); `captureSession(scope, name?)`, `loadSuspendedPrefix()`, `THE_MARVELLOUS_SUSPENDER_EXTENSION_ID` (`@/sessions/capture`, T9); `planRestore`, `executeRestore`, `SanitizeOptions`, `RestoreTarget` (`@/sessions/restore`, T7/T8); `Session`, `SessionSummary` (`@/types`, T3); `getChromeFake()` (`@/test/chrome-fake`, T2).
- Produces:
  - `errorMessage(err: unknown): string`
  - `pluralize(count: number, noun: string): string`, `formatBytes(bytes: number): string`, `formatSessionMeta(summary: Pick<SessionSummary, 'windowCount' | 'tabCount' | 'bytes'>): string`, `hostnameOf(url: string): string`, `formatDateTime(epochMs: number): string`
  - `pickWindow(session: Session, windowIndex: number): Session`
  - `loadSanitizeOptions(): Promise<SanitizeOptions>` (builds `SanitizeOptions` from `loadSuspendedPrefix()` — the suspender constant and loader live in `src/sessions/capture.ts`, not here)
  - `isIndexChange(changes: Record<string, chrome.storage.StorageChange>, area: string): boolean`, `useSessionIndex(): { sessions; loading; error?; refresh() }`
  - `SessionCard` props `{ summary: SessionSummary; onRestore(session: Session): void; onRestoreWindow(session: Session, windowIndex: number): void }`
  - `DeleteSessionDialog` props `{ name: string; open: boolean; onOpenChange(open: boolean): void; onConfirm(): void }`

- [ ] **Step 1: Generate the shadcn components**

Run:

```bash
pnpm exec shadcn add -y input dialog dropdown-menu badge tooltip separator scroll-area collapsible
pnpm format
git status --short src/components/ui
```

Expected: eight new files in `src/components/ui/` (`input.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `badge.tsx`, `tooltip.tsx`, `separator.tsx`, `scroll-area.tsx`, `collapsible.tsx`), all importing from `'radix-ui'` (same style as the existing `button.tsx`) and now single-quoted by Biome. If the CLI asks anything interactively, answer with the defaults. Do not edit these files by hand.

Run: `pnpm typecheck`
Expected: PASS (0 errors).

- [ ] **Step 2: Commit the generated components**

```bash
git add src/components/ui
git commit -m "feat(sessions): add shadcn input/dialog/dropdown/badge/tooltip/separator/scroll-area/collapsible"
```

- [ ] **Step 3: Write the failing tests for the pure helpers**

`src/dashboard/lib/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });

  it('falls back to a generic message for empty values', () => {
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage(new Error(''))).toBe('Unknown error');
  });
});
```

`src/dashboard/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBytes, formatSessionMeta, hostnameOf, pluralize } from './format';

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'tab')).toBe('1 tab');
  });

  it('uses the plural otherwise', () => {
    expect(pluralize(0, 'tab')).toBe('0 tabs');
    expect(pluralize(87, 'window')).toBe('87 windows');
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2150)).toBe('2.1 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('formatSessionMeta', () => {
  it('joins window count, tab count and size with middle dots', () => {
    expect(formatSessionMeta({ windowCount: 3, tabCount: 87, bytes: 2150 })).toBe(
      '3 windows · 87 tabs · 2.1 KB',
    );
  });

  it('uses singular forms', () => {
    expect(formatSessionMeta({ windowCount: 1, tabCount: 1, bytes: 10 })).toBe(
      '1 window · 1 tab · 10 B',
    );
  });
});

describe('hostnameOf', () => {
  it('returns the hostname of http(s) urls', () => {
    expect(hostnameOf('https://mail.google.com/mail/u/0/#inbox')).toBe('mail.google.com');
  });

  it('returns the scheme label for chrome and about urls', () => {
    expect(hostnameOf('chrome://extensions/')).toBe('chrome://extensions');
    expect(hostnameOf('about:blank')).toBe('about:blank');
  });

  it('returns the raw string for unparsable urls', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});
```

`src/dashboard/lib/session-utils.test.ts`:

```ts
import type { Session, WindowSnapshot } from '@/types';
import { describe, expect, it } from 'vitest';
import { pickWindow } from './session-utils';

function makeWindow(url: string): WindowSnapshot {
  return {
    state: 'normal',
    focused: false,
    groups: [],
    tabs: [{ url, title: url, pinned: false, active: true }],
  };
}

const session: Session = {
  schemaVersion: 1,
  id: 'abc',
  kind: 'saved',
  name: 'Fixture',
  origin: 'manual',
  createdAt: 1,
  updatedAt: 2,
  windows: [makeWindow('https://a.example/'), makeWindow('https://b.example/')],
};

describe('pickWindow', () => {
  it('returns a session containing only the requested window', () => {
    const picked = pickWindow(session, 1);
    expect(picked.windows).toEqual([session.windows[1]]);
    expect(picked.id).toBe('abc');
    expect(picked.name).toBe('Fixture');
  });

  it('does not mutate the original session', () => {
    pickWindow(session, 0);
    expect(session.windows).toHaveLength(2);
  });

  it('throws a RangeError for an out-of-range index', () => {
    expect(() => pickWindow(session, 2)).toThrow(RangeError);
    expect(() => pickWindow(session, -1)).toThrow(RangeError);
  });
});
```

`src/dashboard/lib/sanitize-options.test.ts`:

```ts
import { THE_MARVELLOUS_SUSPENDER_EXTENSION_ID } from '@/sessions/capture';
import { getChromeFake } from '@/test/chrome-fake';
import { describe, expect, it } from 'vitest';
import { loadSanitizeOptions } from './sanitize-options';

describe('loadSanitizeOptions', () => {
  it('defaults to the Marvellous Suspender id and no file access', async () => {
    const options = await loadSanitizeOptions();
    expect(options.ownExtensionId).toBe('fakeextid');
    expect(options.fileAccessAllowed).toBe(false);
    expect(options.suspendedPrefix).toBe(
      `chrome-extension://${THE_MARVELLOUS_SUSPENDER_EXTENSION_ID}/suspended.html#`,
    );
    expect(options.suspendedPrefixLen).toBe(options.suspendedPrefix.length);
  });

  it('honours the configured suspender id and file-scheme access', async () => {
    const fake = getChromeFake();
    fake.state.sync.set('tabSuspenderExtensionId', 'abcdefghijklmnopabcdefghijklmnop');
    fake.state.fileAccessAllowed = true;

    const options = await loadSanitizeOptions();
    expect(options.suspendedPrefix).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/suspended.html#',
    );
    expect(options.fileAccessAllowed).toBe(true);
  });

  it('ignores an empty stored id', async () => {
    getChromeFake().state.sync.set('tabSuspenderExtensionId', '');
    const options = await loadSanitizeOptions();
    expect(options.suspendedPrefix).toContain(THE_MARVELLOUS_SUSPENDER_EXTENSION_ID);
  });
});
```

`src/dashboard/hooks/useSessionIndex.test.ts`:

```ts
import { INDEX_KEY } from '@/sessions/storage';
import { describe, expect, it } from 'vitest';
import { isIndexChange } from './useSessionIndex';

describe('isIndexChange', () => {
  it('is true when the session index changed in local storage', () => {
    expect(isIndexChange({ [INDEX_KEY]: { newValue: { sessions: [] } } }, 'local')).toBe(true);
  });

  it('is false for other keys', () => {
    expect(isIndexChange({ 'session:abc': { newValue: {} } }, 'local')).toBe(false);
  });

  it('is false for other storage areas', () => {
    expect(isIndexChange({ [INDEX_KEY]: { newValue: {} } }, 'sync')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/dashboard`
Expected: FAIL — five suites fail to load with `Failed to resolve import "./errors"` / `"./format"` / `"./session-utils"` / `"./sanitize-options"` / `"./useSessionIndex"` (modules do not exist yet).

- [ ] **Step 5: Implement the pure helpers**

`src/dashboard/lib/errors.ts`:

```ts
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 0 ? err.message : 'Unknown error';
  }
  if (err === undefined || err === null) {
    return 'Unknown error';
  }
  return String(err);
}
```

`src/dashboard/lib/format.ts`:

```ts
import type { SessionSummary } from '@/types';

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSessionMeta(
  summary: Pick<SessionSummary, 'windowCount' | 'tabCount' | 'bytes'>,
): string {
  return [
    pluralize(summary.windowCount, 'window'),
    pluralize(summary.tabCount, 'tab'),
    formatBytes(summary.bytes),
  ].join(' · ');
}

export function hostnameOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname.length > 0) {
    return parsed.hostname;
  }
  // chrome://extensions/ -> "chrome://extensions", about:blank -> "about:blank"
  const withoutTrailingSlash = url.replace(/\/+$/, '');
  return withoutTrailingSlash;
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

`src/dashboard/lib/session-utils.ts`:

```ts
import type { Session } from '@/types';

/** Returns a copy of `session` that contains only `windows[windowIndex]`. */
export function pickWindow(session: Session, windowIndex: number): Session {
  const window = session.windows[windowIndex];
  if (windowIndex < 0 || window === undefined) {
    throw new RangeError(`Session ${session.id} has no window at index ${windowIndex}`);
  }
  return { ...session, windows: [window] };
}
```

`src/dashboard/lib/sanitize-options.ts`:

```ts
import { loadSuspendedPrefix } from '@/sessions/capture';
import type { SanitizeOptions } from '@/sessions/restore';

/**
 * Builds the SanitizeOptions for a restore run in this page. The suspender default and the
 * `tabSuspenderExtensionId` lookup are shared with capture (`src/sessions/capture.ts`).
 */
export async function loadSanitizeOptions(): Promise<SanitizeOptions> {
  const [suspendedPrefix, fileAccessAllowed] = await Promise.all([
    loadSuspendedPrefix(),
    chrome.extension.isAllowedFileSchemeAccess(),
  ]);
  return {
    ownExtensionId: chrome.runtime.id,
    fileAccessAllowed,
    suspendedPrefix,
    suspendedPrefixLen: suspendedPrefix.length,
  };
}
```

- [ ] **Step 6: Implement `useSessionIndex`**

`src/dashboard/hooks/useSessionIndex.ts`:

```ts
import { errorMessage } from '@/dashboard/lib/errors';
import { INDEX_KEY, sessionRepo } from '@/sessions/storage';
import type { SessionSummary } from '@/types';
import { useCallback, useEffect, useState } from 'react';

export function isIndexChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): boolean {
  return area === 'local' && Object.hasOwn(changes, INDEX_KEY);
}

export interface SessionIndexState {
  sessions: SessionSummary[];
  loading: boolean;
  error?: string;
  refresh(): Promise<void>;
}

export function useSessionIndex(): SessionIndexState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const summaries = await sessionRepo.listSummaries();
      setSessions(summaries);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (isIndexChange(changes, area)) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(listener);

    void (async () => {
      try {
        // Spec §4: reconcile orphan bodies / dangling index entries on dashboard mount.
        await sessionRepo.reconcile();
      } catch {
        // Reconcile failures are non-fatal; the list below still loads.
      }
      if (!disposed) {
        await refresh();
      }
    })();

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/dashboard && pnpm typecheck`
Expected: PASS — 5 files, all tests green; typecheck 0 errors.

- [ ] **Step 8: Commit the helpers and hook**

```bash
git add src/dashboard/lib src/dashboard/hooks/useSessionIndex.ts src/dashboard/hooks/useSessionIndex.test.ts
git commit -m "feat(sessions): dashboard helpers and useSessionIndex hook"
```

- [ ] **Step 9: Write `DeleteSessionDialog` and `SessionCard`**

`src/dashboard/components/DeleteSessionDialog.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DeleteSessionDialogProps {
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

export function DeleteSessionDialog({ name, open, onOpenChange, onConfirm }: DeleteSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
          <DialogDescription>
            “{name}” will be removed from this device. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/dashboard/components/SessionCard.tsx` (T11 version — rename, delete, restore; the expandable tree is added in T12):

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';
import { Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

export interface SessionCardProps {
  summary: SessionSummary;
  onRestore(session: Session): void;
  onRestoreWindow(session: Session, windowIndex: number): void;
}

export function SessionCard({ summary, onRestore }: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const startRename = () => {
    setDraft(summary.name);
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name.length === 0 || name === summary.name) {
      return;
    }
    try {
      await sessionRepo.rename(summary.id, name);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(summary.name);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await sessionRepo.remove(summary.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const session = await sessionRepo.get(summary.id);
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      onRestore(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={draft}
              aria-label="Session name"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={() => void commitRename()}
              className="h-8"
            />
          ) : (
            <button
              type="button"
              className="truncate text-left text-sm font-medium hover:underline"
              title="Rename"
              onClick={startRename}
            >
              {summary.name}
            </button>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSessionMeta(summary)} · saved {formatDateTime(summary.updatedAt)}
          </p>
        </div>

        {summary.kind === 'history' && <Badge variant="secondary">history</Badge>}

        <Button size="sm" onClick={() => void handleRestore()} disabled={busy}>
          <RotateCcw />
          Restore
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={startRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error !== undefined && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
      />
    </li>
  );
}
```

Note: the shadcn `radix-ui` template that generated `button.tsx` (it carries `data-variant`) ships `DropdownMenuItem` with `variant?: 'default' | 'destructive'`, so `variant="destructive"` type-checks as written.

- [ ] **Step 10: Write `Dashboard` and wire the entry point**

Quota errors (`QUOTA_BYTES`) are shown as the raw message in the header error line; the storage-meter link is Phase 6 (`StorageMeter`) and "Delete old history" is Phase 3, so spec §4's toast link is deliberately not implemented in Phase 1.

`src/dashboard/Dashboard.tsx` (T11 version — direct restore, replaced by `useRestore` in T13):

```tsx
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SessionCard } from '@/dashboard/components/SessionCard';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import { loadSanitizeOptions } from '@/dashboard/lib/sanitize-options';
import { pickWindow } from '@/dashboard/lib/session-utils';
import { captureSession } from '@/sessions/capture';
import { executeRestore, planRestore } from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session } from '@/types';
import { Layers, Save } from 'lucide-react';
import { useState } from 'react';

type SaveScope = 'window' | 'all';

export function Dashboard() {
  const { sessions, loading, error: indexError } = useSessionIndex();
  const [saving, setSaving] = useState<SaveScope | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = async (scope: SaveScope) => {
    setSaving(scope);
    setError(undefined);
    setNotice(undefined);
    try {
      const session = await captureSession(scope);
      if (session.windows.length === 0) {
        setNotice('Nothing to save — this window only contains the Sessions dashboard.');
        return;
      }
      await sessionRepo.put(session);
      setNotice(`Saved “${session.name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(undefined);
    }
  };

  const restore = async (session: Session) => {
    setError(undefined);
    try {
      const [settings, sanitize] = await Promise.all([
        sessionRepo.getSettings(),
        loadSanitizeOptions(),
      ]);
      const plan = planRestore(session, {
        target: { kind: 'newWindows' },
        lazy: settings.restoreLazy,
        sanitize,
      });
      const result = await executeRestore(plan);
      setNotice(`Restored ${result.restored} of ${plan.totalTabs} tabs.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const restoreWindow = (session: Session, windowIndex: number) => {
    void restore(pickWindow(session, windowIndex));
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-wide text-primary uppercase">Sessions</h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void save('window')}
            disabled={saving !== undefined}
          >
            <Save />
            Save this window
          </Button>
          <Button size="sm" onClick={() => void save('all')} disabled={saving !== undefined}>
            <Layers />
            Save all windows
          </Button>
        </div>
      </header>

      <Separator className="my-4" />

      {notice !== undefined && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{notice}</p>
      )}
      {(error ?? indexError) !== undefined && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? indexError}
        </p>
      )}

      <main>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((summary) => (
              <SessionCard
                key={summary.id}
                summary={summary}
                onRestore={(session) => void restore(session)}
                onRestoreWindow={restoreWindow}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
```

`src/dashboard/index.tsx` (replace the T1 placeholder entirely):

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';

import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
```

- [ ] **Step 11: Typecheck, format, build**

Run: `pnpm typecheck && pnpm format && pnpm build`
Expected: 0 type errors; Biome makes no complaints beyond auto-fixes; `dist/dashboard.html` exists and `dist/assets/` contains a dashboard chunk.

- [ ] **Step 12: Manual verification in Chrome**

1. `pnpm build`, then in `chrome://extensions` (Developer mode) click **Load unpacked** → select `dist/` (or **Reload** if already loaded).
2. Open a normal window with at least 3 tabs, e.g. `https://example.com`, `https://developer.chrome.com`, `https://github.com`.
3. Open `chrome-extension://<id>/dashboard.html` in a new tab (id from the extensions page). Expected screen: header "SESSIONS" with two buttons "Save this window" and "Save all windows"; below the separator the text "No saved sessions yet."
4. Click **Save this window**. Expected within ~1 s: a grey notice `Saved “Session 2026-… · 1 window · 3 tabs”.` and a card appears with that name, meta line `1 window · 3 tabs · <n> B · saved <date>`, a **Restore** button and a `…` menu. (The dashboard tab itself is not counted — 3 tabs, not 4.)
5. DevTools → Application → Storage → Extension storage → Local: exactly two new keys, `sessionIndex` and one `session:<uuid>`.
6. Click the session name → an input appears; type `Work` and press Enter. Expected: the card title becomes "Work"; in a second dashboard tab (open the URL again) the rename is visible without reload (storage.onChanged path). Press Escape while editing → the previous name is kept.
7. `…` → **Delete** → dialog "Delete session?" with the name → **Cancel** keeps the card; repeat and click **Delete** → the card disappears and both storage keys are gone.
8. Save again, then click **Restore**. Expected: a new window opens with the 3 tabs in the same order, and the notice `Restored 3 of 3 tabs.` appears. The saved session still exists.
9. Left-click the extension icon: tabs are sorted and nothing else happens (click path unchanged).

- [ ] **Step 13: Commit**

```bash
git add src/dashboard
git commit -m "feat(sessions): dashboard shell with session list, rename and delete"
```

---

### Task 12: WindowTree / GroupSection / TabRow / Favicon + useSessionBody

**Files:**

- Create: `src/dashboard/lib/segments.ts`, `src/dashboard/lib/group-colors.ts`
- Create: `src/dashboard/hooks/useSessionBody.ts`
- Create: `src/dashboard/components/Favicon.tsx`, `src/dashboard/components/TabRow.tsx`, `src/dashboard/components/GroupSection.tsx`, `src/dashboard/components/WindowTree.tsx`
- Modify: `src/dashboard/components/SessionCard.tsx` (add expand toggle, load body via `useSessionBody`, render `WindowTree` per window)
- Test: `src/dashboard/lib/segments.test.ts`, `src/dashboard/lib/group-colors.test.ts`, `src/dashboard/hooks/useSessionBody.test.ts`

**Interfaces:**

- Consumes: `sessionRepo`, `sessionKey(id)` (`@/sessions/storage`, T6); `UnknownSchemaVersionError` (`@/sessions/migrate`, T4); `Session`, `SessionId`, `WindowSnapshot`, `GroupSnapshot`, `TabSnapshot`, `TabGroupColor` (`@/types`); `hostnameOf`, `pluralize` (T11); `SessionCard` (T11).
- Produces:
  - `interface TabSegment { groupIndex?: number; tabs: TabSnapshot[] }`, `segmentTabs(tabs: TabSnapshot[]): TabSegment[]`
  - `GROUP_COLOR_CLASS: Record<TabGroupColor, string>`, `groupColorClass(color: string): string`
  - `isBodyChange(changes, area, id: SessionId): boolean`, `useSessionBody(id: SessionId | null): { session?: Session; loading: boolean; error?: string }`
  - `Favicon` props `{ url: string; size?: number }`; `TabRow` props `{ tab: TabSnapshot }`; `GroupSection` props `{ group: GroupSnapshot; tabs: TabSnapshot[] }`; `WindowTree` props `{ window: WindowSnapshot; index: number; onRestoreWindow?(): void }`

- [ ] **Step 1: Write the failing tests**

`src/dashboard/lib/segments.test.ts`:

```ts
import type { TabSnapshot } from '@/types';
import { describe, expect, it } from 'vitest';
import { segmentTabs } from './segments';

function tab(url: string, groupIndex?: number, pinned = false): TabSnapshot {
  return groupIndex === undefined
    ? { url, title: url, pinned, active: false }
    : { url, title: url, pinned, active: false, groupIndex };
}

describe('segmentTabs', () => {
  it('returns an empty list for no tabs', () => {
    expect(segmentTabs([])).toEqual([]);
  });

  it('keeps ungrouped tabs as single-tab segments in strip order', () => {
    const tabs = [tab('https://a/'), tab('https://b/')];
    expect(segmentTabs(tabs)).toEqual([
      { groupIndex: undefined, tabs: [tabs[0]] },
      { groupIndex: undefined, tabs: [tabs[1]] },
    ]);
  });

  it('merges consecutive tabs of the same group into one segment', () => {
    const tabs = [
      tab('https://pinned/', undefined, true),
      tab('https://a/', 0),
      tab('https://b/', 0),
      tab('https://c/'),
      tab('https://d/', 1),
    ];
    expect(segmentTabs(tabs)).toEqual([
      { groupIndex: undefined, tabs: [tabs[0]] },
      { groupIndex: 0, tabs: [tabs[1], tabs[2]] },
      { groupIndex: undefined, tabs: [tabs[3]] },
      { groupIndex: 1, tabs: [tabs[4]] },
    ]);
  });

  it('starts a new segment when the group index changes between neighbours', () => {
    const tabs = [tab('https://a/', 0), tab('https://b/', 1), tab('https://c/', 0)];
    expect(segmentTabs(tabs).map((segment) => segment.groupIndex)).toEqual([0, 1, 0]);
  });
});
```

`src/dashboard/lib/group-colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GROUP_COLOR_CLASS, groupColorClass } from './group-colors';

describe('groupColorClass', () => {
  it('maps every Chrome tab group colour to a Tailwind background class', () => {
    for (const [color, className] of Object.entries(GROUP_COLOR_CLASS)) {
      expect(groupColorClass(color)).toBe(className);
      expect(className).toMatch(/^bg-[a-z]+-500$/);
    }
  });

  it('maps grey to the gray palette', () => {
    expect(groupColorClass('grey')).toBe('bg-gray-500');
  });

  it('falls back to grey for unknown colours', () => {
    expect(groupColorClass('magenta')).toBe('bg-gray-500');
  });
});
```

`src/dashboard/hooks/useSessionBody.test.ts`:

```ts
import { sessionKey } from '@/sessions/storage';
import { describe, expect, it } from 'vitest';
import { isBodyChange } from './useSessionBody';

describe('isBodyChange', () => {
  it('is true when the body of the given session changed in local storage', () => {
    expect(isBodyChange({ [sessionKey('abc')]: { newValue: {} } }, 'local', 'abc')).toBe(true);
  });

  it('is false for another session or another area', () => {
    expect(isBodyChange({ [sessionKey('xyz')]: { newValue: {} } }, 'local', 'abc')).toBe(false);
    expect(isBodyChange({ [sessionKey('abc')]: { newValue: {} } }, 'sync', 'abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/dashboard/lib/segments.test.ts src/dashboard/lib/group-colors.test.ts src/dashboard/hooks/useSessionBody.test.ts`
Expected: FAIL — three suites fail with `Failed to resolve import "./segments"` / `"./group-colors"` / `"./useSessionBody"`.

- [ ] **Step 3: Implement the pure helpers and the hook**

`src/dashboard/lib/segments.ts`:

```ts
import type { TabSnapshot } from '@/types';

export interface TabSegment {
  groupIndex?: number;
  tabs: TabSnapshot[];
}

/**
 * Splits a window's tabs (strip order) into runs: each ungrouped tab is its own segment,
 * consecutive tabs sharing a groupIndex form one segment. Rendering the segments in order
 * reproduces the tab strip exactly.
 */
export function segmentTabs(tabs: TabSnapshot[]): TabSegment[] {
  const segments: TabSegment[] = [];
  for (const tab of tabs) {
    const last = segments[segments.length - 1];
    if (
      tab.groupIndex !== undefined &&
      last !== undefined &&
      last.groupIndex !== undefined &&
      last.groupIndex === tab.groupIndex
    ) {
      last.tabs.push(tab);
    } else {
      segments.push({ groupIndex: tab.groupIndex, tabs: [tab] });
    }
  }
  return segments;
}
```

`src/dashboard/lib/group-colors.ts`:

```ts
import type { TabGroupColor } from '@/types';

export const GROUP_COLOR_CLASS: Record<TabGroupColor, string> = {
  grey: 'bg-gray-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
};

function isTabGroupColor(value: string): value is TabGroupColor {
  return Object.hasOwn(GROUP_COLOR_CLASS, value);
}

export function groupColorClass(color: string): string {
  return isTabGroupColor(color) ? GROUP_COLOR_CLASS[color] : GROUP_COLOR_CLASS.grey;
}
```

`src/dashboard/hooks/useSessionBody.ts`:

```ts
import { errorMessage } from '@/dashboard/lib/errors';
import { UnknownSchemaVersionError } from '@/sessions/migrate';
import { sessionKey, sessionRepo } from '@/sessions/storage';
import type { Session, SessionId } from '@/types';
import { useEffect, useState } from 'react';

export function isBodyChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
  id: SessionId,
): boolean {
  return area === 'local' && Object.hasOwn(changes, sessionKey(id));
}

export interface SessionBodyState {
  session?: Session;
  loading: boolean;
  error?: string;
}

/** Loads the full Session body for `id`; `null` means "not expanded", nothing is loaded. */
export function useSessionBody(id: SessionId | null): SessionBodyState {
  const [state, setState] = useState<SessionBodyState>({ loading: false });

  useEffect(() => {
    if (id === null) {
      setState({ loading: false });
      return;
    }
    let disposed = false;

    const load = async () => {
      setState((previous) => ({ ...previous, loading: true }));
      try {
        const session = await sessionRepo.get(id);
        if (disposed) {
          return;
        }
        if (session === undefined) {
          setState({ loading: false, error: 'This session no longer exists.' });
        } else {
          setState({ loading: false, session });
        }
      } catch (err) {
        if (disposed) {
          return;
        }
        const error =
          err instanceof UnknownSchemaVersionError
            ? 'This session was saved by a newer version of Tab Organizer and cannot be shown.'
            : errorMessage(err);
        setState({ loading: false, error });
      }
    };

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (isBodyChange(changes, area, id)) {
        void load();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    void load();

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [id]);

  return state;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/dashboard && pnpm typecheck`
Expected: PASS (all dashboard suites, including T11's), typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/lib/segments.ts src/dashboard/lib/segments.test.ts src/dashboard/lib/group-colors.ts src/dashboard/lib/group-colors.test.ts src/dashboard/hooks/useSessionBody.ts src/dashboard/hooks/useSessionBody.test.ts
git commit -m "feat(sessions): tab segmentation, group colours and useSessionBody hook"
```

- [ ] **Step 6: Write the tree components**

`src/dashboard/components/Favicon.tsx`:

```tsx
import { Globe } from 'lucide-react';
import { useState } from 'react';

export interface FaviconProps {
  url: string;
  size?: number;
}

/** CSS pixel size the icon is rendered at; `size` is the bitmap size requested from Chrome. */
const RENDER_PX = 16;

/**
 * Renders the site icon from Chrome's local favicon cache (no network); falls back to Globe.
 * Spec §9: request a 32 px bitmap (crisp on HiDPI) and display it at 16×16 CSS px.
 */
export function Favicon({ url, size = 32 }: FaviconProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Globe
        className="shrink-0 text-muted-foreground"
        style={{ width: RENDER_PX, height: RENDER_PX }}
      />
    );
  }

  const src = chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${String(size)}`,
  );
  return (
    <img
      src={src}
      width={RENDER_PX}
      height={RENDER_PX}
      alt=""
      className="shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
```

`src/dashboard/components/TabRow.tsx`:

```tsx
import { Favicon } from '@/dashboard/components/Favicon';
import { hostnameOf } from '@/dashboard/lib/format';
import type { TabSnapshot } from '@/types';
import { Pin } from 'lucide-react';

export interface TabRowProps {
  tab: TabSnapshot;
}

export function TabRow({ tab }: TabRowProps) {
  const open = () => {
    void chrome.tabs.create({ url: tab.url, active: false });
  };

  return (
    <li>
      <button
        type="button"
        onClick={open}
        title={tab.url}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
      >
        <Favicon url={tab.url} />
        <span className="min-w-0 flex-1 truncate">{tab.title.length > 0 ? tab.title : tab.url}</span>
        <span className="shrink-0 truncate text-xs text-muted-foreground max-w-40">
          {hostnameOf(tab.url)}
        </span>
        {tab.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
      </button>
    </li>
  );
}
```

`src/dashboard/components/GroupSection.tsx`:

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { groupColorClass } from '@/dashboard/lib/group-colors';
import type { GroupSnapshot, TabSnapshot } from '@/types';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

export interface GroupSectionProps {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
}

export function GroupSection({ group, tabs }: GroupSectionProps) {
  const [open, setOpen] = useState(!group.collapsed);

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-accent"
          >
            <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className={`size-2.5 shrink-0 rounded-full ${groupColorClass(group.color)}`} />
            <span className="min-w-0 flex-1 truncate">
              {group.title.length > 0 ? group.title : 'Untitled group'}
            </span>
            <span className="text-xs text-muted-foreground">{pluralize(tabs.length, 'tab')}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-5 border-l pl-2">
            {tabs.map((tab, index) => (
              <TabRow key={`${index}-${tab.url}`} tab={tab} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
```

`src/dashboard/components/WindowTree.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { GroupSection } from '@/dashboard/components/GroupSection';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { segmentTabs } from '@/dashboard/lib/segments';
import type { WindowSnapshot } from '@/types';
import { RotateCcw } from 'lucide-react';

export interface WindowTreeProps {
  window: WindowSnapshot;
  index: number;
  onRestoreWindow?(): void;
}

export function WindowTree({ window, index, onRestoreWindow }: WindowTreeProps) {
  const segments = segmentTabs(window.tabs);

  return (
    <section className="rounded-md border">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1">
        <h3 className="text-sm font-medium">Window {index + 1}</h3>
        <span className="text-xs text-muted-foreground">
          {pluralize(window.tabs.length, 'tab')}
          {window.state !== 'normal' ? ` · ${window.state}` : ''}
        </span>
        {onRestoreWindow !== undefined && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRestoreWindow}>
            <RotateCcw />
            Restore window
          </Button>
        )}
      </header>
      <ul className="p-1">
        {segments.map((segment, segmentIndex) => {
          const group =
            segment.groupIndex !== undefined ? window.groups[segment.groupIndex] : undefined;
          if (group !== undefined) {
            return (
              <GroupSection
                key={`group-${segmentIndex}-${String(segment.groupIndex)}`}
                group={group}
                tabs={segment.tabs}
              />
            );
          }
          return segment.tabs.map((tab, tabIndex) => (
            <TabRow key={`tab-${segmentIndex}-${tabIndex}-${tab.url}`} tab={tab} />
          ));
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7: Add the expandable tree to `SessionCard`**

Replace `src/dashboard/components/SessionCard.tsx` with this full file (differences from T11: `expanded` state, `useSessionBody`, `ScrollArea` with `WindowTree`s, `onRestoreWindow` is now used):

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';
import { ChevronRight, Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

export interface SessionCardProps {
  summary: SessionSummary;
  onRestore(session: Session): void;
  onRestoreWindow(session: Session, windowIndex: number): void;
}

export function SessionCard({ summary, onRestore, onRestoreWindow }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const body = useSessionBody(expanded ? summary.id : null);

  const startRename = () => {
    setDraft(summary.name);
    setEditing(true);
  };

  const commitRename = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name.length === 0 || name === summary.name) {
      return;
    }
    try {
      await sessionRepo.rename(summary.id, name);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(summary.name);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await sessionRepo.remove(summary.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      onRestore(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </Button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={draft}
              aria-label="Session name"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={() => void commitRename()}
              className="h-8"
            />
          ) : (
            <button
              type="button"
              className="truncate text-left text-sm font-medium hover:underline"
              title="Rename"
              onClick={startRename}
            >
              {summary.name}
            </button>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSessionMeta(summary)} · saved {formatDateTime(summary.updatedAt)}
          </p>
        </div>

        {summary.kind === 'history' && <Badge variant="secondary">history</Badge>}

        <Button size="sm" onClick={() => void handleRestore()} disabled={busy}>
          <RotateCcw />
          Restore
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={startRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error !== undefined && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {expanded && (
        <div className="mt-3">
          {body.loading && body.session === undefined && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {body.error !== undefined && <p className="text-xs text-destructive">{body.error}</p>}
          {body.session !== undefined && (
            <ScrollArea className="max-h-96">
              <div className="space-y-2 pr-3">
                {body.session.windows.map((window, index) => (
                  <WindowTree
                    key={`window-${index}`}
                    window={window}
                    index={index}
                    onRestoreWindow={() => {
                      if (body.session !== undefined) {
                        onRestoreWindow(body.session, index);
                      }
                    }}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
      />
    </li>
  );
}
```

- [ ] **Step 8: Typecheck, format, build**

Run: `pnpm typecheck && pnpm format && pnpm build`
Expected: 0 errors, build succeeds.

- [ ] **Step 9: Manual verification in Chrome**

1. Reload the unpacked extension. Prepare a window with: 2 pinned tabs (`https://example.com`, `https://github.com`), a tab group titled "Docs" colour blue containing `https://developer.chrome.com` and `https://developer.mozilla.org`, a second collapsed group "News" (any colour) with `https://news.ycombinator.com`, and one ungrouped tab `https://en.wikipedia.org`.
2. Open the dashboard and click **Save this window**. Expected card meta: `1 window · 6 tabs · …`.
3. Click the chevron on the card. Expected: "Loading…" for a moment, then a bordered "Window 1 · 6 tabs" section. Order top-to-bottom: example.com (pin icon), github.com (pin icon), a "Docs" group row with a blue dot and "2 tabs" (expanded, its two tabs indented), a "News" group row with "1 tab" that is **collapsed** (matches `collapsed: true`), then wikipedia.org. Each tab row shows a favicon, title and hostname. In DevTools → Application → Storage → Local, no additional keys were read/written (only the existing two).
4. Click the "Docs" header: the group collapses; click again: it expands.
5. Click the "wikipedia.org" row: a new **background** tab with that URL opens in the current window; the dashboard stays active.
6. Click **Restore window** in the Window 1 header: a new window opens reproducing the strip (pinned first, groups with titles/colours, "News" collapsed).
7. Favicon fallback: save a session containing `about:blank`, expand it — the row shows the Globe icon instead of a broken image.
8. Rename the session from a second dashboard tab: the expanded tree in the first tab stays open and the title updates (index change), and no body reload flicker occurs (body key unchanged).

- [ ] **Step 10: Commit**

```bash
git add src/dashboard/components
git commit -m "feat(sessions): expandable window/group/tab tree with favicons"
```

---

### Task 13: useRestore + ProgressToast + confirm dialog + beforeunload

**Files:**

- Create: `src/dashboard/lib/restore-summary.ts`
- Create: `src/dashboard/hooks/useRestore.ts`
- Create: `src/dashboard/components/ProgressToast.tsx`, `src/dashboard/components/RestoreConfirmDialog.tsx`
- Modify: `src/dashboard/Dashboard.tsx` (replace direct restore with `useRestore`, add confirm dialog + toast)
- Test: `src/dashboard/lib/restore-summary.test.ts`

**Interfaces:**

- Consumes: `planRestore`, `executeRestore`, `RestoreResult`, `RestoreTarget` (`@/sessions/restore`, T7/T8); `sessionRepo` (T6); `loadSanitizeOptions`, `pickWindow`, `errorMessage`, `pluralize` (T11); `Session`, `SessionSettings` (`@/types`).
- Produces:
  - `RESTORE_CONFIRM_THRESHOLD = 100`, `countTabs(session: Session): number`, `needsRestoreConfirm(session: Session): boolean`, `formatRestoreSummary(result: RestoreResult, total: number): string`
  - `useRestore(): { restore(session: Session, target: RestoreTarget, lazyOverride?: SessionSettings['restoreLazy']): Promise<RestoreResult | undefined>; progress?: { done: number; total: number }; running: boolean; cancel(): void; lastResult?: RestoreResult; dismiss(): void }` (matches the contract row exactly)
  - `ProgressToast` props `{ progress?: { done: number; total: number }; result?: RestoreResult; onCancel(): void; onDismiss(): void }`
  - `RestoreConfirmDialog` props `{ pending?: PendingRestore; onConfirm(lazy: SessionSettings['restoreLazy']): void; onCancel(): void }` where `PendingRestore = { session: Session; target: RestoreTarget }`

- [ ] **Step 1: Write the failing test**

`src/dashboard/lib/restore-summary.test.ts`:

```ts
import type { Session } from '@/types';
import { describe, expect, it } from 'vitest';
import {
  RESTORE_CONFIRM_THRESHOLD,
  countTabs,
  formatRestoreSummary,
  needsRestoreConfirm,
} from './restore-summary';

function sessionWithTabs(...counts: number[]): Session {
  return {
    schemaVersion: 1,
    id: 'id',
    kind: 'saved',
    name: 'n',
    origin: 'manual',
    createdAt: 0,
    updatedAt: 0,
    windows: counts.map((count) => ({
      state: 'normal',
      focused: false,
      groups: [],
      tabs: Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: '',
        pinned: false,
        active: i === 0,
      })),
    })),
  };
}

describe('countTabs / needsRestoreConfirm', () => {
  it('sums tabs across windows', () => {
    expect(countTabs(sessionWithTabs(3, 4))).toBe(7);
  });

  it('requires confirmation only above the threshold', () => {
    expect(RESTORE_CONFIRM_THRESHOLD).toBe(100);
    expect(needsRestoreConfirm(sessionWithTabs(100))).toBe(false);
    expect(needsRestoreConfirm(sessionWithTabs(50, 51))).toBe(true);
  });
});

describe('formatRestoreSummary', () => {
  it('reports a clean restore', () => {
    expect(formatRestoreSummary({ restored: 5, skipped: [], errors: [] }, 5)).toBe(
      'Restored 5 of 5 tabs',
    );
  });

  it('reports skipped and failed tabs', () => {
    const result = {
      restored: 410,
      skipped: ['file:///a', 'javascript:void(0)'],
      errors: [{ url: 'https://x', message: 'boom' }],
    };
    expect(formatRestoreSummary(result, 413)).toBe(
      'Restored 410 of 413 tabs · 2 skipped · 1 could not be opened',
    );
  });

  it('uses singular forms', () => {
    expect(formatRestoreSummary({ restored: 0, skipped: ['a'], errors: [] }, 1)).toBe(
      'Restored 0 of 1 tab · 1 skipped',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/dashboard/lib/restore-summary.test.ts`
Expected: FAIL with `Failed to resolve import "./restore-summary"`.

- [ ] **Step 3: Implement the pure helper**

`src/dashboard/lib/restore-summary.ts`:

```ts
import type { RestoreResult } from '@/sessions/restore';
import type { Session } from '@/types';

/** Spec §6: confirm (with the lazy checkbox) when a restore would open more than 100 tabs. */
export const RESTORE_CONFIRM_THRESHOLD = 100;

export function countTabs(session: Session): number {
  return session.windows.reduce((sum, window) => sum + window.tabs.length, 0);
}

export function needsRestoreConfirm(session: Session): boolean {
  return countTabs(session) > RESTORE_CONFIRM_THRESHOLD;
}

export function formatRestoreSummary(result: RestoreResult, total: number): string {
  const parts = [`Restored ${result.restored} of ${total} ${total === 1 ? 'tab' : 'tabs'}`];
  if (result.skipped.length > 0) {
    parts.push(`${result.skipped.length} skipped`);
  }
  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} could not be opened`);
  }
  return parts.join(' · ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/dashboard/lib/restore-summary.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/lib/restore-summary.ts src/dashboard/lib/restore-summary.test.ts
git commit -m "feat(sessions): restore summary and confirm-threshold helpers"
```

- [ ] **Step 6: Implement `useRestore`**

`src/dashboard/hooks/useRestore.ts`:

```ts
import { loadSanitizeOptions } from '@/dashboard/lib/sanitize-options';
import {
  executeRestore,
  planRestore,
  type RestoreResult,
  type RestoreTarget,
} from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface RestoreProgress {
  done: number;
  total: number;
}

export interface UseRestore {
  /**
   * Plans and executes a restore in this page. Resolves to `undefined` when a restore is
   * already running. `lazyOverride` comes from the confirm dialog's checkbox.
   */
  restore(
    session: Session,
    target: RestoreTarget,
    lazyOverride?: SessionSettings['restoreLazy'],
  ): Promise<RestoreResult | undefined>;
  progress?: RestoreProgress;
  running: boolean;
  cancel(): void;
  lastResult?: RestoreResult;
  dismiss(): void;
}

export function useRestore(): UseRestore {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | undefined>(undefined);
  const [lastResult, setLastResult] = useState<RestoreResult | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  // Spec §5: warn before leaving the page while a restore is in flight.
  useEffect(() => {
    if (!running) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [running]);

  const restore = useCallback<UseRestore['restore']>(async (session, target, lazyOverride) => {
    if (controllerRef.current !== null) {
      return undefined;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setLastResult(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const [settings, sanitize] = await Promise.all([
        sessionRepo.getSettings(),
        loadSanitizeOptions(),
      ]);
      const plan = planRestore(session, {
        target,
        lazy: lazyOverride ?? settings.restoreLazy,
        sanitize,
      });
      setProgress({ done: 0, total: plan.totalTabs });
      const result = await executeRestore(plan, {
        onProgress: (done, total) => setProgress({ done, total }),
        signal: controller.signal,
        screen: { availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
      });
      setLastResult(result);
      return result;
    } finally {
      controllerRef.current = null;
      setProgress(undefined);
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    setLastResult(undefined);
  }, []);

  return { restore, progress, running, cancel, lastResult, dismiss };
}
```

- [ ] **Step 7: Write `ProgressToast` and `RestoreConfirmDialog`**

`src/dashboard/components/ProgressToast.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { formatRestoreSummary } from '@/dashboard/lib/restore-summary';
import type { RestoreResult } from '@/sessions/restore';
import { LoaderCircle, X } from 'lucide-react';

export interface ProgressToastProps {
  progress?: { done: number; total: number };
  result?: RestoreResult;
  onCancel(): void;
  onDismiss(): void;
}

export function ProgressToast({ progress, result, onCancel, onDismiss }: ProgressToastProps) {
  if (progress === undefined && result === undefined) {
    return null;
  }

  return (
    <output
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-4 shadow-lg"
    >
      {progress !== undefined && (
        <div className="flex items-center gap-3">
          <LoaderCircle className="size-4 animate-spin" />
          <div className="flex-1 text-sm">
            Restoring {progress.done} of {progress.total} tabs…
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {progress === undefined && result !== undefined && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm">
            <p>{formatRestoreSummary(result, result.restored + result.skipped.length + result.errors.length)}</p>
            {(result.skipped.length > 0 || result.errors.length > 0) && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                {result.skipped.map((url) => (
                  <li key={`skipped-${url}`} className="truncate" title={url}>
                    Skipped: {url}
                  </li>
                ))}
                {result.errors.map((entry) => (
                  <li key={`error-${entry.url}`} className="truncate" title={entry.message}>
                    Failed: {entry.url} — {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
            <X />
          </Button>
        </div>
      )}
    </output>
  );
}
```

`src/dashboard/components/RestoreConfirmDialog.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { countTabs } from '@/dashboard/lib/restore-summary';
import type { RestoreTarget } from '@/sessions/restore';
import type { Session, SessionSettings } from '@/types';
import { useState } from 'react';

export interface PendingRestore {
  session: Session;
  target: RestoreTarget;
}

export interface RestoreConfirmDialogProps {
  pending?: PendingRestore;
  onConfirm(lazy: SessionSettings['restoreLazy']): void;
  onCancel(): void;
}

export function RestoreConfirmDialog({ pending, onConfirm, onCancel }: RestoreConfirmDialogProps) {
  const [lazy, setLazy] = useState(true);
  const tabCount = pending === undefined ? 0 : countTabs(pending.session);

  return (
    <Dialog
      open={pending !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore {tabCount} tabs?</DialogTitle>
          <DialogDescription>
            {pending?.session.name ?? ''} will open {pending?.session.windows.length ?? 0}{' '}
            {pending !== undefined && pending.session.windows.length === 1 ? 'window' : 'windows'}.
            Large restores can take a while and use a lot of memory.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <input
            id="restore-lazy"
            type="checkbox"
            className="size-4"
            checked={lazy}
            onChange={(event) => setLazy(event.target.checked)}
          />
          <Label htmlFor="restore-lazy">Load tabs lazily (recommended — tabs load when clicked)</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(lazy ? 'always' : 'never')}>Restore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Rewire `Dashboard` to `useRestore`**

Replace `src/dashboard/Dashboard.tsx` with this full file (differences from T11: no direct `planRestore`/`executeRestore`; `useRestore`, `RestoreConfirmDialog`, `ProgressToast`):

```tsx
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ProgressToast } from '@/dashboard/components/ProgressToast';
import { type PendingRestore, RestoreConfirmDialog } from '@/dashboard/components/RestoreConfirmDialog';
import { SessionCard } from '@/dashboard/components/SessionCard';
import { useRestore } from '@/dashboard/hooks/useRestore';
import { useSessionIndex } from '@/dashboard/hooks/useSessionIndex';
import { errorMessage } from '@/dashboard/lib/errors';
import { needsRestoreConfirm } from '@/dashboard/lib/restore-summary';
import { pickWindow } from '@/dashboard/lib/session-utils';
import { captureSession } from '@/sessions/capture';
import type { RestoreTarget } from '@/sessions/restore';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSettings } from '@/types';
import { Layers, Save } from 'lucide-react';
import { useState } from 'react';

type SaveScope = 'window' | 'all';

const NEW_WINDOWS: RestoreTarget = { kind: 'newWindows' };

export function Dashboard() {
  const { sessions, loading, error: indexError } = useSessionIndex();
  const { restore, progress, running, cancel, lastResult, dismiss } = useRestore();
  const [saving, setSaving] = useState<SaveScope | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingRestore | undefined>(undefined);

  const save = async (scope: SaveScope) => {
    setSaving(scope);
    setError(undefined);
    setNotice(undefined);
    try {
      const session = await captureSession(scope);
      if (session.windows.length === 0) {
        setNotice('Nothing to save — this window only contains the Sessions dashboard.');
        return;
      }
      await sessionRepo.put(session);
      setNotice(`Saved “${session.name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(undefined);
    }
  };

  const runRestore = async (
    session: Session,
    target: RestoreTarget,
    lazy?: SessionSettings['restoreLazy'],
  ) => {
    setError(undefined);
    setNotice(undefined);
    try {
      await restore(session, target, lazy);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const requestRestore = (session: Session, target: RestoreTarget) => {
    if (running) {
      setNotice('A restore is already running.');
      return;
    }
    if (needsRestoreConfirm(session)) {
      setPending({ session, target });
      return;
    }
    void runRestore(session, target);
  };

  const confirmRestore = (lazy: SessionSettings['restoreLazy']) => {
    if (pending === undefined) {
      return;
    }
    setPending(undefined);
    void runRestore(pending.session, pending.target, lazy);
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-wide text-primary uppercase">Sessions</h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void save('window')}
            disabled={saving !== undefined}
          >
            <Save />
            Save this window
          </Button>
          <Button size="sm" onClick={() => void save('all')} disabled={saving !== undefined}>
            <Layers />
            Save all windows
          </Button>
        </div>
      </header>

      <Separator className="my-4" />

      {notice !== undefined && (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{notice}</p>
      )}
      {(error ?? indexError) !== undefined && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? indexError}
        </p>
      )}

      <main>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((summary) => (
              <SessionCard
                key={summary.id}
                summary={summary}
                onRestore={(session) => requestRestore(session, NEW_WINDOWS)}
                onRestoreWindow={(session, windowIndex) =>
                  requestRestore(pickWindow(session, windowIndex), NEW_WINDOWS)
                }
              />
            ))}
          </ul>
        )}
      </main>

      <RestoreConfirmDialog
        pending={pending}
        onConfirm={confirmRestore}
        onCancel={() => setPending(undefined)}
      />
      <ProgressToast progress={progress} result={lastResult} onCancel={cancel} onDismiss={dismiss} />
    </div>
  );
}
```

- [ ] **Step 9: Typecheck, format, tests, build**

Run: `pnpm typecheck && pnpm format && pnpm exec vitest run && pnpm build`
Expected: all green.

- [ ] **Step 10: Manual verification in Chrome**

1. Reload the unpacked extension. Save a small session (3 tabs) and click **Restore**: a toast appears bottom-right "Restoring 0 of 3 tabs…" with a progress bar, then switches to "Restored 3 of 3 tabs" with an X; click X → the toast disappears.
2. Fixture with skips: in a window open `about:blank`, then in its address bar go to `file:///` (file access is OFF by default for the extension), plus `https://example.com`. Save it, restore it. Expected toast: `Restored 2 of 3 tabs · 1 skipped` with a line `Skipped: file:///`. (`about:blank` is allowed.)
3. Large restore + confirm: build a 120-tab session — open the DevTools console on the dashboard page and run:
   ```js
   const s = { schemaVersion: 1, id: crypto.randomUUID(), kind: 'saved', name: 'Big', origin: 'manual',
     createdAt: Date.now(), updatedAt: Date.now(),
     windows: [{ state: 'normal', focused: true, groups: [], tabs: Array.from({ length: 120 }, (_, i) =>
       ({ url: 'https://example.com/?n=' + i, title: 'Tab ' + i, pinned: false, active: i === 0 })) }] };
   await chrome.storage.local.set({ ['session:' + s.id]: s });
   ```
   Then click the dashboard's **Save this window** and immediately delete that new session — the reconcile on the next dashboard load re-indexes "Big" (or simply reload the dashboard tab: `useSessionIndex` runs `reconcile()` on mount and "Big" appears with `1 window · 120 tabs`).
4. Click **Restore** on "Big". Expected: dialog "Restore 120 tabs?" with the checkbox "Load tabs lazily" checked. Click **Cancel** → nothing opens. Click **Restore** again → **Restore** in the dialog: a new window fills with tabs in chunks of 25; the toast progress advances 25 → 50 → …; while it runs, try closing the dashboard tab → Chrome shows the "Leave site?" prompt (beforeunload); choose Cancel. In the new window, tabs other than the active one are discarded (greyed, `chrome://discards` lists them as discarded).
5. Cancel: restore "Big" again and click **Cancel** on the toast after the first chunk. Expected: the toast reports `Restored 25 of 25 tabs` (the summary counts created + skipped + failed tabs; tabs never attempted after Cancel are not counted; created tabs stay open) and the session still exists.
6. Uncheck the lazy checkbox and restore: tabs load eagerly (not discarded).
7. Start a restore and click **Restore** on another card while it runs: the notice "A restore is already running." appears and nothing else starts.
8. After the toast is dismissed and no restore runs, closing the dashboard tab shows no prompt.

- [ ] **Step 11: Commit**

```bash
git add src/dashboard
git commit -m "feat(sessions): useRestore with progress toast, confirm dialog and beforeunload guard"
```

---

### Task 14: Options "Sessions" card + dashboard empty state

**Files:**

- Create: `src/dashboard/components/EmptyState.tsx`
- Create: `src/sessions/shortcuts.ts` (shared by the dashboard empty state and the Options page, like `open-dashboard.ts`; the options bundle must not import from `src/dashboard/`)
- Modify: `src/dashboard/Dashboard.tsx` (render `EmptyState` instead of the plain "No saved sessions yet." text)
- Modify: `src/options/Options.tsx` (add a "Sessions" section with "Open Sessions dashboard" and "Set keyboard shortcuts")
- Test: `src/sessions/shortcuts.test.ts`

**Interfaces:**

- Consumes: `openDashboard()` (`@/sessions/open-dashboard`, T9); `Button` (`@/components/ui/button`); `getChromeFake()`.
- Produces: `SHORTCUTS_URL = 'chrome://extensions/shortcuts'`, `openShortcutSettings(): Promise<void>` (`@/sessions/shortcuts`); `EmptyState` props `{ onSaveWindow(): void; onSaveAll(): void; saving: boolean }`.

- [ ] **Step 1: Write the failing test**

`src/sessions/shortcuts.test.ts`:

```ts
import { getChromeFake } from '@/test/chrome-fake';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS_URL, openShortcutSettings } from './shortcuts';

describe('openShortcutSettings', () => {
  it('opens chrome://extensions/shortcuts in a new tab', async () => {
    const fake = getChromeFake();
    await openShortcutSettings();
    expect(SHORTCUTS_URL).toBe('chrome://extensions/shortcuts');
    expect(fake.state.createdTabs).toEqual([{ url: SHORTCUTS_URL }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/sessions/shortcuts.test.ts`
Expected: FAIL with `Failed to resolve import "./shortcuts"`.

- [ ] **Step 3: Implement the helper**

`src/sessions/shortcuts.ts`:

```ts
/** Spec §2: chrome://extensions/shortcuts may be opened from extension pages via tabs.create. */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

export async function openShortcutSettings(): Promise<void> {
  await chrome.tabs.create({ url: SHORTCUTS_URL });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/sessions/shortcuts.test.ts`
Expected: PASS (the T2 fake pushes the `CreateProperties` object verbatim, so `toEqual` matches exactly).

- [ ] **Step 5: Write `EmptyState` and use it in `Dashboard`**

`src/dashboard/components/EmptyState.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { openShortcutSettings } from '@/sessions/shortcuts';
import { FolderOpen, Keyboard, Layers, MousePointerClick, Save } from 'lucide-react';

export interface EmptyStateProps {
  onSaveWindow(): void;
  onSaveAll(): void;
  saving: boolean;
}

export function EmptyState({ onSaveWindow, onSaveAll, saving }: EmptyStateProps) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center">
      <FolderOpen className="size-10 text-muted-foreground" />
      <div>
        <h2 className="text-base font-medium">No saved sessions yet</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          A session is a snapshot of your windows, tabs and tab groups, stored only on this device.
          Save one now, or later from anywhere:
        </p>
      </div>
      <ul className="max-w-md space-y-2 text-left text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <MousePointerClick className="mt-0.5 size-4 shrink-0" />
          <span>
            Right-click the Tab Organizer icon → <strong>Save this window as session</strong> or{' '}
            <strong>Save all windows as session</strong>. A ✓ badge confirms the save.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Keyboard className="mt-0.5 size-4 shrink-0" />
          <span>
            Assign keyboard shortcuts for “Save the current window as a session” and “Open the
            Sessions dashboard”.
          </span>
        </li>
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onSaveWindow} disabled={saving}>
          <Save />
          Save this window
        </Button>
        <Button size="sm" onClick={onSaveAll} disabled={saving}>
          <Layers />
          Save all windows
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void openShortcutSettings()}>
          <Keyboard />
          Set keyboard shortcuts
        </Button>
      </div>
    </section>
  );
}
```

In `src/dashboard/Dashboard.tsx` make exactly these two edits:

1. Add the import (keep imports alphabetised — `pnpm format` will reorder):

```tsx
import { EmptyState } from '@/dashboard/components/EmptyState';
```

2. Replace the line

```tsx
          <p className="text-sm text-muted-foreground">No saved sessions yet.</p>
```

with

```tsx
          <EmptyState
            onSaveWindow={() => void save('window')}
            onSaveAll={() => void save('all')}
            saving={saving !== undefined}
          />
```

- [ ] **Step 6: Add the "Sessions" card to the Options page**

Replace `src/options/Options.tsx` with this full file (only additions: the `openDashboard`/`openShortcutSettings`/icon imports and the new `<section>` between the "Duplicate Tabs" section and the Save button; everything else byte-for-byte as before):

```tsx
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { openDashboard } from '@/sessions/open-dashboard';
import { openShortcutSettings } from '@/sessions/shortcuts';
import type { DuplicateTabHandling, GroupingMode } from '@/types';
import { FolderOpen, Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';

function isDuplicateTabHandling(value: string): value is DuplicateTabHandling {
  return value === 'none' || value === 'closeAllButOne' || value === 'group';
}

function isGroupingMode(value: string): value is GroupingMode {
  return value === 'subdomain' || value === 'domain';
}

export const Options = () => {
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateTabHandling>('none');
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('subdomain');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get<{
      duplicateTabHandling: DuplicateTabHandling;
      groupingMode: GroupingMode;
    }>(['duplicateTabHandling', 'groupingMode'], (result) => {
      if (result.duplicateTabHandling) {
        setDuplicateHandling(result.duplicateTabHandling);
      }
      if (result.groupingMode) {
        setGroupingMode(result.groupingMode);
      }
    });
  }, []);

  const handleSave = () => {
    chrome.storage.sync.set({ duplicateTabHandling: duplicateHandling, groupingMode }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleDuplicateChange = (value: string) => {
    if (isDuplicateTabHandling(value)) {
      setDuplicateHandling(value);
    }
  };

  const handleGroupingChange = (value: string) => {
    if (isGroupingMode(value)) {
      setGroupingMode(value);
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h3 className="text-center text-lg font-semibold tracking-wide text-primary uppercase">
        Tab Organizer
      </h3>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Tab Grouping</h4>
          <p className="text-xs text-muted-foreground">How should tabs be grouped when sorting?</p>
        </div>

        <RadioGroup value={groupingMode} onValueChange={handleGroupingChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="subdomain" id="subdomain" />
              <Label htmlFor="subdomain">Group by full hostname (subdomain)</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are separated into different groups
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="domain" id="domain" />
              <Label htmlFor="domain">Group by domain only</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are merged into one google.com group
            </p>
          </div>
        </RadioGroup>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Duplicate Tabs</h4>
          <p className="text-xs text-muted-foreground">
            How should tabs with the same URL be handled?
          </p>
        </div>

        <RadioGroup value={duplicateHandling} onValueChange={handleDuplicateChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="none" />
              <Label htmlFor="none">Do nothing</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are left as they are
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="closeAllButOne" id="closeAllButOne" />
              <Label htmlFor="closeAllButOne">Keep one, close the rest</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Only the active (or first) tab is kept; all other duplicates are closed automatically
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="group" id="group" />
              <Label htmlFor="group">Group into tab group</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are grouped together so you can review and close them manually
            </p>
          </div>
        </RadioGroup>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h4 className="text-sm font-medium">Sessions</h4>
          <p className="text-xs text-muted-foreground">
            Save and restore windows, tabs and tab groups. Sessions are stored only on this device.
            You can also save from the icon's right-click menu.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void openDashboard()}>
            <FolderOpen />
            Open Sessions dashboard
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openShortcutSettings()}>
            <Keyboard />
            Set keyboard shortcuts
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2">
        <Button size="lg" className="w-full" onClick={handleSave}>
          Save
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>

      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>v{chrome.runtime.getManifest().version}</span>
        <a
          href="https://github.com/thilllon/tab-organizer"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          GitHub
        </a>
      </p>
    </main>
  );
};
```

- [ ] **Step 7: Typecheck, format, tests, build**

Run: `pnpm typecheck && pnpm format && pnpm exec vitest run && pnpm build`
Expected: all green; `dist/options.html` and `dist/dashboard.html` both emitted.

- [ ] **Step 8: Manual verification in Chrome**

1. Reload the unpacked extension. Delete every session from the dashboard (or DevTools → Application → Extension storage → Local → clear). Reload the dashboard tab. Expected: a dashed-border empty-state box with a folder icon, "No saved sessions yet", the two hints (right-click menu with the exact item names, keyboard shortcuts), and three buttons: "Save this window", "Save all windows", "Set keyboard shortcuts".
2. Click **Set keyboard shortcuts**: a new active tab opens at `chrome://extensions/shortcuts` listing "Tab Organizer" with the two unbound commands "Save the current window as a session" and "Open the Sessions dashboard". (Reproduced from the Options page too, see step 5.)
3. Back on the dashboard click the empty state's **Save this window**: the empty state is replaced by a session card (no reload needed).
4. Open the options page (`chrome://extensions` → Tab Organizer → Details → Extension options). Expected: a bordered "Sessions" card between "Duplicate Tabs" and the big **Save** button, with the buttons "Open Sessions dashboard" and "Set keyboard shortcuts".
5. Click **Open Sessions dashboard**: if a dashboard tab exists it is focused (no second dashboard tab is created — count tabs before/after), otherwise a new one opens. Click **Set keyboard shortcuts**: same result as step 2.
6. Change "Duplicate Tabs" and click **Save** → "Saved" still appears (sort settings path untouched).

- [ ] **Step 9: Commit**

```bash
git add src/dashboard src/sessions/shortcuts.ts src/sessions/shortcuts.test.ts src/options/Options.tsx
git commit -m "feat(sessions): options Sessions card and dashboard empty state"
```

## Tasks 15–16 — Docs, manual QA, push

Context for both tasks: everything from T1–T14 is committed on `feat/sessions`. The manifest now declares `permissions: ['tabs','tabGroups','storage','contextMenus','unlimitedStorage','favicon']` and two unbound `commands`. Nothing below touches `src/`. All three documents edited in T15 are Markdown formatted by **Prettier** (not Biome) — run `pnpm format` before committing and let it rewrite tables.

Two repo facts that matter here:

1. `docs/README.md` is the Chrome Web Store listing source. Its `### Description` section is converted to `docs/description.txt` by `pnpm listing` (`scripts/build-listing.ts`): `####` headings become UPPER-CASE section titles, `#####` headings become `▸` feature titles, list items become `•` bullets. **Never edit `docs/description.txt` by hand** — the pre-commit `listing` hook regenerates and auto-stages it whenever `docs/README.md` is staged, and CI fails if it is stale. So T15 touches `docs/README.md` only, and the diff you see in `docs/description.txt` after the commit is expected.
2. The pre-push `update-docs` hook runs `claude -p` and **amends the last commit** whenever `src/**` changed in `HEAD~1..HEAD`. On this branch we do a deliberate docs pass (T15) instead, so every push is `LEFTHOOK_EXCLUDE=update-docs git push …` (spec §12).

Why the store text describes automatic snapshots although Phase 1 has no `alarms` permission: the first store release is v7.0.0 after Phase 5 (spec §12, §15), and history is ON by default (spec §15.1). `docs/README.md` is the listing for that release, so it is written for v7.0.0 now (spec §10 "History being on by default must be disclosed up front"). The `alarms` row in the justifications table says "added in Phase 3" so nobody is confused by the Phase 1 manifest. `PRIVACY_POLICY.md` and `AGENTS.md` describe the code as it is on this branch plus a clearly-labelled Phase 3 note.

---

### Task 15: Docs — `docs/README.md`, `PRIVACY_POLICY.md`, `AGENTS.md`, `README.md`

`docs/README.md` is the FUTURE v7.0.0 listing (owner decision); do not publish it to the store before the v7.0.0 release. `PRIVACY_POLICY.md` describes the branch as built after Phase 1 (no export, no "Delete all session data", no snapshot retention); only the `alarms` bullet carries a clearly-labelled "(from version 7.0.0, Phase 3)" note.

**Files:**

- Modify: `docs/README.md` (Description: hero, "How it works" line, new "Sessions" feature section, Privacy & Security bullets, FAQ entries; Privacy: single purpose, permission justifications table, data usage)
- Modify: `PRIVACY_POLICY.md` (full rewrite: Data Collection, Permissions, Data Usage, new Data Retention, Last Updated)
- Modify: `AGENTS.md` (Project Overview, Runtime Model, Data Flow, Directory Structure, Key Source Files, `vite.config.ts` permissions line, Permissions Explained, Storage Schema, new Sessions Rules, Testing, Common Tasks, Gotchas)
- Modify: `README.md` (root: tagline, Features table, Privacy bullets — the places that repeat "three permissions")
- Generated (do not edit): `docs/description.txt` via the pre-commit hook

**Interfaces:**

- Consumes: manifest permissions and commands from T10; `sessionRepo`, `withLock`, `LOCK_NAME`, storage keys `sessionIndex` / `sessionSettings` / `historyMeta` / `session:<id>` from T6; `openDashboard()` from T9; `MENU_IDS` from T9; `src/test/chrome-fake.ts` / `getChromeFake()` from T2.
- Produces: nothing code-facing. T16 links to the QA checklist that lives in the PR description; the release-prep step (spec §12) reuses this listing text.

- [ ] **Step 1: Confirm the manifest actually has what the docs will claim**

Run:

```bash
cd /Users/thilllon/git/tab-organizer
grep -n "permissions\|commands\|save-session\|open-dashboard" vite.config.ts
```

Expected: one `permissions:` line containing exactly `'tabs', 'tabGroups', 'storage', 'contextMenus', 'unlimitedStorage', 'favicon'` and a `commands` object with `'save-session'` and `'open-dashboard'`, both without `suggested_key`. If `alarms` is present, T10 overshot — remove it (Phase 3 adds it). If anything else differs, fix T10 first; the docs must match the manifest in the same PR (spec §10).

- [ ] **Step 2: Edit `docs/README.md` — Description hero and "How it works"**

Replace the block that begins `Tab Organizer — One-Click Tab Sorting & Grouping for Chrome` and ends with the line `After sorting, duplicate tabs are handled according to your preference.` with the following (exact text):

```markdown
Tab Organizer — One-Click Tab Sorting + a Full Session Manager for Chrome

Tired of dozens of messy, unorganized tabs cluttering your browser? Tab Organizer instantly sorts and groups all your tabs with a single click. No popup, no complicated setup, no account required, no data ever leaves your browser.

Just pin the extension icon to your toolbar and click it. That's it. Your tabs are instantly organized.

Need to put a project away for later? Right-click the icon → Save session / Open Sessions. Tab Organizer saves every window, tab, pinned tab and tab group exactly as it is, and restores it later with one click. It also keeps automatic snapshots of your open windows every 5 minutes so you can recover after a crash — snapshots are stored only on this device, are never uploaded, and can be turned off in Options at any time.

#### How it works

Click the Tab Organizer icon in your toolbar. Every tab in your current window is immediately sorted and organized. There's no popup, no extra steps — one click and you're done.

Right-click the icon for everything else: "Save this window as session", "Save all windows as session" and "Open Sessions" (the full-page dashboard where saved sessions are listed and restored). A ✓ badge on the icon confirms a save.

Tab Organizer handles three types of tabs independently:

- Pinned tabs (optionally sorted)
- Tab groups (sorted by group name, then tabs within each group are sorted)
- Ungrouped tabs (sorted and optionally grouped by website)

After sorting, duplicate tabs are handled according to your preference.
```

- [ ] **Step 3: Edit `docs/README.md` — add the SESSIONS section**

Insert the following block immediately **before** the existing `#### Settings` heading (i.e. after the `##### Preserve Order Within Groups` paragraph). The `####` heading becomes `SESSIONS` in `description.txt`; each `#####` becomes a `▸` feature title.

```markdown
#### Sessions

Save what you have open, close it, and bring it all back later — Session Buddy-style, with nothing leaving your computer.

##### Save a Session in One Action

Right-click the Tab Organizer icon and choose "Save this window as session" or "Save all windows as session". Every window is captured with its tabs in order, pinned tabs, the active tab, tab groups (name, color, collapsed state) and window size. Tabs suspended by The Marvellous Suspender are saved by their real URL. Incognito windows and empty windows are never captured. A ✓ badge on the icon confirms the save.

##### Restore Exactly

Open Sessions, pick a session and click Restore. Windows are recreated with the same tab order, pinned tabs, active tab, groups (including collapsed ones) and window state. Restore a whole session or a single window. Large restores run in chunks with a progress indicator you can cancel; sessions with more than 50 tabs are opened lazily (tabs load when you click them) so Chrome stays responsive. Pages that cannot be opened (for example javascript: or data: URLs, or file:// pages when file access is not allowed) are skipped and listed in the result — nothing else is affected.

##### Sessions Dashboard

A full-page dashboard, not a cramped popup. Rename sessions inline, expand a session to see its windows → groups → tabs with site icons, click any tab to open it in the background, delete sessions with a confirmation. Open it from the icon's right-click menu, from Options, or with a keyboard shortcut of your choice (chrome://extensions/shortcuts — no shortcut is pre-assigned so nothing conflicts with your setup).

##### Automatic Snapshots and Crash Recovery

Tab Organizer takes a snapshot of your open windows every 5 minutes (only when something changed), keeps the most recent 20, and marks the last one as "Previous session (recovered)" after Chrome restarts so you can get everything back after a crash. Snapshots live only on this device. You can change the interval, protect or delete individual snapshots, or turn snapshots off entirely — with snapshots off the extension runs only when you click it.

##### Local-First, Always

Saved sessions and snapshots are stored in Chrome's local extension storage on this device. They are not synced, not uploaded, and not readable by any web page. Delete a session and it is gone; uninstall the extension and Chrome removes everything.
```

- [ ] **Step 4: Edit `docs/README.md` — Privacy & Security bullets**

Replace the whole `#### Privacy & Security` block (from that heading through `Your browsing data stays on your device. Always.`) with:

```markdown
#### Privacy & Security

Tab Organizer is designed with privacy as a core principle:

- Zero data collection — No analytics, no tracking, no telemetry.
- Zero network requests — The extension never makes any HTTP requests. It works entirely offline.
- Only the permissions it needs, each with one job:
  - "tabs" — reads tab URLs and titles to sort them and to save sessions
  - "tabGroups" — creates and manages Chrome tab groups, and restores them from sessions
  - "storage" — saves your preferences via Chrome sync storage; saved sessions and snapshots (tab URLs, titles, group names, window layout) are kept in local storage on this device only
  - "contextMenus" — adds the Save / Open Sessions items to the icon's right-click menu
  - "unlimitedStorage" — lets large saved sessions exceed Chrome's 10 MB local quota; data stays on the device
  - "favicon" — shows site icons in the dashboard from Chrome's local favicon cache, no network
  - "alarms" — the timer for automatic snapshots (every 5 minutes by default; turn it off in Options and no timer exists)
- No content scripts — Tab Organizer never injects code into any web page.
- No background network activity — The service worker runs only when you click the icon, use its right-click menu or a keyboard shortcut — and, while automatic snapshots are on, briefly on the interval you choose. It never contacts the network.
- Open and transparent — The extension does exactly what it says, nothing more.

Your browsing data stays on your device. Always.
```

- [ ] **Step 5: Edit `docs/README.md` — FAQ entries**

Insert the following Q/A pairs into the `#### FAQ` block, directly after the existing pair `Q: Does it send my browsing data anywhere? …`. Keep the existing `\` hard-break convention.

```markdown
Q: Where are my saved sessions stored?\
A: In Chrome's local extension storage on this device only. Sessions are never synced, never uploaded and never shared with any web page. Delete a session from the dashboard whenever you like; uninstalling the extension removes all of them. Use Export (JSON) in the dashboard to keep your own backup.

Q: What do automatic snapshots record, and can I turn them off?\
A: A snapshot is the same data as a saved session — tab URLs, titles, pinned state, tab groups and window layout — taken every 5 minutes when something changed, kept as a rolling set of 20 on this device. Turn them off in Options → Sessions (or change the interval). With snapshots off, the extension only runs when you click it.

Q: How do I restore a session?\
A: Right-click the icon → Open Sessions, then click Restore on a session (or on a single window inside it). Windows are recreated in new windows with the original order, pinned tabs, groups and active tab. Restoring never deletes the saved session.

Q: Can I use a keyboard shortcut to save or open sessions?\
A: Yes. Tab Organizer registers "Save the current window as a session" and "Open the Sessions dashboard" as Chrome commands, without a preset key so nothing conflicts with your other shortcuts. Assign keys at chrome://extensions/shortcuts (there is a button for it in Options and in the empty dashboard).

Q: Does saving a session change my open tabs?\
A: No. Saving only reads your tabs. Sorting still happens only when you left-click the icon.
```

Also update the existing multi-window answer so it does not contradict the sessions feature — replace:

```markdown
Q: Does Tab Organizer work across multiple windows?\
A: Tab Organizer sorts tabs in the currently focused window. Click the icon in each window you want to organize.
```

with:

```markdown
Q: Does Tab Organizer work across multiple windows?\
A: Sorting works on the currently focused window — click the icon in each window you want to organize. Sessions can cover every window at once ("Save all windows as session").
```

- [ ] **Step 6: Edit `docs/README.md` — Privacy answers (single purpose, justifications, data usage)**

Replace the `### Single purpose` paragraph with:

```markdown
### Single purpose

Organize browser tabs: sort and group the tabs of the current window (by URL, title or domain, optionally removing or grouping duplicates) and save, list and restore sets of windows and tabs as sessions, all stored locally.
```

Replace the entire `### Permission justifications` table (keep the `Host permissions: none. Remote code: not used.` line after it) with:

```markdown
### Permission justifications

| Permission         | Justification                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`             | Required to read tab URLs and titles for sorting and for saving sessions, and to create tabs when restoring. Uses `chrome.tabs.query()`/`chrome.windows.getAll()` to read, `chrome.tabs.move()` to reorder and `chrome.tabs.create()`/`chrome.tabs.discard()` to restore. Tab data is stored only in local extension storage on the device when the user saves a session or automatic snapshots are on; it is never transmitted. |
| `tabGroups`        | Required to sort existing tab groups by title, to group duplicate tabs when the user enables that option, and to recreate a session's tab groups (title, color, collapsed state) on restore. Uses `chrome.tabGroups.query()`, `move()` and `update()`.                                                                                                                                                                 |
| `storage`          | Required to persist user preferences (sort method, grouping mode, duplicate handling) via `chrome.storage.sync`, and to store saved sessions and automatic snapshots — tab URLs, titles, pinned state, group names/colors and window layout — via `chrome.storage.local` on this device only. Session data is never synced or transmitted; the user can delete any session or all session data from the dashboard.        |
| `contextMenus`     | Adds "Save this window as session", "Save all windows as session" and "Open Sessions" to the extension icon's right-click menu (`contexts: ['action']` only — no menu items are added to web pages).                                                                                                                                                                                                                  |
| `unlimitedStorage` | Lets saved sessions and snapshots exceed the default 10 MB `chrome.storage.local` quota for users with thousands of tabs. Data stays in local extension storage on the device; nothing is uploaded.                                                                                                                                                                                                                  |
| `favicon`          | Displays site icons next to saved tabs in the dashboard by reading Chrome's local favicon cache through `chrome-extension://<id>/_favicon/`. No favicon is fetched from the network and no favicon data is stored.                                                                                                                                                                                                    |
| `alarms`           | (Added in Phase 3.) A `chrome.alarms` timer that wakes the service worker on the user's chosen interval (5/10/30 min) to take an automatic local snapshot of open windows for crash recovery. When the user turns snapshots off, no alarm exists and the worker runs only on user actions.                                                                                                                             |
```

Replace the `### Data usage` block (heading through the three certifications) with:

```markdown
### Data usage

The extension does **not** collect or transmit any user data. When the user saves a session or automatic snapshots are enabled, tab URLs, titles and window/group layout are written to `chrome.storage.local` on the user's device only; they are never sent anywhere, and the user can delete them at any time. All three certifications apply:

- Does not sell user data to third parties.
- Does not use or transfer user data for purposes unrelated to the item's core functionality.
- Does not use or transfer user data to determine creditworthiness or for lending purposes.

CWS privacy form: the "Web history" data-type row is answered with "stored locally on the device, not transmitted" (spec §10).
```

- [ ] **Step 7: Regenerate the listing text and check the result**

Run:

```bash
cd /Users/thilllon/git/tab-organizer
pnpm listing
grep -n "^SESSIONS$\|^▸ Save a Session\|contextMenus\|unlimitedStorage\|favicon\|Where are my saved sessions" docs/description.txt
grep -c "" docs/description.txt
```

Expected: `SESSIONS` on its own line, `▸ Save a Session in One Action`, one `•` bullet each for `"contextMenus"`, `"unlimitedStorage"`, `"favicon"`, and the FAQ line — all present. No `#` characters anywhere in `docs/description.txt` (`grep -c '#' docs/description.txt` prints `0`). If the Chrome Web Store 16,000-character limit matters (`wc -m docs/description.txt`), trim the Sessions prose, never the permissions list.

- [ ] **Step 8: Rewrite `PRIVACY_POLICY.md`**

Replace the whole file with:

```markdown
# Privacy Policy - Tab Organizer

Last Updated: August 29, 2026

## Overview

Tab Organizer is a Chrome extension that sorts and organizes your browser tabs and lets you save and restore sets of windows and tabs as sessions. Your privacy is important to us.

## Data Collection

Tab Organizer does **not** collect or transmit any personal data. It makes no network requests and uses no analytics, tracking or telemetry. All operations are performed locally within your browser.

When you save a session (and, from version 7.0.0 / Phase 3, while automatic snapshots are enabled — they will be on by default and can be turned off in Options), the extension stores the following about your open windows **locally on your device only**, in Chrome's extension storage (`chrome.storage.local`):

- tab URLs and page titles
- pinned state and which tab was active
- tab group names, colors and collapsed state
- window size, position and state

This data never leaves your device: it is not synced through your Google account, not uploaded to any server, and not accessible to web pages. Incognito windows are never captured.

## Permissions

This extension requires the following permissions:

- **tabs**: Used to read tab URLs and titles for sorting and for saving sessions, and to create tabs when restoring a session.
- **tabGroups**: Used to sort and organize tab groups within the current window and to recreate tab groups when restoring a session.
- **storage**: Used to save your sorting preferences using Chrome's sync storage (if you have Chrome sync enabled, these preferences may sync across your devices signed into the same Chrome account) and to store saved sessions and snapshots in local storage on this device only. Session data is never synced.
- **contextMenus**: Used to add "Save this window as session", "Save all windows as session" and "Open Sessions" to the extension icon's right-click menu. No menu items are added to web pages.
- **unlimitedStorage**: Allows large saved sessions to exceed Chrome's default local storage quota. It does not change where data is stored — everything stays on your device.
- **favicon**: Used to display site icons next to saved tabs in the Sessions dashboard from Chrome's local favicon cache. No icons are fetched from the network and no icon data is stored by the extension.
- **alarms** (from version 7.0.0, Phase 3): Used as a timer for automatic snapshots on the interval you choose. When automatic snapshots are turned off, no timer exists.

## Data Usage

- Tab URLs and titles are read during sorting and are **not** stored as part of sorting.
- When you save a session or automatic snapshots are enabled, tab URLs, titles and window/group layout are stored **only** in local extension storage on your device and are **not** transmitted to any external server.
- Sorting preferences are stored using Chrome's built-in storage API and are never shared with third parties or external servers.
- Nothing is ever sold, shared, or used for any purpose other than sorting tabs and saving/restoring sessions.

## Data Retention

- Saved sessions are kept until you delete them in the Sessions dashboard.
- Uninstalling the extension makes Chrome delete all of its stored data.

## Third-Party Services

Tab Organizer does **not** use any third-party analytics, tracking, or data collection services.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact

If you have any questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/thilllon/tab-organizer/issues).
```

- [ ] **Step 9: Update `AGENTS.md`**

Apply the following edits (each is "replace this exact block with this exact block"; keep everything not mentioned).

9a. Project Overview — replace the first paragraph:

```markdown
**Tab Organizer** is a Chrome extension (Manifest V3) that sorts and organizes browser tabs and saves/restores sets of windows and tabs as sessions. It groups tabs by hostname/domain, handles duplicate tabs, supports suspended tab detection, and keeps a local-only session store (saved sessions plus, from Phase 3, automatic history snapshots). All operations are entirely local with zero external data transmission.
```

9b. Runtime Model — replace the block from `This is a **Chrome Extension** with two execution contexts:` through `The extension icon click directly triggers sorting.` with:

```markdown
This is a **Chrome Extension** with three execution contexts:

1. **Background Service Worker** (`src/background/index.ts` + `src/background/sessions.ts`) — The core engine. Runs as a Manifest V3 service worker. `index.ts` handles tab sorting, grouping and duplicate detection, triggered by the icon click (`chrome.action.onClicked`). `sessions.ts` (imported by `index.ts` with a single `import './sessions';` line) registers, synchronously at module top level, the sessions listeners: `runtime.onInstalled` (recreate context menus, `sessionRepo.reconcile()`), `runtime.onStartup` (clear badge, reconcile), `contextMenus.onClicked` and `commands.onCommand` (save window / save all / open dashboard). The worker wakes only on those events (and, from Phase 3, on the history alarm); there are **no** `chrome.tabs.on*` / `chrome.windows.on*` / `chrome.tabGroups.on*` listeners in the worker.
2. **Options Page** (`src/options/`) — A React SPA rendered in `options.html`. Configures sort settings (`chrome.storage.sync`) and has a "Sessions" card that opens the dashboard and the Chrome shortcuts page.
3. **Sessions Dashboard** (`src/dashboard/`) — A React SPA rendered in `dashboard.html` (second Vite/crxjs HTML entry, `build.rollupOptions.input`). Lists saved sessions from the index, loads bodies on demand, renames/deletes, and **runs restores in the page** (never in the service worker, so the worker's idle/lifetime limits do not apply). It talks to `chrome.*` directly — there is no message passing to the worker. `openDashboard()` (`src/sessions/open-dashboard.ts`) is a singleton: it focuses an existing dashboard tab or creates one.

There is **no popup**, **no content script**, **no message-passing protocol** and **no external server**. The extension icon click directly triggers sorting and nothing else.
```

9c. Data Flow — replace the block from ` ```` ` fence containing `User clicks extension icon` through `Settings are persisted in \`chrome.storage.sync\` and loaded fresh on every sort invocation.` with:

```markdown
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
-> chrome.storage.local.set({ 'session:<id>': body }) // body first
-> chrome.storage.local.set({ sessionIndex }) // then index (newest first)
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
-> collapse groups -> activate -> remove placeholder -> apply minimized/fullscreen
-> ProgressToast with restored / skipped / errors

```

Settings are persisted in `chrome.storage.sync` and loaded fresh on every sort invocation. Session data lives in `chrome.storage.local` and is read through `sessionRepo` only. The dashboard reloads its list when `chrome.storage.onChanged` reports a change to `sessionIndex`.
```

9d. Directory Structure — inside the tree, replace the `src/background/` subtree and add the new folders. The `src/` part of the tree becomes:

```
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
│   │   └── components/        # SessionCard, WindowTree, GroupSection, TabRow, Favicon, ProgressToast
│   ├── options/
│   │   ├── index.tsx          # React entry point
│   │   ├── Options.tsx        # Settings UI component + "Sessions" card
│   │   └── index.css          # Tailwind CSS with shadcn theme
│   ├── components/ui/         # Reusable UI components (shadcn/ui: button, radio-group, label, input,
│   │                          #   dialog, dropdown-menu, badge, tooltip, separator, scroll-area, collapsible)
│   ├── lib/
│   │   └── utils.ts           # cn() utility (clsx + tailwind-merge)
│   ├── test/
│   │   ├── chrome-fake.ts     # Typed in-memory chrome.* fake (storage, tabs, windows, tabGroups, menus, alarms)
│   │   └── setup.ts           # vitest setupFiles: installs the fake on globalThis.chrome + navigator.locks shim
│   ├── types.ts               # Shared TypeScript types (SortSettings + Session* types)
│   └── global.d.ts            # Vite client type declarations
```

and add these two lines to the root of the tree, directly after `├── options.html               # Options page HTML entry`:

```
├── dashboard.html             # Sessions dashboard HTML entry (second rollup input)
├── docs/superpowers/specs/    # Design specs (2026-08-29-sessions-design.md is the sessions spec)
```

9e. Key Source Files — add this section after the `### src/background/sort.ts` table:

```markdown
### `src/background/sessions.ts` — Sessions listeners (service worker)

Registers listeners synchronously at module top level; imported by `index.ts`. Exports for tests: `MENU_IDS = { saveWindow: 'save-window', saveAll: 'save-all', openDashboard: 'open-dashboard' }`, `registerContextMenus()`, `handleMenuOrCommand(id)`, `showSavedBadge()`, `clearBadge()`.

| Listener                                        | Behaviour                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `runtime.onInstalled`                           | `contextMenus.removeAll()` then create the 3 menu items (idempotent); `sessionRepo.reconcile()`.                       |
| `runtime.onStartup`                             | `clearBadge()`; `sessionRepo.reconcile()`.                                                                             |
| `contextMenus.onClicked` / `commands.onCommand` | `clearBadge()`; `save-window`/`save-session` → capture current window; `save-all` → all windows; `open-dashboard`.     |

### `src/sessions/` — Session domain

| Module              | Exports                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming.ts`         | `defaultSessionName(date, windowCount, tabCount)`, `slugify(name)`                                                                                                               |
| `migrate.ts`        | `migrateSession(record)`, `migrateIndex(record)`, `UnknownSchemaVersionError` (identity for v1; unknown versions throw and the UI shows the record read-only)                     |
| `hash.ts`           | `contentHash(windows)` — titles excluded, so a title change never produces a new snapshot                                                                                        |
| `capture.ts`        | `captureWindows(windows, groups, options)` (pure), `captureSession(scope, name?)`                                                                                                |
| `storage.ts`        | `sessionRepo` (`listSummaries`, `get`, `put`, `rename`, `remove`, `removeAll`, `reconcile`, `getSettings`, `setSettings`), `withLock`, `INDEX_KEY`, `SETTINGS_KEY`, `HISTORY_META_KEY`, `sessionKey`, `LOCK_NAME` |
| `restore.ts`        | `sanitizeRestoreUrl`, `clampToScreen`, `planRestore` (pure), `executeRestore`, `withRetryOnce`, `isTabsCannotBeEditedError`                                                     |
| `open-dashboard.ts` | `openDashboard()` — focuses the existing dashboard tab or opens one                                                                                                              |
| `shortcuts.ts`      | `openShortcutSettings()` — `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })`, used by Options and the dashboard empty state                                        |
```

9f. `src/types.ts` section — after the `SortSettings` code block add:

```markdown
Session types (spec §3): `SESSION_SCHEMA_VERSION`, `SessionId`, `SessionKind` (`'saved' | 'history'`), `SessionOrigin`, `TabGroupColor`, `TabSnapshot`, `GroupSnapshot`, `WindowSnapshot`, `WindowBounds`, `Session`, `SessionSummary`, `SessionIndex`, `SessionSettings` + `DEFAULT_SESSION_SETTINGS`, `ExportFormat`, `ExportBundle`. Chrome runtime ids (tab/window/group) are never persisted; groups are referenced by index. `SortSettings` is untouched.
```

9g. `vite.config.ts` section — replace `Permissions: \`tabs\`, \`tabGroups\`, \`storage\`` with:

```markdown
Permissions: `tabs`, `tabGroups`, `storage`, `contextMenus`, `unlimitedStorage`, `favicon` (Phase 3 adds `alarms`). Commands: `save-session`, `open-dashboard` — shipped without `suggested_key`; `_execute_action` is never defined. Second HTML entry `dashboard.html` is registered via `build.rollupOptions.input` because crxjs only auto-builds manifest-referenced pages. `defineConfig` comes from `vitest/config` so `test.setupFiles: ['src/test/setup.ts']` applies.
```

9h. Chrome Extension Specifics → Manifest V3 bullets — add after `- **No content scripts**: …`:

```markdown
- **Second page**: `dashboard.html` (Sessions dashboard). Opened only through `openDashboard()` so there is ever one dashboard tab.
- **Commands**: `save-session`, `open-dashboard`, unbound by default (users assign keys at `chrome://extensions/shortcuts`).
```

9i. Permissions Explained — replace the table with:

```markdown
| Permission         | Why                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `tabs`             | Read tab URLs and titles for sorting and session capture; create/discard tabs on restore                     |
| `tabGroups`        | Create, move, and update tab groups; recreate groups on restore                                              |
| `storage`          | `chrome.storage.sync` for `SortSettings`; `chrome.storage.local` for sessions, index, session settings       |
| `contextMenus`     | "Save this window / Save all windows / Open Sessions" on the action icon (`contexts: ['action']`)            |
| `unlimitedStorage` | Sessions with thousands of tabs exceed the 10 MB local quota; data stays on the device                       |
| `favicon`          | `chrome-extension://<id>/_favicon/?pageUrl=…` in the dashboard, from Chrome's local cache — zero network     |
| `alarms` (Phase 3) | Timer for automatic history snapshots; no alarm exists while `historyEnabled` is false                       |

Every permission change must be mirrored in the same PR in `docs/README.md` (Description permissions list + Privacy justifications table), `PRIVACY_POLICY.md` (Permissions + Last Updated) and this table (spec §10).
```

9j. Storage Schema — replace the paragraph with:

```markdown
**`chrome.storage.sync`** — `SortSettings` (defaults `DEFAULT_SETTINGS` in `src/background/index.ts`) plus `installedVersion`, `newInstall`, `newUpdate` written by the existing `onInstalled` handler. Untouched by the sessions feature.

**`chrome.storage.local`** — session data, one key per record, never one big array:

| Key               | Value                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| `session:<uuid>`  | `Session` body (windows → groups/tabs)                                       |
| `sessionIndex`    | `SessionIndex` — `SessionSummary[]` newest-first by `updatedAt`, authoritative key list |
| `sessionSettings` | `SessionSettings` (device-local; defaults `DEFAULT_SESSION_SETTINGS` in `src/types.ts`) |
| `historyMeta`     | `{ lastHash, lastSnapshotAt }` (Phase 3)                                     |

Write order is body → index (put) and body → index (delete). `sessionRepo.reconcile()` (dashboard mount, `onInstalled`, `onStartup`) re-indexes orphan `session:*` bodies via `chrome.storage.local.getKeys()` (guarded fallback to `get(null)`) and drops index entries without a body.

### Sessions rules (do not break)

- **Single write path.** Every write to session keys goes through `sessionRepo` in `src/sessions/storage.ts`, which serializes with `withLock()` (`navigator.locks.request('tab-organizer:sessions', …)`, shared by the service worker and both extension pages; promise-chain fallback when Web Locks are unavailable). Never call `chrome.storage.local.set/remove` for session keys anywhere else.
- **Never add tab listeners to the service worker.** No `chrome.tabs.on*`, `chrome.windows.on*`, `chrome.tabGroups.on*` in `src/background/**` — ever. History (Phase 3) uses `chrome.alarms` only; live open-window views (Phase 2) register their listeners inside the dashboard page.
- **The icon click stays `sortTabGroups()` only.** No `default_popup`, no dialogs, no `openDashboard()` on `action.onClicked`. `sort.ts` and the duplicate handlers are not edited by session work.
- **Restore runs in the dashboard page**, never in the worker. Own extension pages are excluded from every capture.
- **No Chrome runtime ids in stored data** — groups are referenced by `groupIndex`; pinned tabs never carry `groupIndex`; at most one `active` tab per window.
```

9k. Testing — replace the sentence `Playwright is also installed, …` paragraph with these two paragraphs:

```markdown
`vite.config.ts` sets `test.setupFiles: ['src/test/setup.ts']`, which installs `createChromeFake()` from `src/test/chrome-fake.ts` on `globalThis.chrome` before every test (typed against `@types/chrome`, no `any`) and a `navigator.locks` shim. Tests reach the fake through `getChromeFake()` (`state`, `fire.installed/startup/menuClicked/command/alarm`, `failNext('tabs.create', n, message)`). Session tests live next to their modules: `src/sessions/*.test.ts` (naming, migrate, hash, capture invariants, storage order/reconcile/lock, planner chunking and step order, executeRestore against the fake) and `src/background/sessions.test.ts` (menus recreated on install, badge, handlers).

Playwright is also installed, but it is currently used by `scripts/prepare-registration.ts` to drive Chromium for release screenshots and the demo video — there are no Playwright end-to-end tests yet.
```

9l. Common Tasks — add after "### Modifying extension permissions" (and change its step 2 to the three documents):

```markdown
### Modifying extension permissions

1. Edit the `permissions` array in the `defineManifest()` call in `vite.config.ts`
2. In the same PR update `docs/README.md` (Description permissions bullets + Privacy justifications table), `PRIVACY_POLICY.md` (Permissions + Last Updated) and the Permissions Explained table above; `docs/description.txt` is regenerated by the pre-commit hook

### Adding a sessions feature

1. Put pure logic in `src/sessions/<module>.ts` with an adjacent `*.test.ts` (use `getChromeFake()` only for the thin chrome wrapper)
2. Persist through `sessionRepo` only — extend `src/sessions/storage.ts` if a new operation is needed, inside `withLock()`
3. UI goes in `src/dashboard/` (hooks under `hooks/`, components under `components/`); the service worker only gets new *event* listeners (`onInstalled`, `onStartup`, menus, commands, alarms) in `src/background/sessions.ts`
```

9m. Gotchas — append:

```markdown
- **`docs/description.txt` is generated**: edit `docs/README.md`; the pre-commit `listing` hook regenerates and stages the text file, CI diffs it.
- **Pre-push `update-docs` hook amends commits**: on feature branches push with `LEFTHOOK_EXCLUDE=update-docs git push …` and do one manual docs pass per phase.
- **`chrome.tabs.Tab.id` and `chrome.windows.Window.id/state/type/left/top/width/height` are optional** in `@types/chrome` 0.2.x — always narrow before use; never `!`. `Tab.windowId`/`groupId` are required (`-1` = no group).
- **`chrome.storage.local.getKeys()`** needs Chrome 130+; only `reconcile()` uses it, behind a `typeof … === 'function'` guard.
- **Dashboard singleton**: the sorter still moves/dedupes the dashboard tab like any tab; `openDashboard()` focusing an existing tab is what keeps "close duplicates" harmless.
```

- [ ] **Step 10: Update root `README.md` where it repeats the old claims**

Replace the tagline `<strong>One click. Every tab sorted, grouped, and de-duplicated.</strong><br />` with:

```html
<strong>One click. Every tab sorted, grouped, and de-duplicated — plus sessions you can save and restore.</strong><br />
```

Append this row to the Features table (after the `Pinned & suspended tabs` row):

```markdown
| **▸ Sessions**                | Right-click the icon → save this window or all windows; the full-page Sessions dashboard restores them exactly (order, pinned, groups, active tab). Automatic local snapshots every 5 min for crash recovery, off in one click. |
```

Replace the `## Privacy` bullets with:

```markdown
- **Zero network requests** — works entirely offline, no analytics, no telemetry.
- **Permissions** — `tabs`, `tabGroups`, `storage` (settings via Chrome sync; sessions in local storage on this device only), `contextMenus` (icon menu), `unlimitedStorage` (large sessions), `favicon` (site icons from Chrome's local cache). Automatic snapshots use `alarms` and can be turned off.
- **No content scripts** — nothing is ever injected into a web page.
- Full policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
```

- [ ] **Step 11: Format and verify**

Run:

```bash
cd /Users/thilllon/git/tab-organizer
pnpm format
pnpm listing && git diff --exit-code --stat -- docs/description.txt || echo "description.txt changed (expected on first run)"
pnpm exec prettier --check docs/README.md PRIVACY_POLICY.md AGENTS.md README.md
grep -n "three permissions\|Three permissions\|only activates when you click" docs/README.md README.md AGENTS.md PRIVACY_POLICY.md
grep -n "Last Updated" PRIVACY_POLICY.md
```

Expected: prettier prints `All matched files use Prettier code style!`; the "three permissions"/"only activates" grep prints nothing; `Last Updated: August 29, 2026`. If prettier reflowed a table you pasted, that is fine — do not fight it.

- [ ] **Step 12: Commit**

```bash
cd /Users/thilllon/git/tab-organizer
git add docs/README.md docs/description.txt PRIVACY_POLICY.md AGENTS.md README.md
git commit -m "docs(sessions): describe sessions, new permissions and local-only storage"
git show --stat HEAD
```

Expected: the commit lists exactly the five files (the pre-commit `listing` hook may re-stage `docs/description.txt`; that is the same file). If the hook rewrote something and the commit shows a sixth file, inspect with `git show HEAD --stat` and amend only if it is a formatter change.

---

### Task 16: Manual QA (Phase 1 acceptance) and branch push

**Files:**

- Create: nothing in the repo. Paste the checklist below into the PR description (Phase 1 PR onto `feat/sessions` — or the branch's draft PR onto `main`) and tick it there.
- Read-only: `dist/` (built extension), `chrome://extensions`, `chrome://serviceworker-internals`.

**Interfaces:**

- Consumes: the complete Phase 1 build (T1–T15). `MENU_IDS` ids `save-window` / `save-all` / `open-dashboard`, storage keys `session:<id>` / `sessionIndex` from the contract, `openDashboard()` behaviour from T9, `ProgressToast` copy from T13.
- Produces: a ticked checklist in the PR; the pushed branch `origin/feat/sessions`.

- [ ] **Step 1: Build a release-like bundle and load it**

```bash
cd /Users/thilllon/git/tab-organizer
pnpm typecheck && pnpm test && pnpm build
ls dist/dashboard.html dist/options.html dist/manifest.json
node -e "const m=require('./dist/manifest.json');console.log(m.version,m.permissions,Object.keys(m.commands))"
```

Expected: all three commands green; `ls` shows the three files; the node line prints the version, `[ 'tabs', 'tabGroups', 'storage', 'contextMenus', 'unlimitedStorage', 'favicon' ]` and `[ 'save-session', 'open-dashboard' ]`.

Then in Chrome: `chrome://extensions` → Developer mode on → **Remove** any previously loaded Tab Organizer (so `onInstalled` fires with `reason: 'install'` on a clean profile store) → **Load unpacked** → select `dist/`. Open the extension's "service worker" link (DevTools) and keep it open in a separate window for the console checks.

- [ ] **Step 2: Build the QA fixture window**

In a **new normal window** (call it W1) open, in this order, and then arrange:

1. `https://developer.chrome.com/docs/extensions` — **pin it**
2. `https://github.com/thilllon/tab-organizer` — **pin it**
3. `https://en.wikipedia.org/wiki/Tab_(interface)`
4. `https://en.wikipedia.org/wiki/Web_browser` — select tabs 3+4 → right-click → "Add tabs to new group" → name `Wiki`, color blue, leave **expanded**
5. `https://news.ycombinator.com/`
6. `https://example.com/` — select tabs 5+6 → new group `Reading`, color red, then click the group header to **collapse** it
7. A suspended tab: if The Marvellous Suspender is installed, suspend `https://www.mozilla.org/`. If The Marvellous Suspender is not installed, open `https://www.mozilla.org/` directly and write "no suspender" in the checklist; the tabCount below is then 9 either way.
8. `file:///etc/hosts` (macOS/Linux) — leave the extension's "Allow access to file URLs" **off** in `chrome://extensions`
9. `chrome://version/`
10. Make tab 4 (`Web_browser`) the **active** tab.

Open a **second normal window** W2 with `https://example.org/` and `https://example.net/`, and an **Incognito** window with `https://example.com/`. Focus W1 again.

- [ ] **Step 3: Phase 1 acceptance checklist (paste into the PR and tick)**

```markdown
## Phase 1 manual QA — Sessions (spec §12 Phase 1 acceptance + §13)

Build: `pnpm build` @ <commit sha>, Chrome <version>, macOS/Linux/Windows.

### Identity — the click path is untouched
- [ ] Left-click the icon in W1 → tabs are sorted/grouped exactly as before; **no** popup, **no** dialog, **no** dashboard tab opens. Repeat after Step "Save" below — still only sorts.
- [ ] `chrome://extensions` → Tab Organizer → "service worker" shows **inactive** ~30 s after the last click (no listeners keep it alive).

### Save via context menu
- [ ] Right-click the icon: menu shows exactly "Save this window as session", "Save all windows as session", a separator, "Open Sessions" (plus Chrome's own items).
- [ ] Click "Save this window as session" in W1 → a green **✓** badge appears on the icon and disappears within ~2 s on its own.
- [ ] SW console shows no errors (`[tab-organizer:sessions]`-prefixed logs are fine).
- [ ] Click "Save all windows as session" → badge again.

### Storage inspection
- [ ] In the SW console run `chrome.storage.local.get(null).then(o => console.log(Object.keys(o)))` → keys are `sessionIndex` plus exactly **two** `session:<uuid>` keys (one per save). No key holds an array of sessions.
- [ ] `chrome.storage.local.get('sessionIndex').then(o => console.table(o.sessionIndex.sessions))` → 2 rows, newest first; the "window" save has `windowCount: 1`, `tabCount: 9` (count your W1 tabs); the "all" save has `windowCount: 2` and tabCount = W1 + W2 (the Incognito window is **not** counted); `bytes` > 0; `kind: 'saved'`, `origin: 'manual'`.
- [ ] Save 8 more times (any mix) → `Object.keys` shows `sessionIndex` + **10** `session:*` keys → one key per session.

### Dashboard list
- [ ] Right-click → "Open Sessions" → `dashboard.html` opens as a **full tab** titled "Tab Organizer - Sessions".
- [ ] Right-click → "Open Sessions" again from another window → **no second dashboard tab**; the existing one is focused and its window is brought to front.
- [ ] The list shows 10 cards, newest first; each shows the default name `Session YYYY-MM-DD HH:MM · N windows · M tabs` (singular "1 window"), window count and tab count matching the storage table above.
- [ ] Expand the "window" session → W1 appears as: pinned tabs first (2, with pin marker), then group **Wiki** (blue dot, 2 tabs, expanded), then group **Reading** (red dot, 2 tabs, shown collapsed), then the remaining ungrouped tabs in strip order. Favicons render (Chrome/GitHub/Wikipedia icons); the `chrome://version` row falls back to the globe icon without console errors. The suspended tab (if any) shows `mozilla.org`, not the suspender URL.
- [ ] Expand the "all" session → 2 windows; the Incognito window is absent.
- [ ] Click a tab row → the URL opens in a **background** tab of the current window; the dashboard stays focused.

### Rename / delete
- [ ] Click the name, type `QA fixture`, press Enter → name updates immediately; reload the dashboard tab → still `QA fixture`; storage `sessionIndex` entry has `name: 'QA fixture'` and an **unchanged** `updatedAt`; the card keeps its position.
- [ ] Rename → type → click elsewhere (blur) → also saves. Esc → reverts.
- [ ] Delete one of the extra saves → confirm dialog appears; **Cancel** keeps it; Delete → card disappears; storage shows 9 `session:*` keys and 9 index entries.

### Restore fidelity
- [ ] Close W1 (keep the dashboard in W2). In the dashboard, on `QA fixture` click **Restore** → a new window opens; progress toast counts up; final toast reads `Restored 8 of 9 tabs · 1 skipped` (numbers per your fixture) with `Skipped: file:///etc/hosts`.
- [ ] In the restored window verify, left to right: the 2 pinned tabs (pinned, correct order) → group **Wiki** (title, blue, expanded, both tabs) → group **Reading** (title, red, **collapsed**) → remaining tabs in the original order; `chrome://version` is present; the suspended tab was restored as the real `https://www.mozilla.org/` URL.
- [ ] The **active** tab in the restored window is `Web_browser` (tab 4 in the fixture).
- [ ] No leftover `about:blank` placeholder tab.
- [ ] The restored window has the same size/position as the original (or clamped to the screen if the original was partly off-screen). Restore a session saved from a **maximized** window → restored window is maximized.
- [ ] The session card is still present after restore (restore never deletes).
- [ ] Expand a session and click **Restore** on a single window row → only that window is recreated.
- [ ] Enable "Allow access to file URLs" for the extension, restore again → `file:///etc/hosts` is opened, toast says `Restored 9 of 9 tabs`.

### Large session, lazy restore, cancel, beforeunload
- [ ] Open a window with **300** tabs (in the SW console: `for (let i=0;i<300;i++) chrome.tabs.create({ url: 'https://example.com/?t=' + i, active: false })`), save it, close it.
- [ ] Restore it → because tabCount > 100 a **confirm dialog** appears with the tab count and a "Load tabs lazily" checkbox (checked by default). Confirm → the progress toast advances in steps of 25; the dashboard stays responsive (scroll while it runs).
- [ ] While it runs, click **Cancel** → creation stops at the next chunk boundary; already-created tabs remain; toast reports the partial count.
- [ ] Restore again, and while it runs try to close the dashboard tab → Chrome shows the "Leave site?" (beforeunload) prompt. Cancel the close; after the restore finishes, closing the tab shows no prompt.
- [ ] In the fully restored 300-tab window, non-active tabs are **discarded** (`chrome.tabs.query({ discarded: true })` in the SW console returns ~299) and load on click; the active tab and pinned tabs are not discarded.

### Service worker lifecycle
- [ ] `chrome://serviceworker-internals` → find the Tab Organizer worker → **Stop**. Immediately right-click the icon → "Save this window as session" → badge ✓ and a new card in the dashboard (worker restarted on the event, listeners were registered at top level).
- [ ] `chrome://extensions` → **Reload** the extension → right-click the icon → the three menu items are still there, exactly once each (no duplicates after `removeAll()` + recreate).
- [ ] Quit Chrome completely and relaunch → the dashboard still lists every session (`onStartup` reconcile did not drop anything); no ✓ badge is stuck on the icon.

### Reconcile
- [ ] In the SW console: `chrome.storage.local.get('sessionIndex').then(o => chrome.storage.local.set({ sessionIndex: { ...o.sessionIndex, sessions: o.sessionIndex.sessions.slice(1) } }))` (drop the newest entry from the index only) → reload the dashboard tab → the session **reappears** (orphan body re-indexed).
- [ ] `chrome.storage.local.remove('session:<some id from the index>')` → reload the dashboard → that card is **gone** (dangling entry dropped), no error toast.

### Keyboard commands and Options
- [ ] `chrome://extensions/shortcuts` → both "Save the current window as a session" and "Open the Sessions dashboard" are listed with **no** key preassigned. Assign Ctrl+Shift+S / Ctrl+Shift+O.
- [ ] Press Ctrl+Shift+S in a normal window → badge ✓ and a new card. Press Ctrl+Shift+O → dashboard focused/opened (singleton).
- [ ] Options page → "Sessions" card → "Open Sessions dashboard" opens/focuses the dashboard; "Set keyboard shortcuts" opens `chrome://extensions/shortcuts` in a new tab.
- [ ] Delete every session → dashboard shows the **empty state** with the right-click hint and a "Set keyboard shortcuts" button that opens `chrome://extensions/shortcuts`.

### Privacy
- [ ] DevTools → Network on the dashboard page during save + restore + favicon rendering → **zero** requests to any host (only `chrome-extension://` resources).
- [ ] Incognito window contents never appear in any saved session or restore.

### Docs
- [ ] `docs/README.md`, `docs/description.txt`, `PRIVACY_POLICY.md`, `AGENTS.md`, `README.md` mention every manifest permission (`contextMenus`, `unlimitedStorage`, `favicon`) and the local-only storage of sessions. `PRIVACY_POLICY.md` Last Updated is 2026-08-29.
```

Any unticked box is a bug: fix it in its owning task (T5–T14), add a regression test where the fake can express it, commit with `fix(sessions): …`, rebuild and re-run only the affected section.

- [ ] **Step 4: Clean the QA profile leftovers (optional but polite)**

In the SW console: `chrome.storage.local.get(null).then(o => chrome.storage.local.remove(Object.keys(o).filter(k => k.startsWith('session:') || k === 'sessionIndex')))`. Close the 300-tab window.

- [ ] **Step 5: Final green run and push**

```bash
cd /Users/thilllon/git/tab-organizer
git status --short            # must be empty: everything is committed
pnpm typecheck && pnpm test && pnpm format && pnpm listing && git diff --exit-code -- docs/description.txt && pnpm build
git log --oneline main..feat/sessions
LEFTHOOK_EXCLUDE=update-docs git push -u origin feat/sessions
```

Expected: `git status` prints nothing; every command exits 0; the log shows the Phase 0/1 commits (`feat(sessions): …`, `test(sessions): …`, `docs(sessions): …`); the pre-push hook runs `typecheck`, `test` and `build` **but not** `update-docs` (lefthook prints the skipped step); push succeeds with `branch 'feat/sessions' set up to track 'origin/feat/sessions'`. If `git push` reports the branch already exists upstream and is diverged, do **not** force-push — `git pull --rebase origin feat/sessions`, re-run the green line, push again.

- [ ] **Step 6: Open the PR with the checklist**

```bash
cd /Users/thilllon/git/tab-organizer
gh pr create --base main --head feat/sessions --draft \
  --title "feat(sessions): Phase 0+1 — save, list, restore sessions" \
  --body-file /dev/stdin <<'EOF'
Implements spec docs/superpowers/specs/2026-08-29-sessions-design.md, Phases 0 and 1.

- Manifest: + contextMenus, unlimitedStorage, favicon; commands save-session / open-dashboard (unbound)
- Service worker: context menu + commands + badge + reconcile; no tab listeners
- Dashboard (dashboard.html): list, rename, delete, restore (new windows), window tree, favicons, progress toast
- Options: Sessions card
- Docs: store listing, privacy policy, AGENTS.md updated for the new permissions and local-only storage

Not a store release: v7.0.0 ships after Phase 5 (spec §12).

## Manual QA
(paste the ticked checklist from Task 16 Step 3 here)

https://claude.ai/code/session_01WTVQ1H7W98xLH1tAASToT6
EOF
```

Expected: `gh` prints the PR URL. Keep it a draft until Phase 5 unless the owner decides to merge phases into `main` early. No commit or PR body carries a `Co-Authored-By` line.
