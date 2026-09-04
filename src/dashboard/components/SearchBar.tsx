import { Search, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isEditableTarget } from '@/dashboard/lib/search-nav';

/** Spec §7: the query is committed 100 ms after the last keystroke, not on every one. */
export const SEARCH_DEBOUNCE_MS = 100;

export interface SearchBarProps {
  /** Called with the debounced query; '' means "show the normal dashboard again". */
  onQueryChange(query: string): void;
  includeHistory: boolean;
  onIncludeHistoryChange(value: boolean): void;
  /** ArrowDown / ArrowUp: move the highlighted result. */
  onMove(direction: 'next' | 'prev'): void;
  /** Enter: activate the highlighted result, or the first one when none is highlighted. */
  onActivate(): void;
}

/**
 * The dashboard's search box (spec §12 Phase 4). It owns the typed text and hands the parent only
 * the debounced query, so a keystroke never re-renders the result list or rebuilds the corpus.
 *
 * Keyboard: `/` focuses it from anywhere on the page, Escape clears and leaves it, the arrows move
 * the highlight and Enter activates it — the last three only while the box has focus.
 */
export function SearchBar({
  onQueryChange,
  includeHistory,
  onIncludeHistoryChange,
  onMove,
  onActivate,
}: SearchBarProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelPending = () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  const commitLater = (value: string) => {
    cancelPending();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      onQueryChange(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const commitNow = (value: string) => {
    cancelPending();
    onQueryChange(value);
  };

  // Nothing may commit a query after this component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // `/` focuses the box from anywhere on the page. Registered on the document because the key
  // press belongs to no particular control; a keystroke that is already going into a field (or
  // that a control has handled) is left alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target instanceof HTMLElement ? event.target : null)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Enter (and Escape) while an IME composition is open belongs to the composition.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setText('');
      commitNow('');
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove('next');
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove('prev');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Flush a keystroke still inside the 100 ms debounce first, so the results the activation
      // runs against are the ones the query describes.
      commitNow(text);
      onActivate();
    }
  };

  const clear = () => {
    setText('');
    commitNow('');
    inputRef.current?.focus();
  };

  return (
    <search className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative min-w-72 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          value={text}
          aria-label="Search"
          placeholder="Search tabs and sessions (press /)"
          className="pr-9 pl-8"
          onChange={(event) => {
            setText(event.target.value);
            commitLater(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        {text !== '' && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Clear search"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={clear}
          >
            <X />
          </Button>
        )}
      </div>
      {/* Wrapping label: the checkbox needs no id to be named by the text next to it. */}
      <Label className="gap-1.5 text-xs font-normal text-muted-foreground">
        <input
          type="checkbox"
          checked={includeHistory}
          onChange={(event) => onIncludeHistoryChange(event.target.checked)}
          className="size-3.5 accent-primary"
        />
        Include history
      </Label>
    </search>
  );
}
