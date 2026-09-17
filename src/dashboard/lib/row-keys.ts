/**
 * Keyboard actions on a focused saved-session row (spec §12 Phase 6, keyboard/ARIA polish).
 * The row is a `role="treeitem"` in the saved-sessions tree, so Enter expands/collapses it the
 * way a tree node does, and Delete asks for the same confirm the "Delete" menu item opens.
 *
 * The component only has to answer "was this key pressed on the row itself?" — everything else
 * is decided here, and tested.
 */

export type SessionRowAction = 'toggle' | 'delete';

export interface SessionRowKeyState {
  /** True while the inline rename input is open: it owns every key, including Delete. */
  editing: boolean;
}

/**
 * The action a key press on a session row maps to, or undefined for keys the row ignores (which
 * must then keep their default behaviour — Tab, arrows, typing).
 */
export function sessionRowKeyAction(
  key: string,
  state: SessionRowKeyState,
): SessionRowAction | undefined {
  if (state.editing) {
    return undefined;
  }
  switch (key) {
    case 'Enter':
      return 'toggle';
    case 'Delete':
      return 'delete';
    default:
      return undefined;
  }
}
