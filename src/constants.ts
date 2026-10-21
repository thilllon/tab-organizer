/**
 * Plain values the owner tunes: the default keys the manifest (`vite.config.ts`) and the Settings
 * view (`src/lib/command-rows.ts`) both read, and the automatic lazy-restore threshold.
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
} as const;

/**
 * "Load tabs lazily: Automatic" leaves the tabs of a restore unloaded (discarded until clicked)
 * when it opens more than this many tabs. Settings shows the number in the option's label.
 */
export const LAZY_AUTO_THRESHOLD = 10;
