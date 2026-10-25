/**
 * Everything typed into the Chrome Web Store Developer Dashboard, as data. Edit the text here;
 * `pnpm store:bundle` writes it into `release/store-<version>/SUBMIT.md` and
 * `src/tests/store-listing.test.ts` checks it on every `pnpm test`.
 *
 * Title and Summary are not here: the store reads them out of the package (`extName` and
 * `extDescription` in `public/_locales/<code>/messages.json`), so they are changed there.
 * Each Description is plain text in its own language; everything else is English.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  YOUTUBE_ORIGINS,
} from '../src/constants';

/** Store listing > Description, per language: pasted as it is (no Markdown, at most 500). */
export const STORE_DESCRIPTIONS: Record<ListingLocale, string> = {
  en: `One click on the icon sorts every tab in the window by site, title or URL, groups them and clears duplicates.

• Save windows as sessions and restore them later, with tab groups and pinned tabs
• Automatic snapshots bring your tabs back after a crash
• Assemble! pulls every window into one
• Search, import and export your sessions

No account, no tracking: everything stays on your device.

Guide and FAQ: https://thilllon.github.io/tab-organizer/support/`,
  ko: `아이콘을 한 번 누르면 창의 모든 탭이 사이트, 제목, URL 순으로 정렬되고 그룹으로 묶이며 중복 탭이 정리됩니다.

• 창을 세션으로 저장했다가 탭 그룹, 고정 탭까지 그대로 복원
• 자동 스냅샷으로 브라우저가 꺼져도 탭 복구
• 모두 모으기로 여러 창을 한 창에
• 세션 검색, 가져오기, 내보내기

계정도 추적도 없습니다. 모든 데이터는 이 기기에만 저장됩니다.

사용법과 FAQ: https://thilllon.github.io/tab-organizer/ko/support/`,
  es: `Un clic en el icono ordena todas las pestañas de la ventana por sitio, título o URL, las agrupa y elimina los duplicados.

• Guarda ventanas como sesiones y restáuralas con sus grupos y pestañas fijadas
• Las instantáneas automáticas recuperan tus pestañas tras un fallo
• ¡Reunir! junta todas las ventanas en una
• Busca, importa y exporta sesiones

Sin cuenta ni rastreo: todo se queda en tu dispositivo.

Guía y preguntas frecuentes: https://thilllon.github.io/tab-organizer/es/support/`,
  ja: `アイコンをクリックするだけで、ウィンドウ内のすべてのタブをサイト、タイトル、URL 順に並べ替え、グループにまとめ、重複タブを整理します。

• ウィンドウをセッションとして保存し、タブグループや固定タブごと復元
• 自動スナップショットで、クラッシュ後もタブを復旧
• 集合！ですべてのウィンドウを 1 つに
• セッションの検索、インポート、エクスポート

アカウント不要、追跡なし。データはすべてこのデバイスに保存されます。

使い方と FAQ: https://thilllon.github.io/tab-organizer/ja/support/`,
};

/** Store listing tab: the fields besides Description and images. */
export const PRODUCT_DETAILS = {
  category: 'Functionality & UI',
  homepageUrl: 'https://thilllon.github.io/tab-organizer/',
  supportUrl: 'https://thilllon.github.io/tab-organizer/support/',
  privacyPolicyUrl: 'https://thilllon.github.io/tab-organizer/privacy/',
  matureContent: 'No',
  promoVideo: 'None (the store takes a YouTube URL only)',
} as const;

/** Distribution tab. */
export const DISTRIBUTION = {
  visibility: 'Public',
  regions: 'All regions',
  pricing: 'Free',
} as const;

/** Privacy tab > Single purpose. */
export const SINGLE_PURPOSE =
  'Organize browser tabs: sort and group the tabs of the current window (by URL, title or domain, optionally removing or grouping duplicates), gather every window into one, pause the videos of every YouTube tab on request, and save, restore, search, import and export sets of windows and tabs as sessions, all stored locally on the device.';

