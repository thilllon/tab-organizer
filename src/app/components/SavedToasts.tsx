import { Check } from 'lucide-react';
import type { Toast } from '@/app/lib/toast-queue';

export interface SavedToastsProps {
  toasts: readonly Toast[];
}

/**
 * The stack of toasts — "Setting saved" confirmations and the app's notices — pinned to the bottom
 * centre of the viewport, or of the Settings dialog when `App.tsx` renders it in there (the dialog
 * is translated into place, which makes it the containing block for `fixed` children).
 *
 * `fixed` rather than placed in the flow: a line in the flow pushes everything under it down when
 * it appears and back up when it goes, and in a long scrolling column a confirmation next to the
 * control you just touched is off-screen as soon as you scroll. Newest
 * sits at the bottom, nearest the eye.
 *
 * `pointer-events-none` on the stack — it floats over the page and must never swallow a click
 * meant for the control underneath, which matters precisely because it appears while you are still
 * clicking things.
 *
 * One `role="status"` wrapper, not one per toast: a live region announces its *changes*, so
 * re-using the same region reads each new line once instead of registering three regions that
 * re-announce the whole stack.
 */
export function SavedToasts({ toasts }: SavedToastsProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="mx-4 flex items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
        >
          {toast.plain !== true && <Check aria-hidden="true" className="size-3.5 text-primary" />}
          {toast.message}
        </div>
      ))}
    </div>
  );
}
