/**
 * Tiny static site for browser-driven QA.
 *
 * The QA browser has no outbound network (external navigations fail with
 * ERR_TUNNEL_CONNECTION_FAILED), so every page a fixture window opens has to come from here:
 * a `node:http` server bound to 127.0.0.1 on an ephemeral port.
 *
 * Pages are deliberately boring — a title, a heading, a solid accent colour — but each one is
 * distinct, so an assertion over restored tab URLs/titles is meaningful and a screenshot of a
 * restored window is readable.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface DemoPage {
  /** Path served, e.g. `/p/1`. */
  path: string;
  /** `<title>` — also the tab title Chrome reports. */
  title: string;
  /** CSS colour for the page's banner. */
  accent: string;
}

export const DEMO_PAGES: DemoPage[] = [
  { path: '/p/1', title: 'Inbox — Mail', accent: '#2563eb' },
  { path: '/p/2', title: 'Team calendar', accent: '#0891b2' },
  { path: '/p/3', title: 'Design review notes', accent: '#7c3aed' },
  { path: '/p/4', title: 'Spec — sessions', accent: '#c026d3' },
  { path: '/p/5', title: 'Issue 412 — restore order', accent: '#dc2626' },
  { path: '/p/6', title: 'Issue 418 — group colours', accent: '#ea580c' },
  { path: '/p/7', title: 'Release checklist', accent: '#16a34a' },
  { path: '/p/8', title: 'Docs — keyboard shortcuts', accent: '#ca8a04' },
];

export interface DemoServer {
  /** e.g. `http://127.0.0.1:41234` */
  origin: string;
  /** Absolute URLs, in the same order as {@link DEMO_PAGES}. */
  urls: string[];
  close(): Promise<void>;
}

function renderPage(page: DemoPage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${page.title}</title>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #111; background: #fff; }
      header { background: ${page.accent}; color: #fff; padding: 24px 32px; }
      h1 { margin: 0; font-size: 22px; }
      main { padding: 24px 32px; color: #444; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <header><h1>${page.title}</h1></header>
    <main>
      <p>Local QA fixture page served at <code>${page.path}</code>.</p>
    </main>
  </body>
</html>`;
}

/** Starts the fixture site on 127.0.0.1 and resolves once it is accepting connections. */
export async function startDemoServer(): Promise<DemoServer> {
  const byPath = new Map(DEMO_PAGES.map((page) => [page.path, page]));

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const page = byPath.get(path);
    if (page === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPage(page));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    urls: DEMO_PAGES.map((page) => `${origin}${page.path}`),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
