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
 * so nothing may promise these — Settings shows what `chrome.commands.getAll()` reports.
 */
export const DEFAULT_SHORTCUTS = {
  /** Chrome's built-in command for a click on the toolbar icon, which sorts. */
  _execute_action: 'Alt+Shift+S',
  'assemble-tabs': 'Alt+Shift+A',
} as const;

/** The action's name, as on the Open tabs button. */
export const ASSEMBLE_NAME = 'Assemble!';

/** What it does, short enough to sit in brackets after the name. */
export const ASSEMBLE_EXPLANATION = "move every window's tabs into this one";

/**
 * Name and explanation together, for the places that have no tooltip to explain the name: the
 * icon's right-click menu and the command list at chrome://extensions/shortcuts.
 */
export const ASSEMBLE_LABEL = `${ASSEMBLE_NAME} (${ASSEMBLE_EXPLANATION})`;
