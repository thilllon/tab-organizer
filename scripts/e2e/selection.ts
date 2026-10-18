/**
 * Real-Chrome check of the Open tabs selection: tick boxes, the bar that replaces the heading,
 * and what its actions do to the browser.
 *
 *   pnpm build && pnpm e2e:selection
 *
 * Results are read back through `chrome.tabs` / `chrome.storage` in the extension's own service
 * worker, not from the page that was just clicked. Needs a headed browser on a Mac (`HEADLESS=0`);
 * `SELECTION_SHOTS=<dir>` also writes page screenshots there (the page only, never the screen).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { type ExtensionSession, launchExtension } from './browser';
import { DEMO_PAGES, startDemoServer } from './server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', '..', 'dist');
const UI_TIMEOUT = 10_000;
const SHOTS = process.env.SELECTION_SHOTS;

interface OpenTab {
  id: number;
  url: string;
  active: boolean;
}

const title = (index: number): string => DEMO_PAGES[index].title;

async function openTabs(ext: ExtensionSession): Promise<OpenTab[]> {
  const worker = await ext.worker();
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter((tab) => tab.id !== undefined && !(tab.url ?? '').startsWith('chrome-extension://'))
      .map((tab) => ({ id: tab.id as number, url: tab.url ?? '', active: tab.active }));
  });
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + UI_TIMEOUT;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') {
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

function box(page: Page, index: number) {
  return page.getByRole('checkbox', { name: `Select ${title(index)}`, exact: true });
}

function barButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true });
}

async function menuItem(page: Page, name: string): Promise<void> {
  await barButton(page, 'More actions for the selected tabs').click({ timeout: UI_TIMEOUT });
  await page.getByRole('menuitem', { name, exact: true }).click({ timeout: UI_TIMEOUT });
}

async function expectBar(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).waitFor({ timeout: UI_TIMEOUT });
}

const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const server = await startDemoServer();
  const ext = await launchExtension({ dist: DIST, preferHeaded: true });
  try {
    // Four tabs on one site and two on another: the same server under its two loopback names.
    const other = server.origin.replace('127.0.0.1', 'localhost');
    const urls = [
      ...server.urls.slice(0, 4),
      `${other}${DEMO_PAGES[4].path}`,
      `${other}${DEMO_PAGES[5].path}`,
    ];
    const worker = await ext.worker();
    await worker.evaluate(async (list: string[]) => {
      const win = await chrome.windows.getLastFocused();
      for (const url of list) {
        await chrome.tabs.create({ windowId: win.id, url, active: false });
      }
    }, urls);

    const page = await ext.context.newPage();
    for (const stray of ext.context.pages()) {
      if (stray !== page && !stray.url().startsWith('http')) {
        await stray.close();
      }
    }
    await page.goto(ext.pageUrl('app.html'));
    await page.getByRole('heading', { name: 'Open tabs' }).waitFor({ timeout: UI_TIMEOUT });
    await box(page, 5).waitFor({ timeout: UI_TIMEOUT });
    const tree = page.getByRole('tree');
    await shot(page, '1-before');

    await check('ticking a box swaps the heading for the bar without moving the list', async () => {
      const before = (await tree.boundingBox())?.y ?? -1;
      await box(page, 0).click({ timeout: UI_TIMEOUT });
      await expectBar(page, '1 selected tab');
      const after = (await tree.boundingBox())?.y ?? -2;
      assert(
        (await page.getByRole('heading', { name: 'Open tabs' }).count()) === 0,
        'the heading is still there',
      );
      assert(Math.abs(before - after) < 0.5, `the list moved from y=${before} to y=${after}`);
      await shot(page, '2-one-selected');
      return `list stayed at y=${before}`;
    });

    await check('shift-click on another box takes the whole range', async () => {
      await box(page, 3).click({ modifiers: ['Shift'], timeout: UI_TIMEOUT });
      await expectBar(page, '4 selected tabs');
      for (const index of [0, 1, 2, 3]) {
        assert(await box(page, index).isChecked(), `${title(index)} is not ticked`);
      }
      await shot(page, '3-range');
      return 'tabs 1-4 ticked';
    });

    await check('Copy puts the links on the clipboard and says so', async () => {
      await ext.context
        .grantPermissions(['clipboard-read', 'clipboard-write'], {
          origin: `chrome-extension://${ext.extensionId}`,
        })
        .catch(() => undefined);
      await barButton(page, 'Copy').click({ timeout: UI_TIMEOUT });
      await page.getByText('Copied 4 links.', { exact: true }).waitFor({ timeout: UI_TIMEOUT });
      const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      if (text === null) {
        return 'notice shown; the clipboard could not be read back here';
      }
      assert(text === urls.slice(0, 4).join('\n'), `clipboard holds ${JSON.stringify(text)}`);
      return 'four links, one per line';
    });

    await check('Clear selection brings the heading back', async () => {
      await barButton(page, 'Clear selection').click({ timeout: UI_TIMEOUT });
      await page.getByRole('heading', { name: 'Open tabs' }).waitFor({ timeout: UI_TIMEOUT });
      assert(!(await box(page, 0).isChecked()), 'a box is still ticked');
      return 'heading back, nothing ticked';
    });

    await check('"Select all tabs not like this" ticks every tab on the other site', async () => {
      await box(page, 4).click({ timeout: UI_TIMEOUT });
      await menuItem(page, 'Select all tabs not like this');
      await expectBar(page, '4 selected tabs');
      assert(!(await box(page, 4).isChecked()), 'the tab it started from is still ticked');
      assert(await box(page, 0).isChecked(), 'a tab on the other site is not ticked');
      await menuItem(page, 'Select all tabs like this');
      await expectBar(page, '4 selected tabs');
      await barButton(page, 'Clear selection').click({ timeout: UI_TIMEOUT });
      return 'four tabs on the other site';
    });

    await check('Close asks before closing several tabs, then closes exactly those', async () => {
      await box(page, 2).click({ timeout: UI_TIMEOUT });
      await box(page, 3).click({ timeout: UI_TIMEOUT });
      await barButton(page, 'Close').click({ timeout: UI_TIMEOUT });
      const dialog = page.getByRole('dialog');
      await dialog.getByText('Close 2 tabs?').waitFor({ timeout: UI_TIMEOUT });
      await shot(page, '4-close-dialog');
      assert((await openTabs(ext)).length === 6, 'tabs closed before the answer');
      await dialog.getByRole('button', { name: 'Close tabs' }).click({ timeout: UI_TIMEOUT });
      const left = await until(
        () => openTabs(ext),
        (tabs) => tabs.length === 4,
      );
      const leftUrls = left.map((tab) => tab.url).sort();
      const expected = [urls[0], urls[1], urls[4], urls[5]].sort();
      assert(JSON.stringify(leftUrls) === JSON.stringify(expected), `left open: ${leftUrls}`);
      await page.getByRole('heading', { name: 'Open tabs' }).waitFor({ timeout: UI_TIMEOUT });
      return 'two closed, four left, selection gone';
    });

    await check('Save & close stores the ticked tabs as a session and closes them', async () => {
      await box(page, 0).click({ timeout: UI_TIMEOUT });
      await box(page, 4).click({ timeout: UI_TIMEOUT });
      await menuItem(page, 'Save & close');
      await page.waitForURL(/#saved\//, { timeout: UI_TIMEOUT });
      const id = decodeURIComponent(page.url().split('#saved/')[1] ?? '');
      const saved = await (
        await ext.worker()
      ).evaluate(async (sessionId: string) => {
        const key = `session:${sessionId}`;
        const stored = (await chrome.storage.local.get(key))[key] as
          | { windows: { tabs: { url: string }[] }[] }
          | undefined;
        return stored?.windows.flatMap((win) => win.tabs.map((tab) => tab.url)) ?? [];
      }, id);
      assert(
        JSON.stringify(saved) === JSON.stringify([urls[0], urls[4]]),
        `the session holds ${JSON.stringify(saved)}`,
      );
      const left = await until(
        () => openTabs(ext),
        (tabs) => tabs.length === 2,
      );
      const leftUrls = left.map((tab) => tab.url).sort();
      assert(
        JSON.stringify(leftUrls) === JSON.stringify([urls[1], urls[5]].sort()),
        `left open: ${leftUrls}`,
      );
      await shot(page, '5-saved');
      return 'session of two tabs; those two closed';
    });

    await check('a click on the row itself still goes to the tab', async () => {
      await page.goto(ext.pageUrl('app.html#open'));
      await box(page, 1).waitFor({ timeout: UI_TIMEOUT });
      await page.getByRole('link', { name: title(1) }).click({ timeout: UI_TIMEOUT });
      const tabs = await until(
        () => openTabs(ext),
        (list) => list.some((tab) => tab.url === urls[1] && tab.active),
      );
      assert(
        tabs.some((tab) => tab.url === urls[1] && tab.active),
        'the tab was not activated',
      );
      assert(tabs.length === 2, 'the click changed which tabs are open');
      return 'tab activated, nothing ticked or closed';
    });
  } finally {
    await ext.close();
    await server.close();
  }

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
