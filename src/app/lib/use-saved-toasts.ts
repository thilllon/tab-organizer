import { useCallback, useEffect, useRef, useState } from 'react';
import { dropToast, pushToast, TOAST_MS, type Toast } from './toast-queue';

export interface SavedToasts {
  toasts: Toast[];
  /** Shows one toast; it removes itself after `TOAST_MS`. */
  show(message: string): void;
}

/**
 * Timer half of the "Saved" toasts — the queue rules themselves are pure, in ./toast-queue.ts.
 *
 * Every toast owns its own timeout rather than the stack sharing one: with a shared timer a second
 * change would either cut the first toast short or hold all three up for a full second past the
 * last one. Each is tracked so unmounting the Settings view (which is one click away at any time)
 * cannot leave a `setState` pointing at a gone component.
 */
export function useSavedToasts(): SavedToasts {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((list) => pushToast(list, { id, message }));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        // Harmless if the cap already evicted this one — dropToast is a no-op then.
        setToasts((list) => dropToast(list, id));
      }, TOAST_MS),
    );
  }, []);

  return { toasts, show };
}
