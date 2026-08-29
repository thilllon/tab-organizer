import type { Session } from '@/types';

/** Returns a copy of `session` that contains only `windows[windowIndex]`. */
export function pickWindow(session: Session, windowIndex: number): Session {
  const window = session.windows[windowIndex];
  if (windowIndex < 0 || window === undefined) {
    throw new RangeError(`Session ${session.id} has no window at index ${windowIndex}`);
  }
  return { ...session, windows: [window] };
}
