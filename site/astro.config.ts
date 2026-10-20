import { fileURLToPath } from 'node:url';

import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// The site is served as a GitHub Pages project site, so every URL sits under /tab-organizer/.
// The screenshots, PRIVACY_POLICY.md and package.json are read from the repository root above
// this package, so the dev server is allowed to serve files from there.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const LOCALES = ['en', 'ko', 'es', 'ja'];

export default defineConfig({
  site: 'https://thilllon.github.io',
  base: '/tab-organizer',
  trailingSlash: 'always',
  output: 'static',
  devToolbar: { enabled: false },
  i18n: {
    locales: LOCALES,
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', ko: 'ko', es: 'es', ja: 'ja' },
      },
    }),
  ],
  vite: {
    server: { fs: { allow: [repoRoot] } },
  },
});
