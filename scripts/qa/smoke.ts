/**
 * Real-Chrome QA smoke test for the Sessions feature.
 *
 * Loads the built extension into a real Chromium, builds a fixture window (pinned tabs, a titled
 * coloured group, a collapsed group), then drives the dashboard end to end: save all windows →
 * expand the card → restore → rename → delete, verifying each result through the extension's own
 * `chrome.tabs` / `chrome.tabGroups` APIs rather than through the UI it just clicked.
 *
 * Run it (a `pnpm build` must have produced `dist/` first):
 *
 *     pnpm build && pnpm exec tsx scripts/qa/smoke.ts
 *
 * Environment flags:
 *   PW_CHROMIUM=/path/to/chrome   Chromium binary to drive. Defaults to `/opt/pw-browsers/chromium`
 *                                 when that exists, otherwise Playwright's own pinned build.
 *   HEADLESS=0                    Run headed (needs a display). Default is headless — extensions
 *                                 do load in headless Chrome.
 *   SMOKE_TIMEOUT_MS=85000        Watchdog for the whole run; the process exits 1 when it fires.
 *   SMOKE_KEEP_OPEN=1             Leave the browser open after the run (debugging).
 *
 * Output is one `PASS` / `FAIL` line per step with details; the process exits 1 if any step
 * failed. Steps run in order and later steps depend on earlier ones, so the first failure stops
 * the run and the rest are reported as `SKIP`.
 *
 * Adding coverage (history, search, export, import): append a `Step` to `STEPS` and hang whatever
 * it needs off `Context`. Keep locators role/accessible-name based.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { type ExtensionSession, launchExtension } from './browser';
import { type DemoServer, startDemoServer } from './server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');

const WATCHDOG_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 85_000);
const UI_TIMEOUT = 15_000;
const RENAMED = 'QA smoke — renamed session';

/* ------------------------------------------------------------------ fixtures */

/** The window the test builds and then saves/restores. Index order is tab-strip order. */
interface FixtureTab {
  /** Index into the demo server's page list. */
  page: number;
  pinned: boolean;
  group?: string;
}

interface FixtureGroup {
  title: string;
  color: string;
  collapsed: boolean;
}

const FIXTURE_GROUPS: FixtureGroup[] = [
  { title: 'Review', color: 'blue', collapsed: false },
  { title: 'Archive', color: 'red', collapsed: true },
];

const FIXTURE_TABS: FixtureTab[] = [
  { page: 0, pinned: true },
  { page: 1, pinned: true },
  { page: 2, pinned: false, group: 'Review' },
  { page: 3, pinned: false, group: 'Review' },
  { page: 4, pinned: false, group: 'Archive' },
  { page: 5, pinned: false, group: 'Archive' },
];

/* ------------------------------------------------------------------ context */

interface RestoredTab {
  url: string;
  pinned: boolean;
  group: string | null;
}

interface RestoredGroup {
  title: string;
  color: string;
  collapsed: boolean;
}

interface Context {
  server?: DemoServer;
  ext?: ExtensionSession;
  page?: Page;
  /** Chrome window id of the fixture window. */
  fixtureWindowId?: number;
  /** Chrome window id the dashboard sits in. */
  dashboardWindowId?: number;
  /** Window ids that existed just before the restore was triggered. */
  windowIdsBeforeRestore?: number[];
  /** Absolute urls of the fixture tabs, in tab-strip order. */
  fixtureUrls?: string[];
  card?: Locator;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`internal: ${what} is not set yet`);
  }
  return value;
}

