/**
 * Plain values the owner tunes: the default keys the manifest (`vite.config.ts`) and the Settings
 * view (`src/lib/command-rows.ts`) both read, the optional YouTube host permission, and the
 * automatic lazy-restore threshold.
 *
 * `vite.config.ts` imports this file while building the manifest, in Node, so it must stay plain
 * data: no `chrome.*`, no imports from the rest of `src/`.
 */

/**
 * The keys the manifest suggests, by command id. Written the way Chrome wants them in
 * `suggested_key`; on a Mac Chrome reads Alt as Option. A command that is not listed here ships
 * without a key. Chrome drops a suggestion silently when another extension already holds the key,
 * so nothing may promise these - Settings shows what `chrome.commands.getAll()` reports.
 */
export const DEFAULT_SHORTCUTS = {
  /** Chrome's built-in command for a click on the toolbar icon, which sorts. */
  _execute_action: 'Alt+Shift+S',
  'assemble-tabs': 'Alt+Shift+A',
  'pause-youtube': 'Alt+Shift+P',
} as const;

/**
 * The sites "Pause all YouTube videos" may run on: the manifest's `optional_host_permissions`
 * (vite.config.ts) and what `src/lib/pause-youtube.ts` asks Chrome for, queries and checks. Chrome
 * grants it only when the person allows it in Settings, never at install. `*.youtube.com` also
 * covers youtube.com itself, www, m and music.
 */
export const YOUTUBE_ORIGINS = ['https://*.youtube.com/*'] as const;

/**
 * "Load tabs lazily: Automatic" leaves the tabs of a restore unloaded (discarded until clicked)
 * when it opens more than this many tabs. Settings shows the number in the option's label.
 */
export const LAZY_AUTO_THRESHOLD = 10;

/**
 * The languages the extension ships in, default first: one `public/_locales/<code>/messages.json`
 * each, and the choices of the language menu in Settings. The one list to extend when a language
 * is added; every other list (the store listing, the test checks, the screenshot scripts) is typed
 * from it, so the type checker then names each file that still lacks the new language.
 */
export const SUPPORTED_LOCALES = ['en', 'ko', 'es', 'ja'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** The manifest's `default_locale`: every message exists in it, and every language falls back to it. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Each language's own name for itself, as the language menu shows it. Never translated: a person
 * looking for their language finds it written the way they write it, whatever the page is in now.
 */
export const LOCALE_ENDONYMS: Record<SupportedLocale, string> = {
  en: 'English',
  ko: '한국어',
  es: 'Español',
  ja: '日本語',
};

/** Where cloud sync talks to and which Google OAuth client signs in to it. */
export interface CloudSyncConfig {
  /** The sync server's origin, such as `https://tabinet.example.app`; the routes live under `/v1`. */
  apiBase: string;
  /** The Google OAuth client id ("Web application", redirect `https://<extension-id>.chromiumapp.org/`). */
  googleClientId: string;
}

/**
 * Cloud sync (sign-in, the sync passphrase and the server client in `src/lib/cloud-*.ts`). Empty
 * on purpose: until both values are filled in, the feature is dormant - the manifest asks for no
 * `identity` permission and Settings shows no Account section, so a build is exactly what it was
 * without it. Tests switch it on through `overrideCloudSyncConfig()` in `src/lib/cloud-config.ts`.
 */
export const CLOUD_SYNC: CloudSyncConfig = { apiBase: '', googleClientId: '' };

/** Whether cloud sync is set up: true only when both the server and the Google client are named. */
export function cloudSyncConfigured(config: CloudSyncConfig = CLOUD_SYNC): boolean {
  return config.apiBase.trim() !== '' && config.googleClientId.trim() !== '';
}

/**
 * The manifest permissions cloud sync adds (`vite.config.ts` spreads them): `identity`, for
 * `chrome.identity.launchWebAuthFlow`, and only once it is configured. Nothing touches
 * `chrome.identity` while the module body runs, so no load-time code depends on it.
 */
export function cloudSyncPermissions(config: CloudSyncConfig = CLOUD_SYNC): 'identity'[] {
  return cloudSyncConfigured(config) ? ['identity'] : [];
}
