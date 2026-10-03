/**
 * Real-Chrome check of the icon-click sort: the tabs end up in order, and only the tabs that were
 * out of place are moved (src/background/move-plan.ts). The unit tests hold the plan against a
 * model of `chrome.tabs.move`; this holds it against Chrome itself, including what a move at the
 * edge of a tab group does to the group.
 *
 *     pnpm build && pnpm e2e:sort
 *
 * The click is delivered with `chrome.action.onClicked.dispatch()` inside the service worker, so
 * the ordinary `dist/` build is enough — no e2e hook. `sortTabGroups()` is not awaited by its
 * listener, so each scenario waits for the strip to stop changing.
 *
 * Environment: `E2E_DIST` (default `dist/`), `E2E_KEEP_OPEN=1`, plus `PW_CHROMIUM` / `HEADLESS`
 * (see ./browser.ts). Sorting acts on the last-focused window, so this needs a headed browser.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Worker } from '@playwright/test';
import { launchExtension } from './browser';
import { startDemoServer } from './server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = process.env.E2E_DIST ?? path.join(ROOT, 'dist');

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

interface StripTab {
  id: number;
  key: string;
  pinned: boolean;
  groupId: number;
}

interface SortRun {
  strip: StripTab[];
  /** Ids Chrome reported through `tabs.onMoved` while the sort ran, in order. */
  moved: number[];
}