/** Privacy tab > one justification per manifest permission (the test keeps the two lists equal). */
export const PERMISSION_JUSTIFICATIONS: Record<string, string> = {
  tabs: `Required to read tab URLs and titles for sorting, for saving sessions and for the dashboard's live list of open windows, and to create tabs when restoring. Uses chrome.tabs.query()/chrome.windows.getAll() to read, chrome.tabs.move() to reorder and chrome.tabs.create()/chrome.tabs.discard() to restore. Tab data is stored only in local extension storage on the device when the user saves a session or while automatic snapshots run; it is never transmitted.`,
  tabGroups: `Required to sort existing tab groups by title, to group duplicate tabs when the user enables that option, and to recreate a session's tab groups (title, color, collapsed state) on restore. Uses chrome.tabGroups.query(), move() and update().`,
  storage: `Required to persist user preferences (sort method, grouping mode, duplicate handling, the extension's display language) via chrome.storage.sync, and to store saved sessions, automatic snapshots and session settings (tab URLs, titles, pinned state, group names/colors and window layout) via chrome.storage.local on this device only. Session data is never synced or transmitted; the user can delete any session, or all session data, from the dashboard.`,
  contextMenus: `Adds "Assemble!" (gather every window's tabs into the current one), "Save all windows as session" and "Pause all YouTube videos" to the extension icon's right-click menu (contexts: ['action'] only; no menu items are added to web pages).`,
  unlimitedStorage: `Lets saved sessions and snapshots exceed the default 10 MB chrome.storage.local quota for users with thousands of tabs. Data stays in local extension storage on the device; nothing is uploaded.`,
  favicon: `Displays site icons next to tabs in the dashboard by reading Chrome's local favicon cache through chrome-extension://<id>/_favicon/. No favicon is fetched from the network and no favicon data is stored.`,
  scripting: `Used only by "Pause all YouTube videos", which the user chooses from the icon's right-click menu or its keyboard shortcut: chrome.scripting.executeScript() runs one function packaged with the extension in each open YouTube tab. It calls pause() on every video and audio element that is playing and returns only how many it paused; it reads nothing from the page, and nothing is stored or transmitted. It can run only on the optional host permission https://*.youtube.com/*, which the user grants in Settings and can remove there; without it no script runs anywhere.`,
  alarms: `A chrome.alarms timer that wakes the service worker on the user's chosen interval (any whole number of minutes from 1 to 1440; 5 by default) to take an automatic local snapshot of open windows for crash recovery. When the user turns snapshots off, no alarm exists. The worker still wakes briefly at browser start, on install or update, and when a setting changes, in every case to do local bookkeeping only.`,
};

/**
 * Privacy tab > host permission justification, one per optional host permission of the manifest
 * (the test keeps the two lists equal). Nothing is requested at install.
 */
export const OPTIONAL_HOST_PERMISSION_JUSTIFICATIONS: Record<string, string> = {
  [YOUTUBE_ORIGINS[0]]: `Optional, never requested at install: the user grants it with "Allow access" in Settings when they want to use "Pause all YouTube videos" (the right-click menu item opens Settings until it is granted), and can remove it there at any time. With it, the extension pauses the video and audio elements of open YouTube tabs when the user asks; it reads nothing from YouTube pages and stores or transmits nothing about them. It covers youtube.com and its subdomains (www, m, music).`,
};

/** Privacy tab > host permissions, content scripts and remote code. */
export const HOST_PERMISSIONS_AND_REMOTE_CODE = `Host permissions: none at install; one optional host permission, ${YOUTUBE_ORIGINS.join(', ')}, granted only by the user in Settings (see its justification). Content scripts: none declared; on the user's command, chrome.scripting injects one function packaged with the extension into YouTube tabs to pause their videos. Remote code: not used.`;

/** Privacy tab > Data usage. */
export const DATA_USAGE = `The extension does not collect or transmit any user data. When the user saves a session, or while automatic snapshots are enabled (the default), tab URLs, titles and window/group layout are written to chrome.storage.local on the user's device only; they are never sent anywhere, and the user can delete them at any time (per session, per snapshot, or all at once with "Delete all session data"). Export creates a file or clipboard text only when the user explicitly asks for it. "Pause all YouTube videos" runs only in YouTube tabs, only after the user allowed access to YouTube, and only presses pause; it reads no page content.`;

/** Privacy tab > the three certifications: all apply, tick every one. */
export const DATA_CERTIFICATIONS: readonly string[] = [
  'Does not sell user data to third parties.',
  "Does not use or transfer user data for purposes unrelated to the item's core functionality.",
  'Does not use or transfer user data to determine creditworthiness or for lending purposes.',
];

