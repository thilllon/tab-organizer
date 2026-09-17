/**
 * Launching a real Chrome with the built extension loaded, for QA and for release screenshots.
 *
 * Two environment facts this wraps:
 *  - Playwright's own pinned browser build is not always present. `PW_CHROMIUM` (default
 *    `/opt/pw-browsers/chromium`) points at a Chromium that is; when neither exists we fall back
 *    to Playwright's default resolution and let it report its own error.
 *  - Extensions do load in headless Chrome, so headless is the default anywhere without a
 *    display. `HEADLESS=0` forces a headed run (needed for native screen capture / recording).
 */

import { existsSync } from 'node:fs';
import { type BrowserContext, chromium, type Worker } from '@playwright/test';

const DEFAULT_CHROMIUM = '/opt/pw-browsers/chromium';

/**
 * Absolute path to the Chromium binary to drive, or `undefined` to let Playwright resolve its
 * own pinned build. `PW_CHROMIUM` wins; otherwise the well-known sandbox path is used when it
 * exists.
 */
export function resolveChromiumExecutable(): string | undefined {
  const fromEnv = process.env.PW_CHROMIUM;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  return existsSync(DEFAULT_CHROMIUM) ? DEFAULT_CHROMIUM : undefined;
}

/** Headless unless `HEADLESS=0`, or unless a display is available on Linux and `HEADLESS=1` is unset. */
export function resolveHeadless(preferHeaded: boolean): boolean {
  const flag = process.env.HEADLESS;
  if (flag === '0' || flag === 'false') {
    return false;
  }
  if (flag === '1' || flag === 'true') {
    return true;
  }
  if (!preferHeaded) {
    return true;
  }
  // A headed run was asked for, but there is nothing to show it on.
  return process.platform === 'linux' && (process.env.DISPLAY ?? '') === '';
}

export interface LaunchOptions {
  /** Absolute path to the built extension (the `dist/` directory). */
  dist: string;
  /** Extra Chrome switches, appended after the extension-loading ones. */
  args?: string[];
  /**
   * `true` when the caller would rather have a visible window (screen recording, native capture).
   * Ignored when there is no display — see {@link resolveHeadless}.
   */
  preferHeaded?: boolean;
  /** How long to wait for the extension service worker to register. Default 15 s. */
  serviceWorkerTimeout?: number;
}

export interface ExtensionSession {
  context: BrowserContext;
  /** The extension's MV3 service worker as it was at launch — prefer {@link worker}. */
  serviceWorker: Worker;
  extensionId: string;
  /**
   * The *current* service worker, with its extension API bindings confirmed present. Chrome may
   * terminate an idle MV3 worker and start a fresh one; the old `Worker` handle is then dead and
   * `evaluate` on it rejects. Always call this rather than caching the handle.
   */
  worker(): Promise<Worker>;
  /** `chrome-extension://<id>/<page>` */
  pageUrl(page: string): string;
  close(): Promise<void>;
}

async function firstServiceWorker(context: BrowserContext, timeout: number): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing !== undefined) {
    return existing;
  }
  return context.waitForEvent('serviceworker', { timeout: Math.max(timeout, 500) });
}

/**
 * `tsx` compiles with esbuild's `keepNames`, which rewrites every *named* inner function of an
 * `evaluate()` callback into `__name(fn, 'fn')`. That helper only exists in the Node bundle, so
 * the browser side throws `ReferenceError: __name is not defined`. Defining an identity `__name`
 * in the target context makes those callbacks work verbatim. Passed as a source string so esbuild
 * cannot rewrite the shim itself.
 */
const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (fn) { return fn; };';

/** Installs the `__name` shim (see {@link NAME_SHIM}) into a worker or page context. */
export async function installNameShim(target: {
  evaluate(expression: string): Promise<unknown>;
}): Promise<void> {
  await target.evaluate(NAME_SHIM);
}

/**
 * The MV3 worker target shows up before Chrome has installed the extension API bindings into its
 * global scope: for a short window `chrome` there holds only the page-level `csi`/`loadTimes`, and
 * `chrome.windows.create` throws "Cannot read properties of undefined". Poll until the APIs this
 * tooling drives are actually there.
 */
async function workerWithApis(context: BrowserContext, timeout: number): Promise<Worker> {
  const deadline = Date.now() + timeout;
  let lastError = 'the extension service worker never exposed chrome.tabs / chrome.windows';
  for (;;) {
    const worker = await firstServiceWorker(context, deadline - Date.now());
    try {
      const ready = await worker.evaluate(() => {
        const api = (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome;
        return (
          typeof api?.windows === 'object' &&
          typeof api?.tabs === 'object' &&
          typeof api?.tabGroups === 'object' &&
          typeof api?.storage === 'object'
        );
      });
      if (ready) {
        await installNameShim(worker);
        return worker;
      }
    } catch (err) {
      // The worker was replaced mid-poll (Chrome recycles idle MV3 workers); take the next one.
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) {
      throw new Error(lastError);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Launches a persistent context with `dist/` loaded as an unpacked extension. */
export async function launchExtension(options: LaunchOptions): Promise<ExtensionSession> {
  const { dist, args = [], preferHeaded = false, serviceWorkerTimeout = 15_000 } = options;
  const executablePath = resolveChromiumExecutable();

  const context = await chromium.launchPersistentContext('', {
    ...(executablePath === undefined ? {} : { executablePath }),
    headless: resolveHeadless(preferHeaded),
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      ...args,
    ],
  });

  const serviceWorker = await workerWithApis(context, serviceWorkerTimeout);
  const extensionId = serviceWorker.url().split('/')[2];

  return {
    context,
    serviceWorker,
    extensionId,
    async worker(): Promise<Worker> {
      return workerWithApis(context, serviceWorkerTimeout);
    },
    pageUrl: (page: string) => `chrome-extension://${extensionId}/${page}`,
    close: () => context.close(),
  };
}
