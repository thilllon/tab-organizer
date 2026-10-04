/**
 * The rows of Settings → Keyboard shortcuts, built from `chrome.commands.getAll()`.
 *
 * Every command but one carries the description written in the manifest. The exception is
 * `_execute_action`, Chrome's built-in command for "what a click on the toolbar icon does": Chrome
 * gives it no description (and labels it "Activate the extension" on its own shortcuts page), so
 * the name is supplied here. In this extension that click sorts the window.
 */

export const EXECUTE_ACTION = '_execute_action';

export const SORT_COMMAND_LABEL = 'Sort the tabs in this window (same as clicking the icon)';

export const NOT_SET = 'Not set';

export interface CommandRow {
  name: string;
  shortcut: string;
}

function labelOf(command: chrome.commands.Command): string {
  if (command.name === EXECUTE_ACTION) {
    return SORT_COMMAND_LABEL;
  }
  return command.description !== undefined && command.description !== ''
    ? command.description
    : (command.name ?? '');
}

/** Sorting first — it is the one thing the extension is for — then the rest in manifest order. */
export function commandRows(commands: readonly chrome.commands.Command[]): CommandRow[] {
  const sortFirst = [
    ...commands.filter((command) => command.name === EXECUTE_ACTION),
    ...commands.filter((command) => command.name !== EXECUTE_ACTION),
  ];
  return sortFirst.map((command) => ({
    name: labelOf(command),
    shortcut:
      command.shortcut !== undefined && command.shortcut !== '' ? command.shortcut : NOT_SET,
  }));
}
