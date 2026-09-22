import { Ellipsis, ExternalLink, Link, Pencil, Trash2, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { openSavedTab } from '@/app/lib/open-saved-tab';
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
import { ExportMenu } from '@/dashboard/components/ExportMenu';
import { WindowTree } from '@/dashboard/components/WindowTree';
import { useSessionBody } from '@/dashboard/hooks/useSessionBody';
import { copyText } from '@/dashboard/lib/download';
import { errorMessage } from '@/dashboard/lib/errors';
import { COPIED_LINK } from '@/dashboard/lib/export-actions';
import { formatDateTime, formatSessionMeta } from '@/dashboard/lib/format';
import { removeTabFromSession, removeWindowFromSession } from '@/dashboard/lib/session-edit';
import { sessionRepo } from '@/sessions/storage';
import type { Session, SessionSummary } from '@/types';

/** Where an "Open" goes: brand-new windows, or the window the app itself is in. */
export type OpenScope = 'newWindows' | 'here';

export interface SessionDetailProps {
  summary: SessionSummary;
  restoring: boolean;
  onOpen(session: Session, scope: OpenScope): Promise<void>;
  onOpenWindow(session: Session, windowIndex: number, scope: OpenScope): Promise<void>;
  /** "Exported …" / "Copied …" confirmations, shown in the app's notice line. */
  onNotice(message: string): void;
  /** The session is gone; the view must navigate away from its address. */
  onDeleted(): void;
}

/**
 * Enter pressed to confirm an IME composition (Japanese, Korean, Chinese, …) reaches the input as
 * a keydown too and must not commit the rename. `isComposing` is the standard signal; keyCode 229
 * is the legacy one some IMEs still send with `isComposing` false.
 */
function isComposingEnter(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * One saved session, filling the main pane: its name (click to rename), one primary action, and
 * the window → group → tab tree. Everything that is not "open this" lives in the ⋯ menu, so the
 * page has a single obvious button.
 */
export function SessionDetail({
  summary,
  restoring,
  onOpen,
  onOpenWindow,
  onNotice,
  onDeleted,
}: SessionDetailProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const body = useSessionBody(summary.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameButtonRef = useRef<HTMLButtonElement>(null);
  // Set when Rename is picked in the dropdown and acted on in `onCloseAutoFocus`: the edit must
  // not start while the menu is open, or Radix's focus scope keeps the new Input from getting
  // focus and the trigger refocus blurs it straight back out.
  const renameRequestedRef = useRef(false);
  // Set by Enter/Escape before they close the edit. Chrome fires blur on the input as it leaves
  // the DOM, and React delivers it: without this, that blur would commit again after Enter, or
  // commit the draft Escape just reverted.
  const renameSettledRef = useRef(false);
  const returnFocusRef = useRef(false);

  // A different session in the same pane starts with its own name, not the previous draft.
  useEffect(() => {
    setEditing(false);
    setError(undefined);
    setDraft(summary.name);
  }, [summary.name]);

  const startRename = () => {
    renameSettledRef.current = false;
    setDraft(summary.name);
    setEditing(true);
  };

  // Even mounted after the menu closed, the input can lose the race with a focus handler still
  // unwinding, so claim focus again on the next frame. The caret is parked at the end rather than
  // selecting the name: renaming is usually an edit of the existing name ("Work" → "Work 2").
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

  const handleDelete = async () => {
    setConfirmingDelete(false);
    try {
      await sessionRepo.remove(summary.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleOpen = async (scope: OpenScope) => {
    setBusy(true);
    try {
      const session = body.session ?? (await sessionRepo.get(summary.id));
      if (session === undefined) {
        setError('This session no longer exists.');
        return;
      }
      setError(undefined);
      await onOpen(session, scope);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenWindow = (windowIndex: number, scope: OpenScope) => {
    if (body.session === undefined) {
      return;
    }
    setError(undefined);
    void onOpenWindow(body.session, windowIndex, scope);
  };

  /**
   * Applies a pure edit (src/dashboard/lib/session-edit.ts) to the stored body under the lock.
   * `mutate` runs twice on purpose: once here on the loaded body to find out whether the edit
   * would empty the session — that asks for confirmation instead of deleting silently — and once
   * inside `sessionRepo.update`, on the body as it actually is on disk.
   */
  const editSession = async (mutate: (session: Session) => Session | null) => {
    const loaded = body.session;
    if (loaded === undefined) {
      return;
    }
    try {
      if (mutate(loaded) === null) {
        setConfirmingDelete(true);
        return;
      }
      await sessionRepo.update(summary.id, mutate);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleCopyTabLink = (url: string) => {
    void copyText(url).then((result) => {
      if (result.ok) {
        setError(undefined);
        onNotice(COPIED_LINK);
        return;
      }
      setError(result.error);
    });
  };

  /** A saved tab that is already open is brought forward instead of opened again. */
  const handleOpenTab = async (url: string): Promise<string | undefined> => {
    const result = await openSavedTab(url);
    if (!result.ok) {
      return result.reason;
    }
    if (result.switched) {
      onNotice('That tab was already open — switched to it.');
    }
    return undefined;
  };

  return (
    <section aria-label={summary.name} className="min-w-0">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              ref={inputRef}
              value={draft}
              aria-label="Session name"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKey}
              onBlur={() => {
                if (!renameSettledRef.current) {
                  void commitRename();
                }
              }}
              className="h-9 text-base"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                ref={nameButtonRef}
                type="button"
                title="Rename"
                onClick={startRename}
                className="min-w-0 truncate rounded-sm text-left text-lg font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

        <div className="flex items-center gap-2">
          <Button onClick={() => void handleOpen('newWindows')} disabled={busy || restoring}>
            <ExternalLink />
            Open
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
                if (renameRequestedRef.current) {
                  event.preventDefault();
                  renameRequestedRef.current = false;
                  startRename();
                }
              }}
            >
              <DropdownMenuItem
                disabled={busy || restoring}
                onSelect={() => {
                  void handleOpen('here');
                }}
              >
                <ExternalLink />
                Open in this window
              </DropdownMenuItem>
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
          <ExportMenu
            summary={summary}
            session={body.session}
            onNotice={onNotice}
            onError={setError}
          />
        </div>
      </header>

      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4">
        {body.loading && body.session === undefined && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {body.error !== undefined && <p className="text-sm text-destructive">{body.error}</p>}
        {body.session !== undefined && (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA group holding this session's window nodes.
          <div role="tree" aria-label={`Windows in ${summary.name}`} className="space-y-2">
            {body.session.windows.map((window, index) => (
              <WindowTree
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable window id
                key={`window-${index}`}
                window={window}
                index={index}
                onOpenTab={(tabIndex) => handleOpenTab(window.tabs[tabIndex].url)}
                actions={
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleOpenWindow(index, 'newWindows')}
                      disabled={busy || restoring}
                    >
                      Open window
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleOpenWindow(index, 'here')}
                      disabled={busy || restoring}
                    >
                      Open here
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void editSession((s) => removeWindowFromSession(s, index))}
                    >
                      <X />
                      Remove
                    </Button>
                    <ExportMenu
                      summary={summary}
                      session={body.session}
                      windowIndex={index}
                      size="icon-xs"
                      onNotice={onNotice}
                      onError={setError}
                    />
                  </>
                }
                renderGroupActions={(groupIndex) => (
                  <ExportMenu
                    summary={summary}
                    session={body.session}
                    windowIndex={index}
                    groupIndex={groupIndex}
                    size="icon-xs"
                    onNotice={onNotice}
                    onError={setError}
                  />
                )}
                renderTabActions={(tabIndex) => (
                  <>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Copy link"
                      onClick={() => handleCopyTabLink(window.tabs[tabIndex].url)}
                    >
                      <Link />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Remove from session"
                      onClick={() =>
                        void editSession((s) => removeTabFromSession(s, index, tabIndex))
                      }
                    >
                      <X />
                    </Button>
                  </>
                )}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteSessionDialog
        name={summary.name}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
