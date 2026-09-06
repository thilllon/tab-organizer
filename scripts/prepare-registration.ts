/**
 * Chrome Web Store registration preparation script.
 *
 * Runs the visual-asset pipeline (used as a release-it before:bump hook):
 *   1. Build the extension
 *   2. Launch Chrome with the built extension
 *   3. Generate options-page screenshots (1280x800, 640x400)
 *   4. Generate Sessions dashboard screenshots (1280x800)
 *   5. Generate before/after demo screenshots            (needs an external network)
 *   6. Record demo video + sort the demo tabs            (needs ffmpeg, macOS capture)
 *   7. Render tab-bar mockups and CWS promotional images
 *   8. Convert the demo video to demo.gif                (needs ffmpeg)
 *   9. Regenerate docs/description.txt from docs/README.md (see build-listing.ts)
 *
 * Every step that depends on ffmpeg, an external network or a macOS-only tool is optional: it is
 * skipped -- loudly, but without failing the run -- when the dependency is missing or when its
 * environment flag is set. The process still exits 0 when only optional steps were skipped, and
 * exits 1 only when a step that should have worked did not.
 *
 * Environment flags (all `=1` to enable):
 *   SKIP_BUILD      don't run `pnpm build` (reuse whatever is in dist/)
 *   SKIP_OPTIONS    skip the options-page screenshots
 *   SKIP_DASHBOARD  skip the Sessions dashboard screenshots
 *   SKIP_DEMO       skip the before/after demo tabs (auto-skipped without an external network)
 *   SKIP_VIDEO      skip the screen recording (auto-skipped without ffmpeg or off macOS)
 *   SKIP_NATIVE     skip native macOS window captures (auto-skipped off macOS)
 *   SKIP_MOCKUPS    skip the tab-bar mockup renders
 *   SKIP_PROMO      skip the promotional images
 *   SKIP_GIF        skip demo.gif (auto-skipped without ffmpeg)
 *   SKIP_LISTING    skip regenerating docs/description.txt
 *   HEADLESS=1      force a headless browser (the default where there is no display)
 *   PW_CHROMIUM     Chromium binary to drive (see scripts/qa/browser.ts)
 */

import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import type { ExportBundle } from '../src/types';
import { buildListing } from './build-listing';
import { type ExtensionSession, launchExtension } from './qa/browser';
import { buildDashboardFixtures, seedSessions } from './qa/fixtures';

/*
 * Types
 */

interface WindowBounds {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TabInfo {
  url: string;
  title: string;
  favIconUrl: string;
  active: boolean;
  groupColor?: string | null;
}

interface SkipRecord {
  step: string;
  reason: string;
}

/*
 * Constants
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const PROMO_TEMPLATE = path.join(__dirname, 'promo-template.html');
const TAB_BAR_TEMPLATE = path.join(__dirname, 'tab-bar-template.html');
const GET_WINDOW_ID_SCRIPT = path.join(__dirname, 'get-window-id.py');
const ICON_PATH = path.join(ROOT, 'public', 'img', 'logo-128.png');

/** How long a dashboard control is waited for before its screenshot is skipped. */
const CONTROL_TIMEOUT = 8000;

const GROUP_COLORS: Record<string, string> = {
  blue: '#8ab4f8',
  red: '#f28b82',
  yellow: '#fdd663',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70',
};

const DEMO_SITES = [
  'https://news.ycombinator.com',
  'https://www.youtube.com',
  'https://www.youtube.com/feed/trending',
  'https://github.com',
  'https://github.com/trending',
  'https://www.google.com',
  'https://www.google.com/maps',
  'https://www.amazon.com',
  'https://en.wikipedia.org',
  'https://stackoverflow.com',
  'https://www.reddit.com',
  'https://www.reddit.com/r/programming',
];

/*
 * Optional-dependency probes
 */

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

/*
 * Entry point
 */

async function main(): Promise<void> {
  await new Preparation().run();
}

class Preparation {
  private context: ExtensionSession['context'] | null = null;
  private ext: ExtensionSession | null = null;
  private serviceWorker: ExtensionSession['serviceWorker'] | null = null;
  private extensionId = '';
  private screenshotPage: Page | null = null;
  private readonly skipped: SkipRecord[] = [];
  private readonly failed: SkipRecord[] = [];