/** Opens a focused window holding one tab per key, in the order given. */
async function openWindow(worker: Worker, base: string, keys: string[]): Promise<number> {
  return worker.evaluate(
    async (input: { base: string; keys: string[] }) => {
      const win = await chrome.windows.create({
        url: input.keys.map((key) => `${input.base}?k=${key}`),
        focused: true,
      });
      const id = win?.id ?? -1;
      // Wait for every tab to commit, so `tab.url` (what the sort reads) is the real address.
      for (let attempt = 0; attempt < 100; attempt++) {
        const tabs = await chrome.tabs.query({ windowId: id });
        if (tabs.every((tab) => (tab.url ?? '').includes('?k='))) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return id;
    },
    { base, keys },
  );
}

/** Clicks the toolbar icon for `windowId` and returns the strip once it has settled. */
async function clickSort(worker: Worker, windowId: number): Promise<SortRun> {
  return worker.evaluate(async (id: number) => {
    const read = async () =>
      (await chrome.tabs.query({ windowId: id }))
        .sort((a, b) => a.index - b.index)
        .map((tab) => ({
          id: tab.id ?? -1,
          key: new URL(tab.url ?? 'about:blank').searchParams.get('k') ?? '',
          pinned: tab.pinned,
          groupId: tab.groupId,
        }));
    const moved: number[] = [];
    const onMoved = (tabId: number, info: { windowId: number }) => {
      if (info.windowId === id) {
        moved.push(tabId);
      }
    };
    chrome.tabs.onMoved.addListener(onMoved);
    await chrome.windows.update(id, { focused: true });
    const [active] = await chrome.tabs.query({ windowId: id, active: true });
    (chrome.action.onClicked as unknown as { dispatch(tab: chrome.tabs.Tab): void }).dispatch(
      active,
    );

    // Settled = the same strip on five consecutive reads, 100 ms apart.
    let last = '';
    let steady = 0;
    for (let attempt = 0; attempt < 100 && steady < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const now = JSON.stringify(await read());
      steady = now === last ? steady + 1 : 0;
      last = now;
    }
    chrome.tabs.onMoved.removeListener(onMoved);
    return { strip: await read(), moved };
  }, windowId);
}

const keysOf = (run: SortRun): string[] => run.strip.map((tab) => tab.key);
const idsOf = (run: SortRun): number[] => run.strip.map((tab) => tab.id);

async function main(): Promise<void> {
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`${DIST} has no manifest.json — run: pnpm build`);
  }
  const server = await startDemoServer();
  const ext = await launchExtension({
    dist: DIST,
    preferHeaded: true,
    args: ['--use-mock-keychain', '--password-store=basic'],
  });

  try {
    const worker = await ext.worker();
    const base = server.urls[0];

    // 1. A scrambled window of plain tabs.
    const plain = await openWindow(worker, base, ['e', 'b', 'g', 'a', 'h', 'c', 'f', 'd']);
    const before = await worker.evaluate(
      async (id: number) => (await chrome.tabs.query({ windowId: id })).map((tab) => tab.id ?? -1),
      plain,
    );
    const first = await clickSort(worker, plain);
    check(
      'scrambled tabs come out in url order',
      same(keysOf(first), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
      keysOf(first).join(' '),
    );
    check(
      'no tab was closed or reopened',
      same([...idsOf(first)].sort(), [...before].sort()),
      `${before.length} before, ${first.strip.length} after`,
    );

    // 2. Already sorted: nothing moves.
    const again = await clickSort(worker, plain);
    check(
      'a sorted window is left alone',
      again.moved.length === 0 && same(idsOf(again), idsOf(first)),
      `${again.moved.length} tabs moved`,
    );

    // 3. One tab out of place, and on the wrong side: the last tab dragged to the front has to
    // travel right. Handing Chrome the whole block would shift every other tab to make room.
    const stray = idsOf(first)[idsOf(first).length - 1];
    await worker.evaluate(async (id: number) => {
      await chrome.tabs.move(id, { index: 0 });
    }, stray);
    const one = await clickSort(worker, plain);
    check(
      'one stray tab is one move, not the whole window',
      same(one.moved, [stray]) && same(idsOf(one), idsOf(first)),
      `moved [${one.moved.join(', ')}], order ${keysOf(one).join(' ')}`,
    );

    // 4. Pinned tabs, a titled group and loose tabs in one window.
    const mixed = await openWindow(worker, base, ['p2', 'p1', 'g3', 'g1', 'g4', 'g2', 'u2', 'u1']);
    const group = await worker.evaluate(async (id: number) => {
      const tabs = (await chrome.tabs.query({ windowId: id })).sort((a, b) => a.index - b.index);
      const idAt = (index: number) => tabs[index].id ?? -1;
      await chrome.tabs.update(idAt(0), { pinned: true });
      await chrome.tabs.update(idAt(1), { pinned: true });
      // `createProperties.windowId`, or the group is made in whichever window has focus.
      const groupId = await chrome.tabs.group({
        tabIds: [idAt(2), idAt(3), idAt(4), idAt(5)],
        createProperties: { windowId: id },
      });
      await chrome.tabGroups.update(groupId, { title: 'Docs' });
      return { groupId, members: [idAt(2), idAt(3), idAt(4), idAt(5)] };
    }, mixed);
    const sortedMixed = await clickSort(worker, mixed);
    check(
      'pinned tabs stay, the group and the loose tabs sort within themselves',
      same(keysOf(sortedMixed), ['p2', 'p1', 'g1', 'g2', 'g3', 'g4', 'u1', 'u2']),
      keysOf(sortedMixed).join(' '),
    );
    const inGroup = (run: SortRun): number[] =>
      run.strip.filter((tab) => tab.groupId === group.groupId).map((tab) => tab.id);
    check(
      'the group keeps its id and exactly its members',
      same([...inGroup(sortedMixed)].sort(), [...group.members].sort()),
      `group ${group.groupId}: [${inGroup(sortedMixed).join(', ')}]`,
    );

    // 5. The same inside the group: its last tab dragged to its front (index 2, after the two
    // pinned tabs), then sorted back to the group's far edge.
    const groupLast = inGroup(sortedMixed)[3];
    await worker.evaluate(
      async (input: { tabId: number; groupId: number; index: number }) => {
        await chrome.tabs.move(input.tabId, { index: input.index });
        await chrome.tabs.group({ tabIds: [input.tabId], groupId: input.groupId });
      },
      { tabId: groupLast, groupId: group.groupId, index: 2 },
    );
    const regrouped = await clickSort(worker, mixed);
    check(
      'a stray tab in a group is one move and stays in the group',
      same(regrouped.moved, [groupLast]) &&
        same(idsOf(regrouped), idsOf(sortedMixed)) &&
        same(inGroup(regrouped), inGroup(sortedMixed)),
      `moved [${regrouped.moved.join(', ')}], order ${keysOf(regrouped).join(' ')}`,
    );
    const title = await worker.evaluate(
      async (groupId: number) => (await chrome.tabGroups.get(groupId)).title,
      group.groupId,
    );
    check('the group keeps its title', title === 'Docs', `title "${title}"`);
  } finally {
    if (process.env.E2E_KEEP_OPEN !== '1') {
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
  console.error('FAIL  sort e2e crashed —', err);
  process.exit(1);
});
