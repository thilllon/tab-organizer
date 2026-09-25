/**
 * The "Saved" toast queue (Settings). Settings write on every keystroke of a radio or switch, so
 * the queue has to survive a burst: three flicks of the same switch inside a second must read as
 * three confirmations, not one flickering box, and must not grow without end either.
 *
 * Kept pure and separate from the component so the capping and expiry rules can be tested without
 * a DOM — the timers themselves live in `useSavedToasts` (./use-saved-toasts.ts).
 */

/** How long one toast stays up. */
export const TOAST_MS = 1000;

/** How many may be stacked at once; a fourth pushes the oldest out. */
export const MAX_TOASTS = 3;

export interface Toast {
  /** Monotonic; also the React key, so a repeated message still animates as a new toast. */
  id: number;
  message: string;
}

/**
 * Appends `toast`, keeping at most `max`. The *oldest* is dropped rather than the newest being
 * refused: the last thing you changed is the thing you want confirmed, so a burst should scroll
 * rather than freeze on the first three.
 */
export function pushToast(list: readonly Toast[], toast: Toast, max: number = MAX_TOASTS): Toast[] {
  if (max <= 0) {
    return [];
  }
  return [...list, toast].slice(-max);
}

/** Removes the toast whose timer fired. A no-op if the cap already pushed it out. */
export function dropToast(list: readonly Toast[], id: number): Toast[] {
  return list.filter((toast) => toast.id !== id);
}
