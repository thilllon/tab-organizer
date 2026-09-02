import { ChevronRight, Ellipsis, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DeleteSessionDialog } from '@/dashboard/components/DeleteSessionDialog';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { errorMessage } from '@/dashboard/lib/errors';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

export interface SessionCardProps {
  summary: SessionSummary;
  restoring: boolean;
  onRestore(session: Session): Promise<void>;
  onRestoreWindow(session: Session, windowIndex: number): Promise<void>;
  /** Called once the session is removed; the card is about to unmount, so move focus elsewhere. */
  onDeleted?(): void;
}

/**
 * Enter pressed to confirm an IME composition (Japanese, Korean, Chinese, ...) reaches the input
 * as a keydown too and must not commit the rename. `isComposing` is the standard signal; keyCode
 * 229 is the legacy one some IMEs still send with `isComposing` false.
 */
function isComposingEnter(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function SessionCard({
  summary,
  restoring,
  onRestore,
  onRestoreWindow,
  onDeleted,
}: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const body = useSessionBody(expanded ? summary.id : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameButtonRef = useRef<HTMLButtonElement>(null);
  // Set when Rename is picked in the dropdown, and acted on in `onCloseAutoFocus` below: the edit
  // must not start while the menu is open. Radix's FocusScope owns focus until the menu unmounts,
  // so an Input mounted from `onSelect` never receives it (its `autoFocus` is overridden and
  // typing goes nowhere), and the trigger refocus that follows blurs it straight back out.
  const renameRequestedRef = useRef(false);
  // Set by Enter/Escape before they close the edit. Chrome fires blur on the input as it is
  // removed from the DOM, and React delivers it: without this, that blur would commit again
  // after Enter (a second identical rename) or -- worse -- commit the draft Escape just reverted.
  const renameSettledRef = useRef(false);
  // Set alongside it when the edit was closed from the keyboard: the input that had focus is
  // gone, so hand focus back to the name button instead of letting it drop to <body>. A blur
  // commit (the user clicked elsewhere) leaves focus where the click put it.
  const returnFocusRef = useRef(false);
  // Set once the delete is confirmed: the dialog's close-time focus hand-off must not target
  // this card's actions button, which unmounts together with the card.
  const deletingRef = useRef(false);

  const startRename = () => {
    renameSettledRef.current = false;
    setDraft(summary.name);
    setEditing(true);
  };

  // Belt and braces for the same problem: even mounted after the menu closed, the input can lose
  // the race with a focus handler still unwinding, so claim focus again on the next frame.
  // The caret is parked at the end rather than selecting the name: renaming a session is usually
  // an edit of the existing name ("Work" -> "Work 2"), and select() would make the first keystroke
  // wipe it -- verified in Chrome, where select() turned "Rename me" + " 2" into "2".
  useEffect(() => {
    if (!editing) {
      if (returnFocusRef.current) {
        returnFocusRef.current = false;
        nameButtonRef.current?.focus();
      }
      return;
    }
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const commitRename = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name.length === 0 || name === summary.name) {
      return;
    }
    try {
      await sessionRepo.rename(summary.id, name);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (isComposingEnter(event)) {
        return;
      }
      event.preventDefault();
      renameSettledRef.current = true;
      returnFocusRef.current = true;
      void commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renameSettledRef.current = true;
      returnFocusRef.current = true;
      setDraft(summary.name);
      setEditing(false);
    }
  };

  const handleRenameBlur = () => {
    if (renameSettledRef.current) {
      return;
    }
    void commitRename();
  };

  const handleDelete = async () => {
    deletingRef.current = true;
    setConfirmingDelete(false);
    try {
      await sessionRepo.remove(summary.id);
      onDeleted?.();
    } catch (err) {
      deletingRef.current = false;
      setError(errorMessage(err));
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      await onRestore(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreWindow = (windowIndex: number) => {
    if (body.session === undefined) {
      return;
    }
    setError(undefined);
    void onRestoreWindow(body.session, windowIndex);
  };

  return (
    <li className="rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </Button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              ref={inputRef}
              value={draft}
              aria-label="Session name"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={handleRenameBlur}
              className="h-8"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                ref={nameButtonRef}
                type="button"
                className="min-w-0 truncate text-left text-sm font-medium hover:underline"
                title="Rename"
                onClick={startRename}
              >
                {summary.name}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Rename session"
                onClick={startRename}
              >
                <Pencil />
              </Button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {formatSessionMeta(summary)} · saved {formatDateTime(summary.updatedAt)}
          </p>
        </div>

        {summary.kind === 'history' && <Badge variant="secondary">history</Badge>}

        <Button size="sm" onClick={() => void handleRestore()} disabled={busy || restoring}>
          <RotateCcw />
          Restore
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // Start the rename only now: the menu's focus scope is gone, so the Input's
              // autoFocus actually lands. preventDefault stops Radix handing focus back to the
              // trigger, whose blur would commit and close the edit immediately.
              if (renameRequestedRef.current) {
                event.preventDefault();
                renameRequestedRef.current = false;
                startRename();
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                renameRequestedRef.current = true;
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-3">
          {body.loading && body.session === undefined && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {body.error !== undefined && <p className="text-xs text-destructive">{body.error}</p>}
          {body.session !== undefined && (
            // Plain overflow container, not Radix's ScrollArea: its viewport is `size-full`, and a
            // percentage height against a `max-height`-only parent resolves to auto, so nothing
            // ever clipped and the tree overflowed the card instead of scrolling.
            <div className="max-h-96 overflow-y-auto">
              <div className="space-y-2 pr-3">
                {body.session.windows.map((window, index) => (
                  <WindowTree
                    // biome-ignore lint/suspicious/noArrayIndexKey: no stable window id
                    key={`window-${index}`}
                    window={window}
                    index={index}
                    onRestoreWindow={() => handleRestoreWindow(index)}
                    restoring={busy || restoring}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
        onCloseAutoFocus={(event) => {
          // The dialog closes as the delete starts; Radix would focus the actions button, which
          // unmounts with the card moments later, and focus would end up on <body>. The dialog's
          // exit animation makes this race `onDeleted` above, so both point at the same target.
          if (deletingRef.current) {
            event.preventDefault();
            onDeleted?.();
          }
        }}
      />
    </li>
  );
}