/* ------------------------------------------------------------------ assertions */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSame(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${what}\n      expected: ${b}\n      actual:   ${a}`);
}

/* ------------------------------------------------------------------ helpers */

/** The dashboard's session cards (`<main><ul><li>`), one per saved session. */
function cards(page: Page): Locator {
  return page.locator('main > ul > li');
}

/** `<header>` at the top of the dashboard: role `banner`. Scoped, because the empty state
 *  renders buttons with the same labels. */
function header(page: Page): Locator {
  return page.getByRole('banner');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Reads the tab strip + groups of one window through the extension service worker. */
async function readWindow(
  ext: ExtensionSession,
  windowId: number,
): Promise<{ tabs: RestoredTab[]; groups: RestoredGroup[] }> {
  const worker = await ext.worker();
  return worker.evaluate(async (id: number) => {
    const tabs = (await chrome.tabs.query({ windowId: id })).sort((a, b) => a.index - b.index);
    const groups = await chrome.tabGroups.query({ windowId: id });
    const byId = new Map(groups.map((group) => [group.id, group]));
    const seen: number[] = [];
    const rows = tabs.map((tab) => {
      const group =
        tab.groupId !== undefined && tab.groupId !== -1 ? byId.get(tab.groupId) : undefined;
      if (group !== undefined && !seen.includes(group.id)) {
        seen.push(group.id);
      }
      return {
        url: tab.url !== undefined && tab.url !== '' ? tab.url : (tab.pendingUrl ?? ''),
        pinned: tab.pinned,
        group: group === undefined ? null : (group.title ?? ''),
      };
    });
    return {
      tabs: rows,
      // First-appearance order, matching how a snapshot records its groups.
      groups: seen.map((id2) => {
        const group = byId.get(id2);
        return {
          title: group?.title ?? '',
          color: String(group?.color ?? ''),
          collapsed: group?.collapsed === true,
        };
      }),
    };
  }, windowId);
}

/* ------------------------------------------------------------------ steps */

interface Step {
  name: string;
  run(ctx: Context): Promise<string>;
}

const STEPS: Step[] = [
  {
    name: 'dist/ exists',
    async run(): Promise<string> {
      assert(
        existsSync(DIST) && existsSync(path.join(DIST, 'manifest.json')),
        `no built extension at ${DIST} — run \`pnpm build\` first`,
      );
      assert(
        existsSync(path.join(DIST, 'dashboard.html')),
        `${DIST} has no dashboard.html — rebuild with \`pnpm build\``,
      );
      return path.relative(ROOT, DIST);
    },
  },

  {
    name: 'fixture web server',
    async run(ctx): Promise<string> {
      ctx.server = await startDemoServer();
      return `${ctx.server.urls.length} pages on ${ctx.server.origin}`;
    },
  },

  {
    name: 'launch Chrome with the extension',
    async run(ctx): Promise<string> {
      ctx.ext = await launchExtension({ dist: DIST });
      ctx.page = ctx.ext.context.pages()[0] ?? (await ctx.ext.context.newPage());
      await ctx.page.setViewportSize({ width: 1280, height: 800 });
      return `extension id ${ctx.ext.extensionId}`;
    },
  },

  {
    name: 'build the fixture window',
    async run(ctx): Promise<string> {
      const ext = required(ctx.ext, 'extension');
      const server = required(ctx.server, 'server');
      const urls = FIXTURE_TABS.map((tab) => server.urls[tab.page]);
      ctx.fixtureUrls = urls;

      const worker = await ext.worker();
      const built = await worker.evaluate(
        async (input: {
          urls: string[];
          pinned: boolean[];
          groups: { title: string; color: string; collapsed: boolean; members: number[] }[];
        }) => {
          const created = await chrome.windows.create({ url: input.urls, focused: false });
          const windowId = created?.id;
          if (windowId === undefined) {
            throw new Error('windows.create returned no window id');
          }

          const ordered = async (): Promise<chrome.tabs.Tab[]> =>
            (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);

          // Wait for the loads to commit so titles (and urls) are real before anything is read.
          for (let attempt = 0; attempt < 60; attempt++) {
            const tabs = await ordered();
            if (tabs.length === input.urls.length && tabs.every((t) => t.status === 'complete')) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }

          let tabs = await ordered();
          const idAt = (index: number): number => {
            const id = tabs[index]?.id;
            if (id === undefined) {
              throw new Error(`fixture tab ${index} has no id`);
            }
            return id;
          };

          // Pin first: pinned tabs keep their leading positions, so the strip order is stable.
          for (let i = 0; i < input.pinned.length; i++) {
            if (input.pinned[i]) {
              await chrome.tabs.update(idAt(i), { pinned: true });
            }
          }
          // The active tab may not sit in a collapsed group; park it on the first pinned tab.
          await chrome.tabs.update(idAt(0), { active: true });

          tabs = await ordered();
          for (const group of input.groups) {
            const members = group.members.map((index) => idAt(index));
            const groupId = await chrome.tabs.group({
              tabIds: members as [number, ...number[]],
              createProperties: { windowId },
            });
            await chrome.tabGroups.update(groupId, {
              title: group.title,
              color: group.color as chrome.tabGroups.Color,
            });
            if (group.collapsed) {
              await chrome.tabGroups.update(groupId, { collapsed: true });
            }
          }

          tabs = await ordered();
          return {
            windowId,
            tabCount: tabs.length,
            pinnedCount: tabs.filter((tab) => tab.pinned).length,
            groupCount: (await chrome.tabGroups.query({ windowId })).length,
          };
        },
        {
          urls,
          pinned: FIXTURE_TABS.map((tab) => tab.pinned),
          groups: FIXTURE_GROUPS.map((group) => ({
            ...group,
            members: FIXTURE_TABS.map((tab, index) =>
              tab.group === group.title ? index : -1,
            ).filter((index) => index >= 0),
          })),
        },
      );

      ctx.fixtureWindowId = built.windowId;
      assertSame(built.tabCount, FIXTURE_TABS.length, 'fixture window tab count');
      assertSame(built.pinnedCount, 2, 'fixture window pinned count');
      assertSame(built.groupCount, FIXTURE_GROUPS.length, 'fixture window group count');

      const state = await readWindow(ext, built.windowId);
      assertSame(
        state.tabs.map((tab) => tab.url),
        urls,
        'fixture tab urls (tab-strip order)',
      );
      assertSame(state.groups, FIXTURE_GROUPS, 'fixture groups');
      return `window ${built.windowId}: 6 tabs, 2 pinned, groups ${FIXTURE_GROUPS.map((g) => `${g.title}/${g.color}${g.collapsed ? '/collapsed' : ''}`).join(' + ')}`;
    },
  },

  {
    name: 'open the dashboard',
    async run(ctx): Promise<string> {
      const ext = required(ctx.ext, 'extension');
      const page = required(ctx.page, 'page');
      const dashboardUrl = ext.pageUrl('dashboard.html');
      await page.goto(dashboardUrl);
      await header(page)
        .getByRole('heading', { name: 'Sessions' })
        .waitFor({ timeout: UI_TIMEOUT });

      // Anything else Chrome opened at startup would be captured too and throw the counts off.
      const worker = await ext.worker();
      const cleaned = await worker.evaluate(
        async (input: { keepWindowId: number; dashboardUrl: string }) => {
          const tabs = await chrome.tabs.query({});
          const doomed = tabs.filter(
            (tab) =>
              tab.id !== undefined &&
              tab.windowId !== input.keepWindowId &&
              (tab.url ?? '') !== input.dashboardUrl,
          );
          for (const tab of doomed) {
            await chrome.tabs.remove(tab.id as number);
          }
          const dashboard = (await chrome.tabs.query({ url: input.dashboardUrl }))[0];
          return { closed: doomed.length, dashboardWindowId: dashboard?.windowId ?? -1 };
        },
        { keepWindowId: required(ctx.fixtureWindowId, 'fixture window'), dashboardUrl },
      );
      ctx.dashboardWindowId = cleaned.dashboardWindowId;
      return `dashboard in window ${cleaned.dashboardWindowId}; closed ${cleaned.closed} stray tab(s)`;
    },
  },

  {
    name: 'save all windows',
    async run(ctx): Promise<string> {
      const page = required(ctx.page, 'page');
      await header(page)
        .getByRole('button', { name: 'Save all windows' })
        .click({ timeout: UI_TIMEOUT });

      const list = cards(page);
      await list.first().waitFor({ timeout: UI_TIMEOUT });
      assertSame(await list.count(), 1, 'session card count after saving');
      ctx.card = list.first();

      const meta = (await ctx.card.locator('p').first().innerText()).replace(/\s+/g, ' ');
      assert(meta.includes('1 window'), `card meta should report 1 window, got "${meta}"`);
      assert(meta.includes('6 tabs'), `card meta should report 6 tabs, got "${meta}"`);
      return `card meta "${meta}"`;
    },
  },

  {
    name: 'expand the session card',
    async run(ctx): Promise<string> {
      const card = required(ctx.card, 'session card');
      await card.getByRole('button', { name: 'Expand' }).click({ timeout: UI_TIMEOUT });
      await card.getByRole('heading', { name: 'Window 1' }).waitFor({ timeout: UI_TIMEOUT });
      for (const group of FIXTURE_GROUPS) {
        await card
          .getByRole('button', { name: new RegExp(group.title) })
          .first()
          .waitFor({ timeout: UI_TIMEOUT });
      }
      return `Window 1 tree shows groups ${FIXTURE_GROUPS.map((g) => g.title).join(' + ')}`;
    },
  },

  {
    name: 'restore the session',
    async run(ctx): Promise<string> {
      const ext = required(ctx.ext, 'extension');
      const page = required(ctx.page, 'page');
      const card = required(ctx.card, 'session card');

      const worker = await ext.worker();
      ctx.windowIdsBeforeRestore = await worker.evaluate(async () => {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        return windows.map((win) => win.id ?? -1);
      });

      await card
        .getByRole('button', { name: 'Restore', exact: true })
        .click({ timeout: UI_TIMEOUT });
      const toast = page.getByText(/Restored \d+ of \d+ tabs?/);
      await toast.waitFor({ timeout: 30_000 });
      const summary = (await toast.innerText()).replace(/\s+/g, ' ');
      assert(
        summary.startsWith('Restored 6 of 6 tabs'),
        `restore summary should report 6 of 6 tabs, got "${summary}"`,
      );
      return summary;
    },
  },

  {
    name: 'restored window matches the snapshot',
    async run(ctx): Promise<string> {
      const ext = required(ctx.ext, 'extension');
      const before = new Set(required(ctx.windowIdsBeforeRestore, 'pre-restore window ids'));
      const urls = required(ctx.fixtureUrls, 'fixture urls');

      let windowId = -1;
      let state: { tabs: RestoredTab[]; groups: RestoredGroup[] } | undefined;
      // The toast lands as soon as executeRestore resolves; a tab's url can still be `pendingUrl`
      // for a moment after that, so poll until every url has committed.
      for (let attempt = 0; attempt < 40; attempt++) {
        const worker = await ext.worker();
        const ids = await worker.evaluate(async () => {
          const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
          return windows.map((win) => win.id ?? -1);
        });
        const fresh = ids.filter((id) => !before.has(id));
        if (fresh.length === 1) {
          windowId = fresh[0];
          state = await readWindow(ext, windowId);
          if (state.tabs.length === urls.length && state.tabs.every((tab) => tab.url !== '')) {
            break;
          }
        }
        await delay(250);
      }

      assert(windowId !== -1, 'the restore did not open exactly one new window');
      assert(state !== undefined, 'could not read the restored window');

      assertSame(
        state.tabs.map((tab) => tab.url),
        urls,
        'restored tab urls, in tab-strip order',
      );
      assertSame(
        state.tabs.map((tab) => tab.pinned),
        FIXTURE_TABS.map((tab) => tab.pinned),
        'restored pinned flags',
      );
      assertSame(
        state.tabs.map((tab) => tab.group),
        FIXTURE_TABS.map((tab) => tab.group ?? null),
        'restored per-tab group membership',
      );
      assertSame(
        state.groups,
        FIXTURE_GROUPS,
        'restored group titles, colours and collapsed state',
      );
      return `window ${windowId}: 6 urls in order, 2 pinned, ${FIXTURE_GROUPS.map((g) => `${g.title}/${g.color}${g.collapsed ? '/collapsed' : ''}`).join(' + ')}`;
    },
  },

  {
    name: 'rename the session',
    async run(ctx): Promise<string> {
      const card = required(ctx.card, 'session card');
      await card.getByRole('button', { name: 'Rename session' }).click({ timeout: UI_TIMEOUT });
      const input = card.getByRole('textbox', { name: 'Session name' });
      await input.waitFor({ timeout: UI_TIMEOUT });
      await input.fill(RENAMED);
      await input.press('Enter');
      await card.getByRole('button', { name: RENAMED }).waitFor({ timeout: UI_TIMEOUT });
      return `card now reads “${RENAMED}”`;
    },
  },

  {
    name: 'delete the session',
    async run(ctx): Promise<string> {
      const page = required(ctx.page, 'page');
      const card = required(ctx.card, 'session card');

      await card.getByRole('button', { name: 'More actions' }).click({ timeout: UI_TIMEOUT });
      await page.getByRole('menuitem', { name: 'Delete' }).click({ timeout: UI_TIMEOUT });

      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('heading', { name: 'Delete session?' })
        .waitFor({ timeout: UI_TIMEOUT });
      await dialog
        .getByRole('button', { name: 'Delete', exact: true })
        .click({ timeout: UI_TIMEOUT });

      await page
        .getByRole('heading', { name: 'No saved sessions yet' })
        .waitFor({ timeout: UI_TIMEOUT });
      assertSame(await cards(page).count(), 0, 'session card count after deleting');
      return 'list is empty and the empty state is shown';
    },
  },
];

/* ------------------------------------------------------------------ runner */

async function main(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.error(`\nFAIL  watchdog — the run exceeded ${WATCHDOG_MS} ms`);
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();

  const ctx: Context = {};
  const started = Date.now();
  let failed = false;

  console.log(`Tab Organizer — sessions smoke test (${STEPS.length} steps)\n`);

  for (const [index, step] of STEPS.entries()) {
    const label = `${String(index + 1).padStart(2, ' ')}/${STEPS.length} ${step.name}`;
    if (failed) {
      console.log(`SKIP  ${label}`);
      continue;
    }
    const stepStarted = Date.now();
    try {
      const detail = await step.run(ctx);
      console.log(`PASS  ${label} (${Date.now() - stepStarted} ms) — ${detail}`);
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAIL  ${label} (${Date.now() - stepStarted} ms) — ${message}`);
    }
  }

  if (process.env.SMOKE_KEEP_OPEN !== '1') {
    await ctx.ext?.close().catch(() => undefined);
  }
  await ctx.server?.close().catch(() => undefined);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${failed ? 'FAILED' : 'OK'} — ${STEPS.length} steps in ${seconds}s`);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('FAIL  smoke test crashed —', err);
  process.exit(1);
});
