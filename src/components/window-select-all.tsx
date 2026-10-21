import { useEffect, useRef } from 'react';

import { t } from '@/lib/i18n';
import type { SelectionState } from '@/lib/tab-selection';

interface WindowSelectAllProps {
  /** The window's number in the list (1, 2, ...), formatted, for the box's accessible name. */
  windowNumber: string;
  /** How much of the window is ticked: the box shows a tick, a dash or nothing. */
  state: SelectionState;
  /** Ticks every tab of the window, or clears them when all are ticked. */
  onToggle(): void;
}

/**
 * The row between an open window's header and its tabs, in the Open tabs list only: one box that
 * ticks or clears the whole window within the page's selection. The same native box and look as a
 * tab row's, placed over theirs so the column of boxes reads as one.
 */
export function WindowSelectAll({ windowNumber, state, onToggle }: WindowSelectAllProps) {
  const box = useRef<HTMLInputElement>(null);

  // `indeterminate` exists only as a DOM property, never as an attribute.
  useEffect(() => {
    if (box.current !== null) {
      box.current.indeterminate = state === 'some';
    }
  }, [state]);

  return (
    <div className="border-b px-2 py-1">
      {/* ml-0.5 puts the box over the tab rows' own (the list's p-1 + the row box's ml-1.5). */}
      <label
        title={t('openSelectWindowTabs', windowNumber)}
        className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
      >
        <input
          ref={box}
          type="checkbox"
          aria-label={t('openSelectWindowTabs', windowNumber)}
          checked={state === 'all'}
          onChange={onToggle}
          className="ml-0.5 size-3.5 shrink-0 cursor-pointer accent-primary"
        />
        {t('openSelectAll')}
      </label>
    </div>
  );
}
