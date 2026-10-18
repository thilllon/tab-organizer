import type { CaptureScope } from '@/lib/session-capture';

const NOTHING_TO_SAVE = {
  window: 'Nothing to save: this window only holds Tab Organizer.',
  all: 'Nothing to save: no open window holds anything besides Tab Organizer.',
  tabs: 'Nothing to save: the selected tabs are no longer open.',
} as const;

/** What a save that captured nothing says, worded for what was being saved. */
export function nothingToSaveNotice(scope: CaptureScope): string {
  if (typeof scope === 'object' && 'tabIds' in scope) {
    return NOTHING_TO_SAVE.tabs;
  }
  return scope === 'all' ? NOTHING_TO_SAVE.all : NOTHING_TO_SAVE.window;
}
