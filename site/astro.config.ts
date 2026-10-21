import { fileURLToPath } from 'node:url';

import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../src/constants';

// The site is served as a GitHub Pages project site, so every URL sits under /tab-organizer/.
// The screenshots, PRIVACY_POLICY.md and package.json are read from the repository root above
// this package, so the dev server is allowed to serve files from there.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The site speaks the extension's languages (src/constants.ts), English without a prefix.
const LOCALES: string[] = [...SUPPORTED_LOCALES];

export default defineConfig({
  site: 'https://thilllon.github.io',
  base: '/tab-organizer',
  trailingSlash: 'always',
  output: 'static',
  devToolbar: { enabled: false },
  i18n: {
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: Object.fromEntries(LOCALES.map((code) => [code, code])),
      },
    }),
  ],
  vite: {
    server: { fs: { allow: [repoRoot] } },
  },
});
