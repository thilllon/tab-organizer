/**
 * Names and default keys that more than one place has to agree on: the manifest
 * (`vite.config.ts`), the icon's right-click menu and the Settings page.
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

// The action's name ("Assemble!") and its bracketed explanation are user text, so they live in
// public/_locales as `assembleName` and `cmdAssembleTabs` (read with `t()` from src/lib/i18n.ts);
// this file cannot hold them because it must stay free of `chrome.*`.
