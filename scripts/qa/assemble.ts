/**
 * Real-Chrome QA for the `assemble-tabs` command: every other normal window's tabs move into the
 * last-focused one with `chrome.tabs.move` / `chrome.tabGroups.move`.
 *
 * It needs a QA build, the only build that exposes the worker's command handler (as
 * `globalThis.__tabOrganizerQa`, see src/background/sessions.ts) — the command is otherwise only
 * reachable through a keyboard shortcut:
 *
 *     pnpm qa:assemble        # vite build --mode qa --outDir dist-qa && tsx scripts/qa/assemble.ts
 *
 * Builds five windows — a source with two pinned tabs and a tab with back/forward history; a
 * source whose active tab sits in a collapsed titled group next to a tab carrying page state (a JS
 * value, scroll position and typed input); a source that is nothing but a collapsed three-tab
 * group with its middle tab active; a source that is a single-tab group; and the focused target
 * whose active tab is not its first — runs the command through the right-click menu's id, then
 * checks: one normal window left, every tab id kept, the exact tab order, pinned tabs re-pinned,
 * every group kept (id, title, colour, collapsed, members) or rebuilt with the same look,
 * `Page.getNavigationHistory` unchanged, page state unchanged (no reload), **no tab activation in
 * the target at any moment**, and the ✓ badge. It also reports what this Chromium exposes for
 * split view.
 *
 * Environment: `QA_DIST` (default `dist-qa/`), plus `PW_CHROMIUM` / `HEADLESS` (see ./browser.ts).
 * On macOS point `PW_CHROMIUM` at a Chromium or Chrome for Testing binary: branded Chrome 137+
 * ignores `--load-extension`, and Playwright's headless shell cannot load extensions at all.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { installNameShim, launchExtension } from './browser';
import { startDemoServer } from './server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = process.env.QA_DIST ?? path.join(ROOT, 'dist-qa');
/** The command id, shared by the right-click menu item. */
const COMMAND = 'assemble-tabs';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function pageAt(context: BrowserContext, url: string): Promise<Page> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = context.pages().find((candidate) => candidate.url() === url);
    if (page !== undefined) {
      await page.waitForLoadState('load');
      await installNameShim(page);
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no page ever reached ${url}`);
}

interface HistorySnapshot {
  currentIndex: number;
  urls: string[];
}

async function navigationHistory(context: BrowserContext, page: Page): Promise<HistorySnapshot> {
  const cdp = await context.newCDPSession(page);
  const history = await cdp.send('Page.getNavigationHistory');
  await cdp.detach();
  return { currentIndex: history.currentIndex, urls: history.entries.map((entry) => entry.url) };
}

interface PageState {
  marker: unknown;
  scrollY: number;
  input: string;
}

async function pageState(page: Page): Promise<PageState> {
  return page.evaluate(() => ({
    marker: (window as unknown as Record<string, unknown>).qaMarker,
    scrollY: Math.round(window.scrollY),
    input: (document.getElementById('qa-input') as HTMLInputElement | null)?.value ?? '',
  }));
}

interface TabRow {
  id: number;
  windowId: number;
  pinned: boolean;
  groupId: number;
  active: boolean;
}

async function allTabs(worker: Worker): Promise<TabRow[]> {
  return worker.evaluate(async () =>
    (await chrome.tabs.query({})).map((tab) => ({
      id: tab.id ?? -1,
      windowId: tab.windowId,
      pinned: tab.pinned,
      groupId: tab.groupId,
      active: tab.active,
    })),
  );
}

async function createWindow(worker: Worker, urls: string[], focused: boolean): Promise<number[]> {
  return worker.evaluate(
    async ({ list, focus }) => {
      const win = await chrome.windows.create({ url: list, focused: focus });
      return [win?.id ?? -1, ...(win?.tabs ?? []).map((tab) => tab.id ?? -1)];
    },
    { list: urls, focus: focused },
  );
}

async function main(): Promise<void> {
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`${DIST} has no manifest.json — run: pnpm qa:assemble`);
  }
  const server = await startDemoServer();
  const ext = await launchExtension({
    dist: DIST,
    // A fresh Chrome for Testing profile on macOS can stall on a keychain prompt otherwise.
    args: ['--use-mock-keychain', '--password-store=basic'],
  });
  const { context } = ext;

  try {
    const worker = await ext.worker();
    const url = (page: number, tag: string): string => `${server.urls[page]}?qa=${tag}`;
    const initialWindows = await worker.evaluate(async () =>
      (await chrome.windows.getAll()).map((win) => win.id ?? -1),
    );

    // Source 1: two pinned tabs, a tab with back/forward history, a plain tab.
    const [w1 = -1, p1 = -1, p2 = -1, hist = -1, u1 = -1] = await createWindow(
      worker,
      [url(0, 'pin-1'), url(1, 'pin-2'), url(2, 'history-1'), url(3, 'plain-1')],
      false,
    );
    // Source 2: a two-tab group (collapsed, titled, coloured), a plain tab, a stateful tab.
    const [w2 = -1, g1 = -1, g2 = -1, u2 = -1, stateful = -1] = await createWindow(
      worker,
      [url(4, 'group-1'), url(5, 'group-2'), url(6, 'plain-2'), url(7, 'state')],
      false,
    );
    // Source 3: nothing but a collapsed three-tab group, its middle tab active.
    const [w3 = -1, c1 = -1, c2 = -1, c3 = -1] = await createWindow(
      worker,
      [url(0, 'groups-only-1'), url(1, 'groups-only-2'), url(2, 'groups-only-3')],
      false,
    );
    // Source 4: a single-tab group.
    const [w4 = -1, solo = -1] = await createWindow(worker, [url(3, 'solo')], false);
    // Target, created last and focused; its active tab is deliberately its second one.
    const [target = -1, ta = -1, tb = -1] = await createWindow(
      worker,
      [url(0, 'target-a'), url(1, 'target-b')],
      true,
    );

    const { gid: groupId, onlyGroups } = await worker.evaluate(
      async (ids) => {
        await chrome.tabs.update(ids.p1, { pinned: true });
        await chrome.tabs.update(ids.p2, { pinned: true });
        // createProperties.windowId is required: without it Chrome moves the new group to the
        // last-focused window.
        const gid = await chrome.tabs.group({
          tabIds: [ids.g1, ids.g2],
          createProperties: { windowId: ids.w2 },
        });
        await chrome.tabGroups.update(gid, { title: 'QA group', color: 'blue', collapsed: true });
        const onlyGroups = await chrome.tabs.group({
          tabIds: [ids.c1, ids.c2, ids.c3],
          createProperties: { windowId: ids.w3 },
        });
        await chrome.tabs.update(ids.c2, { active: true });
        await chrome.tabGroups.update(onlyGroups, {
          title: 'Groups only',
          color: 'green',
          collapsed: true,
        });
        const soloGroup = await chrome.tabs.group({
          tabIds: [ids.solo],
          createProperties: { windowId: ids.w4 },
        });
        await chrome.tabGroups.update(soloGroup, { title: 'Solo', color: 'red', collapsed: true });
        await chrome.tabs.update(ids.tb, { active: true });
        for (const id of ids.initial) {
          await chrome.windows.remove(id);
        }
        await chrome.windows.update(ids.target, { focused: true });
        return { gid, onlyGroups };
      },
      { p1, p2, g1, g2, w2, c1, c2, c3, w3, solo, w4, tb, target, initial: initialWindows },
    );

    // History made by real navigations in the page (extension-made history can refuse goBack).
    const historyPage = await pageAt(context, url(2, 'history-1'));
    await historyPage.goto(url(3, 'history-2'));
    await historyPage.goto(url(4, 'history-3'));
    await historyPage.goBack();
    const historyBefore = await navigationHistory(context, historyPage);

    const statePage = await pageAt(context, url(7, 'state'));
    await statePage.evaluate(() => {
      document.body.style.minHeight = '6000px';
      const input = document.createElement('input');
      input.id = 'qa-input';
      input.value = 'typed before the move';
      document.body.prepend(input);
      (window as unknown as Record<string, unknown>).qaMarker = 'same document';
      window.scrollTo(0, 1500);
    });
    const stateBefore = await pageState(statePage);

    const tabsBefore = await allTabs(worker);
    const lastFocused = await worker.evaluate(
      async () => (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id ?? -1,
    );
    console.log(
      `fixture: ${tabsBefore.length} tabs in windows ${[w1, w2, w3, w4, target].join(', ')} ` +
        `(target ${target}, last focused ${lastFocused}); history ${JSON.stringify(historyBefore)}; ` +
        `state ${JSON.stringify(stateBefore)}\n`,
    );

    const started = Date.now();
    const activations = await worker.evaluate(
      async ({ command, targetId }) => {
        const hook = (
          globalThis as unknown as {
            __tabOrganizerQa?: { handleMenuOrCommand(id: string): Promise<void> };
          }
        ).__tabOrganizerQa;
        if (hook === undefined) {
          throw new Error('not a QA build: globalThis.__tabOrganizerQa is missing');
        }
        // Every activation Chrome reports in the target while the command runs, however brief.
        const seen: number[] = [];
        const record = (info: chrome.tabs.OnActivatedInfo): void => {
          if (info.windowId === targetId) {
            seen.push(info.tabId);
          }
        };
        chrome.tabs.onActivated.addListener(record);
        try {
          await hook.handleMenuOrCommand(command);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
          chrome.tabs.onActivated.removeListener(record);
        }
        return seen;
      },
      { command: COMMAND, targetId: target },
    );
    const elapsed = Date.now() - started;

    const after = await worker.evaluate(
      async (gid) => ({
        windows: (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((win) => ({
          id: win.id ?? -1,
          focused: win.focused,
        })),
        group: await chrome.tabGroups.get(gid.groupId),
        onlyGroups: await chrome.tabGroups.get(gid.onlyGroups),
        solo: await chrome.tabs
          .get(gid.solo)
          .then((tab) => (tab.groupId === -1 ? undefined : chrome.tabGroups.get(tab.groupId))),
        badge: await chrome.action.getBadgeText({}),
      }),
      { groupId, onlyGroups, solo },
    );
    const tabsAfter = await allTabs(worker);
    const strip = tabsAfter.filter((tab) => tab.windowId === target);

    check(
      'one normal window left',
      same(
        after.windows.map((win) => win.id),
        [target],
      ),
      `windows ${JSON.stringify(after.windows)} after ${elapsed} ms`,
    );
    const idsBefore = tabsBefore.map((tab) => tab.id).sort((a, b) => a - b);
    const idsAfter = tabsAfter.map((tab) => tab.id).sort((a, b) => a - b);
    check(
      'every tab id kept',
      same(idsBefore, idsAfter),
      `${idsBefore.length} before, ${idsAfter.length} after`,
    );
    const expectedOrder = [p1, p2, ta, tb, hist, u1, g1, g2, u2, stateful, c1, c2, c3, solo];
    check(
      'tab order',
      same(
        strip.map((tab) => tab.id),
        expectedOrder,
      ),
      `strip ${JSON.stringify(strip.map((tab) => tab.id))}, expected ${JSON.stringify(expectedOrder)}`,
    );
    check(
      'pinned tabs re-pinned in order',
      same(
        strip.filter((tab) => tab.pinned).map((tab) => tab.id),
        [p1, p2],
      ),
      `pinned ${JSON.stringify(strip.filter((tab) => tab.pinned).map((tab) => tab.id))}`,
    );
    check(
      'group kept whole',
      after.group.id === groupId &&
        after.group.windowId === target &&
        after.group.title === 'QA group' &&
        after.group.color === 'blue' &&
        after.group.collapsed &&
        same(
          strip.filter((tab) => tab.groupId === groupId).map((tab) => tab.id),
          [g1, g2],
        ),
      `group ${JSON.stringify(after.group)}`,
    );
    check(
      'groups-only window: same group, same members in order, still collapsed',
      after.onlyGroups.id === onlyGroups &&
        after.onlyGroups.windowId === target &&
        after.onlyGroups.title === 'Groups only' &&
        after.onlyGroups.color === 'green' &&
        after.onlyGroups.collapsed &&
        same(
          strip.filter((tab) => tab.groupId === onlyGroups).map((tab) => tab.id),
          [c1, c2, c3],
        ),
      `group ${JSON.stringify(after.onlyGroups)}`,
    );
    check(
      'single-tab group rebuilt with the same look',
      after.solo !== undefined &&
        after.solo.windowId === target &&
        after.solo.title === 'Solo' &&
        after.solo.color === 'red' &&
        after.solo.collapsed,
      `group ${JSON.stringify(after.solo)}`,
    );
    const historyAfter = await navigationHistory(context, historyPage);
    check(
      'navigation history kept',
      same(historyBefore, historyAfter),
      `${historyAfter.urls.length} entries, current index ${historyAfter.currentIndex}`,
    );
    const stateAfter = await pageState(statePage);
    check('page state kept (no reload)', same(stateBefore, stateAfter), JSON.stringify(stateAfter));
    const activeInTarget = strip.filter((tab) => tab.active).map((tab) => tab.id);
    check(
      'target active tab unchanged, never switched even briefly',
      same(activeInTarget, [tb]) && activations.length === 0,
      `active ${JSON.stringify(activeInTarget)}, activations during the run ${JSON.stringify(activations)}`,
    );
    check(
      'target focused, ✓ badge',
      after.windows[0]?.focused === true && after.badge === '✓',
      `focused ${String(after.windows[0]?.focused)}, badge ${JSON.stringify(after.badge)}`,
    );

    const splitView = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({});
      const tabsApi = chrome.tabs as unknown as Record<string, unknown>;
      return {
        tabFields: Object.keys(tab ?? {}).filter((key) => /split/i.test(key)),
        tabsApi: Object.keys(tabsApi).filter((key) => /split/i.test(key)),
        namespaces: Object.keys(chrome).filter((key) => /split/i.test(key)),
      };
    });
    const version = await worker.evaluate(() => navigator.userAgent);
    console.log(`\nsplit view surface in ${version}:\n  ${JSON.stringify(splitView)}`);
  } finally {
    if (process.env.QA_KEEP_OPEN !== '1') {
      await ext.close().catch(() => undefined);
    }
    await server.close().catch(() => undefined);
  }

  const failed = checks.filter((entry) => !entry.ok).length;
  console.log(
    `\n${failed === 0 ? 'OK' : 'FAILED'} — ${checks.length - failed}/${checks.length} checks`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('FAIL  assemble QA crashed —', err);
  process.exit(1);
});
