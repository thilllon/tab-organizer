import path from 'node:path';
import { crx, defineManifest } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import packageJson from './package.json';

interface PackageJson {
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
}

const pkg: PackageJson = packageJson;

const manifest = defineManifest((env) => {
  const isDev = env.mode === 'development';

  return {
    name: `${pkg.displayName ?? pkg.name ?? ''}${isDev ? ' Dev' : ''}`,
    description: pkg.description ?? '',
    version: pkg.version ?? '0.0.0',
    manifest_version: 3,
    // Floor for the APIs used without a runtime guard:
    // - 123: promise-form `chrome.contextMenus.removeAll()` (awaited in src/background/sessions.ts)
    // - 104: the `favicon` permission / `_favicon/` endpoint (dashboard tab rows)
    // `chrome.storage.local.getKeys()` (130) is behind a `typeof` guard, so it does not raise this.
    minimum_chrome_version: '123',
    icons: {
      16: 'img/logo-16.png',
      32: 'img/logo-32.png',
      48: 'img/logo-48.png',
      128: 'img/logo-128.png',
    },
    action: {
      default_icon: 'img/logo-48.png',
      // Hovering the icon is the cheapest way to learn the two gestures; the name alone taught
      // nobody that the right-click menu exists.
      default_title: 'Tab Organizer — click to sort tabs, right-click for sessions',
    },
    // Chrome's own "Options" item opens the app's Settings view — one page, one place for
    // everything (a fragment is allowed here; verified in Chrome for Testing 151).
    options_page: 'app.html#settings',
    background: {
      service_worker: 'src/background/index.ts',
      type: 'module',
    },
    web_accessible_resources: [
      {
        resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
        matches: [],
      },
    ],
    // `alarms` is touched at module-evaluation time (`chrome.alarms.onAlarm.addListener` in
    // src/background/sessions.ts), so it must ship with that listener — see AGENTS.md.
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'contextMenus',
      'unlimitedStorage',
      'favicon',
      'alarms',
    ],
    // Shipped unbound on purpose: Chrome silently drops conflicting suggested_key values and the
    // UI must not promise a key. Users bind them at chrome://extensions/shortcuts.
    commands: {
      'save-session': { description: 'Save the current window as a session' },
      'open-dashboard': { description: 'Open the Sessions dashboard' },
      'assemble-tabs': { description: 'Move the tabs of all other windows into this window' },
    },
  };
});

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      // Chrome has supported `<link rel="modulepreload">` natively since long before the
      // `minimum_chrome_version` this extension declares, so the polyfill is dead code — and it
      // ships a bare `fetch()` that a store reviewer auditing our "no network requests" claim
      // would have to rule out by hand. Drop it.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          app: 'app.html',
          // Kept so old pinned tabs and bookmarks still land somewhere: both redirect to app.html.
          options: 'options.html',
          dashboard: 'dashboard.html',
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      cors: true,
      // The HMR websocket rides on the dev server above, but the *client* still has to be told
      // which port to dial, and it infers one from `location` when nothing says otherwise. On a
      // `chrome-extension://` page `location.port` is the empty string, so the first attempt went
      // to `ws://localhost:/` and always failed. Vite then retried its "direct" target and HMR did
      // come up, so this is not the difference between working and broken — it is the difference
      // between connecting and connecting after a websocket error on every single page load.
      // `clientPort` rewrites only the client's URL; `ws.port` would instead move the socket onto
      // a second listener, which nothing here wants (crxjs builds its own service-worker client
      // against `server.port`). crxjs sets `server.hmr.host` and no port at all, and Vite 8 folds
      // `server.hmr.*` into `server.ws.*` with an explicit `ws` value winning, so this is the one
      // place the port can be pinned.
      ws: { clientPort: 5173 },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [crx({ manifest }), react(), tailwindcss()],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
    test: {
      setupFiles: ['src/test/setup.ts'],
      // Only this tree's suites: Claude Code worktrees under .claude/ carry their own copies.
      exclude: [...configDefaults.exclude, '.claude/**'],
    },
  };
});