/** Privacy tab > data types: tick Web history only, with this justification. */
export const DATA_TYPES = {
  ticked: 'Web history',
  justification: `URLs and titles of the user's open tabs are stored locally on the device when the user saves a session and by the automatic snapshot feature (on by default, can be turned off); nothing is transmitted off the device.`,
  notCollected:
    'personally identifiable information, health, financial, authentication, personal communications, location, user activity, website content',
} as const;

/** Test instructions tab, for the reviewer. There is no account: username and password stay empty. */
export const TEST_INSTRUCTIONS = `No account, login or server is needed; leave the username and password empty. Everything runs locally.

1. Open a few tabs from different sites in one window, in mixed order, with one address open twice.
2. Click the toolbar icon. There is no popup: the tabs are sorted by URL (site first) at once and the duplicate tab is closed.
3. Right-click the icon and choose "Save all windows as session". The icon shows a check mark for a moment.
4. Right-click the icon and choose "Options". The Tab Organizer page opens; its sidebar has Open tabs, Saved and Automatic snapshots. Pick the saved session and click Open to restore it.
5. With two or more windows open, right-click the icon and choose "Assemble! (move every window's tabs into this one)". Every tab moves into the current window.
6. On that page, the Settings button at the top opens Settings: set Sort by to Custom and click the toolbar icon again; tabs from the same site now sit next to each other, the first site seen first. Set Duplicate tabs to "Group them" to put duplicate tabs into a tab group instead of closing them. Automatic snapshots, the language and Backup (export, import) are there too.
7. Open two YouTube videos, in different windows, and play both. Right-click the icon and choose "Pause all YouTube videos". The first time, Settings opens instead: in its YouTube section click "Allow access" and accept Chrome's prompt, then choose the menu item again. Both videos pause where they were; choosing it again resumes nothing. "Remove access" in the same place takes the access back.

No data leaves the device.`;

/**
 * Limit for the Description, set by the owner: a hook, a few lines and a link to the website.
 * The store itself allows 16,000.
 */
export const DESCRIPTION_MAX_CHARS = 500;
/** Chrome Web Store limit for the Summary (manifest `description`, i.e. `extDescription`). */
export const CWS_SUMMARY_MAX_CHARS = 132;

/** The listing's languages, default first: the languages the extension ships in. */
export const LISTING_LOCALES = SUPPORTED_LOCALES;
export type ListingLocale = SupportedLocale;
/** The manifest's `default_locale`: what every language without its own listing shows. */
export const DEFAULT_LISTING_LOCALE: ListingLocale = DEFAULT_LOCALE;

/** English names, for headings in SUBMIT.md and log lines. */
export const LOCALE_NAMES: Record<ListingLocale, string> = {
  en: 'English',
  ko: 'Korean',
  es: 'Spanish',
  ja: 'Japanese',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOCALES_SOURCE = path.resolve(__dirname, '..', 'public', '_locales');

export function isListingLocale(code: string): code is ListingLocale {
  return (LISTING_LOCALES as readonly string[]).includes(code);
}

interface MessageEntry {
  message: string;
}

/**
 * One message of `<localesDir>/<locale>/messages.json`, or `undefined` when the file or the key is
 * missing. Chrome matches message names case-insensitively, so this does too.
 */
export function readLocaleMessage(
  localesDir: string,
  locale: string,
  key: string,
): string | undefined {
  let messages: Record<string, MessageEntry | undefined>;
  try {
    messages = JSON.parse(readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf-8'));
  } catch {
    return undefined;
  }
  const exact = messages[key];
  if (exact !== undefined) {
    return exact.message;
  }
  const lower = key.toLowerCase();
  const loose = Object.entries(messages).find(([name]) => name.toLowerCase() === lower);
  return loose?.[1]?.message;
}

export function validateDescription(description: string): void {
  if (description.length > DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `Description is ${description.length.toLocaleString('en-US')} characters; the Chrome Web Store is kept to at most ${DESCRIPTION_MAX_CHARS}`,
    );
  }
}

/** The store Summary is the manifest `description`, which comes from `extDescription`. */
export function validateSummary(summary: string): void {
  if (summary.length > CWS_SUMMARY_MAX_CHARS) {
    throw new Error(
      `Summary is ${summary.length} characters; the Chrome Web Store allows at most ${CWS_SUMMARY_MAX_CHARS}`,
    );
  }
}