  constructor() {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  /* Main runner */

  async run(): Promise<void> {
    // Step 1: Build
    this.buildExtension();

    // Step 2: Launch browser
    await this.launchBrowser();

    // Step 3: Options screenshots
    await this.takeOptionsScreenshots();

    // Step 4: Sessions dashboard screenshots
    await this.takeDashboardScreenshots();

    // Step 5: Demo screenshots (before/after)
    const { beforeTabs } = await this.takeDemoScreenshots();
    const demoRan = beforeTabs.length > 0;

    // Step 6: Video recording + sort
    const ffmpeg = await this.startVideoRecording(demoRan);
    const afterTabs = demoRan ? await this.sortAndGroupTabs() : [];

    if (demoRan) {
      await Preparation.delay(3000);
      this.context?.pages()[0]?.bringToFront();
      await Preparation.delay(1000);
      this.tryMacCapture(path.join(SCREENSHOTS_DIR, 'after-sort-native.png'), 'after-sort-native');
    }

    // Stop video BEFORE rendering HTML mockups
    if (ffmpeg) {
      await this.stopVideoRecording(ffmpeg);
    }

    // Render mockups + promo images
    await this.renderMockupScreenshots(beforeTabs, afterTabs);
    await this.generatePromoImages();
    await this.context?.close();

    // Step 8: demo.gif for docs/README.md
    this.generateDemoGif();

    // Step 9: store listing text
    Preparation.step('9/9  Store listing text');
    if (envFlag('SKIP_LISTING')) {
      this.skip('9/9  Store listing text', 'SKIP_LISTING=1');
    } else {
      const listingPath = buildListing();
      console.log(`  Saved: ${path.relative(ROOT, listingPath)}`);
    }

    this.report();
  }

  /* Skip / failure bookkeeping */

  private skip(step: string, reason: string): void {
    this.skipped.push({ step, reason });
    console.warn(`  SKIPPED — ${step}: ${reason}`);
  }

  private fail(step: string, reason: string): void {
    this.failed.push({ step, reason });
    console.error(`  FAILED — ${step}: ${reason}`);
  }

  private report(): void {
    console.log(`\n${'='.repeat(50)}`);
    if (this.skipped.length > 0) {
      console.log(`  ${this.skipped.length} optional step(s) skipped:`);
      for (const entry of this.skipped) {
        console.log(`    - ${entry.step}: ${entry.reason}`);
      }
    }
    if (this.failed.length > 0) {
      console.log(`  ${this.failed.length} step(s) FAILED:`);
      for (const entry of this.failed) {
        console.log(`    - ${entry.step}: ${entry.reason}`);
      }
      console.log('='.repeat(50));
      process.exitCode = 1;
      return;
    }
    console.log('='.repeat(50));
    console.log('\nDone! Screenshots, promo images and description.txt regenerated.');
    process.exitCode = 0;
  }

  private static step(label: string): void {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  ${label}`);
    console.log('='.repeat(50));
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private static errorMessage(err: unknown): string {
    return err instanceof Error ? err.message.split('\n')[0] : String(err);
  }

  /** True once the locator is visible; false (rather than throwing) when it never shows up. */
  private static async isVisible(locator: Locator, timeout = CONTROL_TIMEOUT): Promise<boolean> {
    try {
      await locator.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Probes the demo network from inside the browser, which is the thing that has to reach it --
   * Node may well have a proxy the browser does not. Returns `null` when the page loaded, and the
   * reason it did not otherwise.
   */
  private async browserCanReach(url: string): Promise<string | null> {
    if (!this.context) {
      return 'no browser context';
    }
    const page = await this.context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (response === null) {
        return 'no response';
      }
      return response.ok() ? null : `HTTP ${response.status()}`;
    } catch (err) {
      return Preparation.errorMessage(err);
    } finally {
      await page.close();
    }
  }

  private getWindowBounds(): WindowBounds | null {
    const venvPython = path.join(ROOT, '.venv', 'bin', 'python');
    const cmds = [
      `"${venvPython}" "${GET_WINDOW_ID_SCRIPT}" --bounds`,
      `uv run "${GET_WINDOW_ID_SCRIPT}" --bounds`,
      `python3 "${GET_WINDOW_ID_SCRIPT}" --bounds`,
    ];

    for (const cmd of cmds) {
      try {
        const json = execSync(cmd, { encoding: 'utf-8', cwd: ROOT }).trim();
        return JSON.parse(json);
      } catch {
        /* try next */
      }
    }

    return null;
  }

  /**
   * `screencapture` is macOS-only and needs a real window server; off macOS (or with
   * SKIP_NATIVE=1) the capture is skipped rather than silently swallowed, so the run log says
   * why `*-native.png` did not change.
   */
  private tryMacCapture(filename: string, label: string): boolean {
    if (envFlag('SKIP_NATIVE')) {
      this.skip(`native capture (${label})`, 'SKIP_NATIVE=1');
      return false;
    }
    if (process.platform !== 'darwin') {
      this.skip(
        `native capture (${label})`,
        `macOS-only (screencapture); platform is ${process.platform}`,
      );
      return false;
    }
    try {
      const bounds = this.getWindowBounds();
      if (!bounds) {
        this.skip(`native capture (${label})`, 'could not resolve the Chrome window id');
        return false;
      }
      execSync(`screencapture -l${bounds.id} -x "${filename}"`, { timeout: 5000 });
      return true;
    } catch (err) {
      this.skip(`native capture (${label})`, Preparation.errorMessage(err));
      return false;
    }
  }

  private buildTabBarHtml(tabs: TabInfo[], title: string): string {
    const template = readFileSync(TAB_BAR_TEMPLATE, 'utf-8');
    const tabItems = tabs
      .map(
        (t) => `
    <div class="tab ${t.active ? 'active' : ''}" ${t.groupColor ? `style="border-top: 3px solid ${t.groupColor}"` : ''}>
      <img src="${t.favIconUrl || `https://www.google.com/s2/favicons?domain=${new URL(t.url).hostname}&sz=32`}" width="16" height="16" onerror="this.style.display='none'"/>
      <span class="title">${t.title?.slice(0, 28) || new URL(t.url).hostname}</span>
    </div>`,
      )
      .join('\n');

    return template.replace(/\{\{TITLE\}\}/g, title).replace('{{TABS}}', tabItems);
  }

  /* Pipeline steps */

  private buildExtension(): void {
    Preparation.step('1/9  Building extension');
    if (envFlag('SKIP_BUILD')) {
      this.skip('1/9  Building extension', 'SKIP_BUILD=1');
      if (!existsSync(path.join(DIST, 'manifest.json'))) {
        this.fail('1/9  Building extension', `SKIP_BUILD=1 but there is no build in ${DIST}`);
      }
      return;
    }
    execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
    console.log('Build complete.');
  }

  private async launchBrowser(): Promise<void> {
    Preparation.step('2/9  Launching browser for screenshots & demo');
    const session = await launchExtension({
      dist: DIST,
      preferHeaded: true,
      args: ['--window-size=1400,900', '--window-position=100,50'],
    }).catch((err: unknown) => {
      console.error('Could not launch Chrome with the extension:', Preparation.errorMessage(err));
      process.exit(1);
    });

    this.ext = session;
    this.context = session.context;
    this.serviceWorker = session.serviceWorker;
    this.extensionId = session.extensionId;
    console.log(`Extension ID: ${this.extensionId}`);
  }

  private async takeOptionsScreenshots(): Promise<void> {
    if (!this.context) {
      return;
    }
    Preparation.step('3/9  Options page screenshots');
    if (envFlag('SKIP_OPTIONS')) {
      this.skip('3/9  Options page screenshots', 'SKIP_OPTIONS=1');
      return;
    }
    const optionsUrl = `chrome-extension://${this.extensionId}/options.html`;

    for (const { width, height } of [
      { width: 1280, height: 800 },
      { width: 640, height: 400 },
    ]) {
      const page = await this.context.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(optionsUrl);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('main', { timeout: 5000 });
      await page.waitForTimeout(500);

      const filepath = path.join(SCREENSHOTS_DIR, `screenshot-${width}x${height}.png`);
      await page.screenshot({ path: filepath, fullPage: false });
      console.log(`  Saved: ${filepath}`);
      await page.close();
    }
  }

  /**
   * Sessions dashboard screenshots. The data comes from `scripts/qa/fixtures.ts`, written
   * straight into `chrome.storage.local` through the extension service worker -- no Chrome
   * runtime ids are ever stored, so the records are exactly what a real save would leave behind.
   *
   * Parts of the dashboard (search, import, the history section) are still being built; every
   * capture locates its control by role/accessible name and skips itself with a warning when that
   * control is not there, so this step never fails a release run.
   */
  private async takeDashboardScreenshots(): Promise<void> {
    if (!this.context || !this.ext) {
      return;
    }
    Preparation.step('4/9  Sessions dashboard screenshots');
    if (envFlag('SKIP_DASHBOARD')) {
      this.skip('4/9  Sessions dashboard screenshots', 'SKIP_DASHBOARD=1');
      return;
    }

    const fixtures = buildDashboardFixtures();
    const worker = await this.ext.worker();
    await seedSessions(worker, fixtures);

    const dashboardUrl = `chrome-extension://${this.extensionId}/dashboard.html`;
    const page = await this.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const reload = async (): Promise<void> => {
      await page.goto(dashboardUrl);
      await page.waitForLoadState('networkidle');
      await page.getByRole('banner').getByRole('heading', { name: 'Sessions' }).waitFor({
        timeout: CONTROL_TIMEOUT,
      });
      await page.waitForTimeout(300);
    };

    const shot = async (name: string, prepare: () => Promise<string | null>): Promise<void> => {
      try {
        await reload();
        const problem = await prepare();
        if (problem !== null) {
          this.skip(`dashboard-${name}.png`, problem);
          return;
        }
        await page.waitForTimeout(400);
        const filepath = path.join(SCREENSHOTS_DIR, `dashboard-${name}.png`);
        await page.screenshot({ path: filepath, clip: { x: 0, y: 0, width: 1280, height: 800 } });
        console.log(`  Saved: ${path.relative(ROOT, filepath)}`);
      } catch (err) {
        this.skip(`dashboard-${name}.png`, Preparation.errorMessage(err));
      }
    };

    const cardFor = (name: string): Locator =>
      page.locator('main > ul > li').filter({ hasText: name });

    await shot('sessions', async () => {
      const card = cardFor(fixtures[0].name);
      if (!(await Preparation.isVisible(card))) {
        return `no session card for “${fixtures[0].name}”`;
      }
      const expand = card.getByRole('button', { name: 'Expand' });
      if (!(await Preparation.isVisible(expand))) {
        return 'no Expand control on the session card';
      }
      await expand.first().click();
      await card.getByRole('heading', { name: 'Window 1' }).first().waitFor({
        timeout: CONTROL_TIMEOUT,
      });
      return null;
    });

    await shot('restore', async () => {
      // The confirm dialog only appears above the large-restore threshold, which the second
      // fixture session is built to cross. If the click starts a restore instead, cancel it at
      // once rather than letting a screenshot run open a hundred tabs.
      const card = cardFor(fixtures[1].name);
      if (!(await Preparation.isVisible(card))) {
        return `no session card for “${fixtures[1].name}”`;
      }
      const restore = card.getByRole('button', { name: 'Restore', exact: true });
      if (!(await Preparation.isVisible(restore))) {
        return 'no Restore control on the session card';
      }
      await restore.first().click();

      const dialog = page.getByRole('dialog');
      const cancelRunning = page
        .getByRole('button', { name: /^Cancel(ling)?/ })
        .and(page.locator('output button'));
      if (await Preparation.isVisible(cancelRunning, 2000)) {
        await cancelRunning
          .first()
          .click()
          .catch(() => undefined);
        return 'clicking Restore started the restore directly (no confirm dialog)';
      }
      if (!(await Preparation.isVisible(dialog))) {
        return 'the restore confirm dialog did not open';
      }
      return null;
    });

    await shot('search', async () => {
      const search = page
        .getByRole('searchbox')
        .or(page.getByRole('textbox', { name: /search|filter/i }))
        .or(page.getByPlaceholder(/search|filter/i));
      if (!(await Preparation.isVisible(search))) {
        return 'no search field on the dashboard yet';
      }
      await search.first().fill('github');
      await page.waitForTimeout(500);
      return null;
    });

    await shot('import', async () => {
      const importButton = page.getByRole('button', { name: /^import/i });
      if (!(await Preparation.isVisible(importButton))) {
        return 'no Import control on the dashboard yet';
      }
      await importButton.first().click();
      const dialog = page.getByRole('dialog');
      if (!(await Preparation.isVisible(dialog))) {
        return 'the import dialog did not open';
      }
      const fileInput = dialog.locator('input[type="file"]');
      if ((await fileInput.count()) === 0) {
        return 'the import dialog has no file input to build a preview from';
      }
      const bundle: ExportBundle = {
        app: 'tab-organizer',
        schemaVersion: 1,
        exportedAt: Date.now(),
        sessions: fixtures.slice(0, 2),
      };
      const bundlePath = path.join(os.tmpdir(), 'tab-organizer-import-preview.json');
      writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
      await fileInput.first().setInputFiles(bundlePath);
      const preview = dialog.getByText(new RegExp(fixtures[0].name.slice(0, 12), 'i'));
      if (!(await Preparation.isVisible(preview))) {
        return 'the import dialog never showed a preview of the chosen file';
      }
      return null;
    });

    await shot('history', async () => {
      const control = page
        .getByRole('button', { name: /history/i })
        .or(page.getByRole('tab', { name: /history/i }));
      if (!(await Preparation.isVisible(control))) {
        return 'no history section control on the dashboard yet';
      }
      const target = control.first();
      if ((await target.getAttribute('aria-expanded')) === 'false') {
        await target.click();
        await page.waitForTimeout(400);
      } else {
        await target.click().catch(() => undefined);
        await page.waitForTimeout(400);
      }
      return null;
    });

    await page.close();
  }

  private async takeDemoScreenshots(): Promise<{ beforeTabs: TabInfo[]; nativeBefore: boolean }> {
    if (!this.context || !this.serviceWorker) {
      return { beforeTabs: [], nativeBefore: false };
    }
    Preparation.step('5/9  Demo screenshots (before/after tab sorting)');

    if (envFlag('SKIP_DEMO')) {
      this.skip('5/9  Demo screenshots', 'SKIP_DEMO=1');
      return { beforeTabs: [], nativeBefore: false };
    }
    const reachable = await this.browserCanReach(DEMO_SITES[0]);
    if (reachable !== null) {
      this.skip('5/9  Demo screenshots', `the browser cannot reach ${DEMO_SITES[0]}: ${reachable}`);
      return { beforeTabs: [], nativeBefore: false };
    }

    console.log('  Opening tabs...');
    for (const url of DEMO_SITES) {
      const page = await this.context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    const allPages = this.context.pages();
    if (allPages.length > DEMO_SITES.length) {
      await allPages[0].close();
    }

    console.log('  Waiting for pages to settle...');
    await Preparation.delay(5000);
    await this.context.pages()[0].bringToFront();
    await Preparation.delay(1000);

    const worker = this.ext === null ? this.serviceWorker : await this.ext.worker();
    const beforeTabs: TabInfo[] = await worker.evaluate(async () => {
      const win = await chrome.windows.getCurrent();
      const tabs = await chrome.tabs.query({ windowId: win.id });
      return tabs.map((t) => ({
        url: t.url ?? '',
        title: t.title ?? '',
        favIconUrl: t.favIconUrl ?? '',
        active: t.active,
      }));
    });
    console.log(`  ${beforeTabs.length} tabs open`);

    const nativeBefore = this.tryMacCapture(
      path.join(SCREENSHOTS_DIR, 'before-sort-native.png'),
      'before-sort-native',
    );
    if (nativeBefore) {
      console.log('  Native BEFORE screenshot captured');
    }

    return { beforeTabs, nativeBefore };
  }

  /**
   * Screen recording is macOS-only (ffmpeg's `avfoundation` input) and needs ffmpeg on PATH.
   * Missing either -- or a skipped demo step, which leaves nothing worth filming -- means no
   * video, and later `demo.gif` sees no `demo.mp4` and skips too.
   */
  private async startVideoRecording(demoRan: boolean): Promise<ChildProcess | null> {
    Preparation.step('6/9  Video recording & tab sorting');
    if (envFlag('SKIP_VIDEO')) {
      this.skip('6/9  Video recording', 'SKIP_VIDEO=1');
      return null;
    }
    if (!demoRan) {
      this.skip('6/9  Video recording', 'the demo step was skipped, so there is nothing to record');
      return null;
    }
    if (!commandExists('ffmpeg')) {
      this.skip('6/9  Video recording', 'ffmpeg is not installed');
      return null;
    }
    if (process.platform !== 'darwin') {
      this.skip(
        '6/9  Video recording',
        `ffmpeg avfoundation capture is macOS-only; platform is ${process.platform}`,
      );
      return null;
    }

    try {
      const deviceInfo = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
        encoding: 'utf-8',
      });
      const screenMatch = deviceInfo.match(/\[(\d+)] Capture screen/);
      const screenIndex = screenMatch ? screenMatch[1] : '1';

      const bounds = this.getWindowBounds();
      const isRetina = execSync('system_profiler SPDisplaysDataType 2>/dev/null || true', {
        encoding: 'utf-8',
      }).includes('Retina');
      const scale = isRetina ? 2 : 1;
      const cropFilter = bounds
        ? `-vf crop=${bounds.width * scale}:${bounds.height * scale}:${bounds.x * scale}:${bounds.y * scale}`
        : '';

      const proc = spawn(
        'ffmpeg',
        [
          '-y',
          '-f',
          'avfoundation',
          '-capture_cursor',
          '0',
          '-framerate',
          '30',
          '-i',
          `${screenIndex}:none`,
          '-t',
          '15',
          ...(cropFilter ? cropFilter.split(' ') : []),
          '-vcodec',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          path.join(SCREENSHOTS_DIR, 'demo.mp4'),
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      console.log(
        `  Recording started${bounds ? ` (cropped to ${bounds.width}x${bounds.height})` : ''}`,
      );
      await Preparation.delay(2000);
      return proc;
    } catch (err) {
      this.skip('6/9  Video recording', Preparation.errorMessage(err));
      return null;
    }
  }

  private async stopVideoRecording(proc: ChildProcess): Promise<void> {
    await Preparation.delay(2000);
    proc.stdin?.write('q');
    await new Promise<void>((resolve) => {
      proc.on('close', resolve);
      setTimeout(resolve, 5000);
    });
    console.log('  Video saved: screenshots/demo.mp4');
  }

  private async sortAndGroupTabs(): Promise<TabInfo[]> {
    if (!this.serviceWorker) {
      return [];
    }
    console.log('  Sorting and grouping tabs...');
    const worker = this.ext === null ? this.serviceWorker : await this.ext.worker();

    return worker.evaluate(async () => {
      const currentWindow = await chrome.windows.getCurrent();
      const tabs = await chrome.tabs.query({ windowId: currentWindow.id });

      const sorted = [...tabs].sort((a, b) => {
        try {
          const hostA = new URL(a.url || '').hostname.replace('www.', '');
          const hostB = new URL(b.url || '').hostname.replace('www.', '');
          return hostA.localeCompare(hostB);
        } catch {
          return 0;
        }
      });

      for (let i = 0; i < sorted.length; i++) {
        const tabId = sorted[i].id;
        if (tabId !== undefined) {
          await chrome.tabs.move(tabId, { index: i });
        }
      }

      const domainMap = new Map<string, number[]>();
      const updatedTabs = await chrome.tabs.query({ windowId: currentWindow.id });
      for (const tab of updatedTabs) {
        try {
          const host = new URL(tab.url || '').hostname.replace('www.', '');
          if (!domainMap.has(host)) {
            domainMap.set(host, []);
          }
          const ids = domainMap.get(host);
          if (ids && tab.id !== undefined) {
            ids.push(tab.id);
          }
        } catch {
          /* skip */
        }
      }

      const colors = [
        'blue',
        'red',
        'yellow',
        'green',
        'pink',
        'purple',
        'cyan',
        'orange',
      ] as const;
      const groupInfo: { domain: string; color: string }[] = [];
      let idx = 0;
      for (const [domain, tabIds] of domainMap) {
        if (tabIds.length > 1 && tabIds.every((id) => id !== undefined)) {
          const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
          const color = colors[idx % colors.length];
          await chrome.tabGroups.update(groupId, { title: domain.split('.')[0], color });
          groupInfo.push({ domain, color });
          idx++;
        }
      }

      const finalTabs = await chrome.tabs.query({ windowId: currentWindow.id });
      return finalTabs.map((t) => {
        const host = new URL(t.url || '').hostname.replace('www.', '');
        const group = groupInfo.find((g) => g.domain === host);
        return {
          url: t.url ?? '',
          title: t.title ?? '',
          favIconUrl: t.favIconUrl ?? '',
          active: t.active,
          groupColor: group?.color || null,
        };
      });
    });
  }

  /** The page promo images are rendered on; created lazily so a skipped mockup step is fine. */
  private async ensureScreenshotPage(): Promise<Page | null> {
    if (this.screenshotPage) {
      return this.screenshotPage;
    }
    if (!this.context) {
      return null;
    }
    this.screenshotPage = await this.context.newPage();
    await this.screenshotPage.setViewportSize({ width: 1280, height: 800 });
    return this.screenshotPage;
  }

  private async renderMockupScreenshots(
    beforeTabs: TabInfo[],
    afterTabs: TabInfo[],
  ): Promise<void> {
    if (!this.context) {
      return;
    }
    Preparation.step('7/9  Tab-bar mockups & promotional images');
    if (envFlag('SKIP_MOCKUPS')) {
      this.skip('7/9  Tab-bar mockups', 'SKIP_MOCKUPS=1');
      return;
    }
    if (beforeTabs.length === 0 && afterTabs.length === 0) {
      this.skip('7/9  Tab-bar mockups', 'the demo step produced no tabs to draw');
      return;
    }
    console.log('  Rendering tab bar mockups...');

    const afterTabsWithColors = afterTabs.map((t) => ({
      ...t,
      groupColor: t.groupColor ? GROUP_COLORS[t.groupColor] || t.groupColor : null,
    }));

    const beforeHtml = this.buildTabBarHtml(beforeTabs, 'Before — Tabs in random order');
    const afterHtml = this.buildTabBarHtml(
      afterTabsWithColors,
      'After — Sorted and grouped by domain',
    );

    const beforePath = path.join(SCREENSHOTS_DIR, 'before-sort.html');
    const afterPath = path.join(SCREENSHOTS_DIR, 'after-sort.html');
    writeFileSync(beforePath, beforeHtml);
    writeFileSync(afterPath, afterHtml);

    const page = await this.ensureScreenshotPage();
    if (page === null) {
      return;
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`file://${beforePath}`);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'before-sort.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });
    console.log('  Saved: screenshots/before-sort.png');

    await page.goto(`file://${afterPath}`);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'after-sort.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });
    console.log('  Saved: screenshots/after-sort.png');
  }

  private generateDemoGif(): void {
    Preparation.step('8/9  Demo GIF');
    if (envFlag('SKIP_GIF')) {
      this.skip('8/9  Demo GIF', 'SKIP_GIF=1');
      return;
    }
    const video = path.join(SCREENSHOTS_DIR, 'demo.mp4');
    const gif = path.join(SCREENSHOTS_DIR, 'demo.gif');
    if (!commandExists('ffmpeg')) {
      this.skip('8/9  Demo GIF', 'ffmpeg is not installed');
      return;
    }
    if (!existsSync(video)) {
      this.skip('8/9  Demo GIF', 'screenshots/demo.mp4 does not exist');
      return;
    }
    try {
      // 10 fps, 800px wide, 128-colour palette: ~170 KB for the 8 s demo
      const filter =
        'fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5';
      execSync(`ffmpeg -y -v error -i "${video}" -vf "${filter}" "${gif}"`, { timeout: 60000 });
      console.log('  Saved: screenshots/demo.gif');
    } catch (err) {
      this.skip('8/9  Demo GIF', `ffmpeg failed: ${Preparation.errorMessage(err)}`);
    }
  }

  private async generatePromoImages(): Promise<void> {
    if (envFlag('SKIP_PROMO')) {
      this.skip('7/9  Promotional images', 'SKIP_PROMO=1');
      return;
    }
    const page = await this.ensureScreenshotPage();
    if (page === null) {
      return;
    }
    console.log('  Generating promotional images...');

    const promoSizes = [
      { width: 440, height: 280, name: 'promo-small-440x280', titleSize: 28, descSize: 14 },
      { width: 1400, height: 560, name: 'promo-marquee-1400x560', titleSize: 48, descSize: 20 },
    ];

    const promoTemplate = readFileSync(PROMO_TEMPLATE, 'utf-8');

    for (const { width, height, name, titleSize, descSize } of promoSizes) {
      const html = promoTemplate
        .replace('{{WIDTH}}', String(width))
        .replace('{{HEIGHT}}', String(height))
        .replace('{{TITLE_SIZE}}', String(titleSize))
        .replace('{{DESC_SIZE}}', String(descSize))
        .replace('{{ICON_PATH}}', `file://${ICON_PATH}`);

      const htmlPath = path.join(SCREENSHOTS_DIR, `${name}.html`);
      writeFileSync(htmlPath, html);

      await page.setViewportSize({ width, height });
      await page.goto(`file://${htmlPath}`);
      await page.waitForTimeout(500);

      const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
      await page.screenshot({
        path: filepath,
        clip: { x: 0, y: 0, width, height },
      });
      console.log(`  Saved: ${name}.png`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('prepare-registration failed:', err);
  process.exitCode = 1;
});
